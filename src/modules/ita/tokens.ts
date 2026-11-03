import { first, run } from '../../core/db';
import { ConfigError, ValidationError } from '../../core/errors';
import { type ItaEnv, type ItaEnvironment, type ItaUrls, ITA_FILE_SCOPE, ITA_FILE_URLS, ITA_SCOPE, ITA_URLS, itaBroker, itaScopes, itaCredentials, itaEnvironment, relayedFetch } from './config';
import { decryptToken, encryptToken, importTokenKey } from './crypto';
import { ItaReconnectError, ItaUnavailableError } from './errors';

/**
 * OAuth2 authorization code flow with rotating refresh tokens (docs/israel-invoices-api.md §3).
 * Access tokens live about 10 minutes. The refresh token lives 90 days from the interactive login,
 * and every refresh returns a new one that replaces the old one.
 */

export interface ClockAndFetch {
  fetch: typeof fetch;
  now: () => Date;
}

interface TokenRow {
  environment: ItaEnvironment;
  refresh_token_enc: string;
  refresh_expires_at: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
  login_at: string;
  relogin_due_at: string;
  last_refresh_at: string | null;
  rotation: number;
  status: 'active' | 'reconnect_required';
  status_reason: string | null;
  reminder_sent_at: string | null;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in?: number;
}

/** Access tokens are renewed this long before they expire. */
const ACCESS_SKEW_MS = 30_000;
const DAY_MS = 86_400_000;

export interface ConnectionStatus {
  environment: ItaEnvironment;
  connected: boolean;
  status: 'not_connected' | 'active' | 'reconnect_required';
  status_reason: string | null;
  login_at: string | null;
  relogin_due_at: string | null;
  days_since_login: number | null;
  days_until_relogin: number | null;
  last_refresh_at: string | null;
  reminder_sent_at: string | null;
}

function addMs(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

/**
 * Which ITA login: the invoice services (longtimetoken, invoices_scope), or the unified file
 * services (dailytoken, their own scopes). Each has its own table, addresses and scope.
 */
export type ItaLogin = 'invoices' | 'unified_file';

export class ItaTokenStore {
  readonly environment: ItaEnvironment;
  private readonly table: 'ita_tokens' | 'ita_file_tokens';
  private readonly urls: ItaUrls;

  constructor(
    private readonly env: ItaEnv,
    private readonly io: ClockAndFetch,
    /** R24 B6: each business keeps its own ITA login. Business 1 is the login that existed before. */
    readonly businessId: number = 1,
    readonly login: ItaLogin = 'invoices',
  ) {
    this.environment = itaEnvironment(env);
    this.table = login === 'unified_file' ? 'ita_file_tokens' : 'ita_tokens';
    this.urls = (login === 'unified_file' ? ITA_FILE_URLS : ITA_URLS)[this.environment];
  }

  /** The scope this login asks for. */
  private get scope(): string {
    return this.login === 'unified_file' ? ITA_FILE_SCOPE : ITA_SCOPE;
  }

  /** Encryption context. Business 1 keeps the one its stored tokens were sealed with. */
  private aad(kind: 'access' | 'refresh'): string {
    if (this.login === 'unified_file') return `${this.environment}:file:b${this.businessId}:${kind}`;
    return this.businessId === 1 ? `${this.environment}:${kind}` : `${this.environment}:b${this.businessId}:${kind}`;
  }

  private get db() {
    return this.env.DB;
  }

  /** The row for the current environment only. */
  private row(): Promise<TokenRow | null> {
    return first<TokenRow>(this.db, `SELECT * FROM ${this.table} WHERE environment = ? AND business_id = ?`, this.environment, this.businessId);
  }

  private key() {
    return importTokenKey(this.env.ITA_TOKEN_KEY);
  }

  /** A stored token that no longer decrypts (for example after ITA_TOKEN_KEY changed) needs a new login. */
  private async open(key: CryptoKey, stored: string, kind: 'access' | 'refresh'): Promise<string> {
    try {
      return await decryptToken(key, stored, this.aad(kind));
    } catch {
      await this.markReconnect('The stored ITA token cannot be read with the current ITA_TOKEN_KEY.');
      throw new ItaReconnectError();
    }
  }

  /** Builds the browser URL for the ITA login. */
  authorizeUrl(state: string, redirectUri: string): string {
    // R26: in demo mode Connect succeeds at once. The callback gets a demo code, which the fake
    // Tax Authority (src/modules/demo/ita-fake.ts) exchanges for demo tokens.
    if ((this.env.DEMO_MODE ?? '').trim() === '1') return `${redirectUri}?code=demo&state=${encodeURIComponent(state)}`;
    // With a login broker, the broker sends the browser to the ITA and back to this install.
    const broker = itaBroker(this.env);
    if (broker) {
      const url = new URL(`${broker.url}/authorize`);
      url.searchParams.set('client', broker.client);
      url.searchParams.set('environment', this.environment);
      url.searchParams.set('state', state);
      if (this.login === 'unified_file') url.searchParams.set('provider', 'dailytoken');
      return url.toString();
    }
    const { clientId } = itaCredentials(this.env);
    const url = new URL(this.urls.authorize);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', this.scope);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async postToken(body: Record<string, string>): Promise<{ status: number; json: unknown }> {
    const broker = itaBroker(this.env);
    let res: Response;
    try {
      if (broker) {
        // The broker adds the app's client credentials and its own redirect address, then returns
        // the ITA reply as it came.
        res = await this.io.fetch(`${broker.url}/token`, {
          method: 'POST',
          headers: {
            'X-Ita-Broker-Client': broker.client,
            'X-Ita-Broker-Key': broker.key,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ ...body, environment: this.environment, ...(this.login === 'unified_file' ? { provider: 'dailytoken' } : {}) }).toString(),
        });
      } else {
        const { clientId, clientSecret } = itaCredentials(this.env);
        res = await relayedFetch(this.env, this.io.fetch)(this.urls.token, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams(body).toString(),
        });
      }
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ItaUnavailableError(broker ? 'The ITA login broker is not answering.' : 'The ITA login service is not answering.');
    }
    // A reply that is not JSON (a firewall page, say) is kept as text, so the reason shows its source.
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text ? { body: text.replace(/\s+/g, ' ').trim() } : null;
    }
    // The broker's own refusals (unknown install, wrong key) are a setup problem, not a refused login.
    const brokerError = broker && json && typeof json === 'object' ? (json as Record<string, unknown>).broker_error : undefined;
    if (typeof brokerError === 'string') throw new ItaUnavailableError(`The ITA login broker refused the call: ${brokerError.slice(0, 200)}`);
    return { status: res.status, json };
  }

  /** The ITA's error code and description, for the stored reason. Never includes a token. */
  private static errorText(json: unknown): string {
    if (!json || typeof json !== 'object') return '';
    const o = json as Record<string, unknown>;
    const parts = [o.error, o.error_description, o.moreInformation, o.httpMessage, o.body]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.slice(0, 200));
    return parts.length ? `: ${parts.join(' / ')}` : '';
  }

  /** `refreshOptional`: the unified file login (dailytoken) may come without a refresh token. */
  private static parse(json: unknown, refreshOptional = false): TokenResponse | null {
    if (!json || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;
    if (typeof o.access_token !== 'string') return null;
    if (typeof o.refresh_token !== 'string' && !(refreshOptional && o.refresh_token === undefined)) return null;
    const expiresIn = Number(o.expires_in);
    const refreshIn = o.refresh_token_expires_in === undefined ? undefined : Number(o.refresh_token_expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
    return {
      access_token: o.access_token,
      refresh_token: typeof o.refresh_token === 'string' ? o.refresh_token : '',
      expires_in: expiresIn,
      refresh_token_expires_in: refreshIn !== undefined && Number.isFinite(refreshIn) ? refreshIn : undefined,
    };
  }

  /** Callback step: trades the one-time code for tokens and stores them encrypted. */
  async exchangeCode(code: string, redirectUri: string, userId: number | null): Promise<void> {
    if (!code) throw new ValidationError('The ITA sent no authorization code.');
    const { status, json } = await this.postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: this.scope,
    });
    if (status >= 500) throw new ItaUnavailableError(`The ITA login service is not answering (HTTP ${status}${ItaTokenStore.errorText(json)}).`);
    const tokens = ItaTokenStore.parse(json, this.login === 'unified_file');
    if (status !== 200 || !tokens) {
      const why = status === 200 ? ': the reply had no usable tokens' : ItaTokenStore.errorText(json);
      throw new ItaReconnectError(`The ITA refused the login (HTTP ${status}${why}). Connect again.`);
    }

    const now = this.io.now();
    const key = await this.key();
    // No refresh token (the unified file login may send none): the login lasts as long as the access token.
    const refreshMs = tokens.refresh_token ? (tokens.refresh_token_expires_in ?? 90 * 86_400) * 1000 : tokens.expires_in * 1000;
    const refreshEnc = tokens.refresh_token ? await encryptToken(key, tokens.refresh_token, this.aad('refresh')) : '';
    const accessEnc = await encryptToken(key, tokens.access_token, this.aad('access'));
    await run(
      this.db,
      `INSERT INTO ${this.table} (environment, refresh_token_enc, refresh_expires_at, access_token_enc, access_expires_at,
         login_at, relogin_due_at, last_refresh_at, rotation, status, status_reason, reminder_sent_at, connected_by, updated_at, business_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'active', NULL, NULL, ?, ?, ?)
       ON CONFLICT (business_id, environment) DO UPDATE SET
         refresh_token_enc = excluded.refresh_token_enc, refresh_expires_at = excluded.refresh_expires_at,
         access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
         login_at = excluded.login_at, relogin_due_at = excluded.relogin_due_at, last_refresh_at = NULL,
         rotation = ${this.table}.rotation + 1, status = 'active', status_reason = NULL, reminder_sent_at = NULL,
         connected_by = excluded.connected_by, updated_at = excluded.updated_at`,
      this.environment,
      refreshEnc,
      addMs(now, refreshMs),
      accessEnc,
      addMs(now, tokens.expires_in * 1000),
      now.toISOString(),
      addMs(now, refreshMs),
      userId,
      now.toISOString(),
      this.businessId,
    );
  }

  /** A valid access token. Refreshes when the stored one is about to expire. */
  async accessToken(): Promise<string> {
    const row = await this.row();
    if (!row) throw new ItaReconnectError('Connect to ITA first.');
    if (row.status !== 'active') throw new ItaReconnectError();
    const now = this.io.now().getTime();
    if (row.access_token_enc && row.access_expires_at && Date.parse(row.access_expires_at) - ACCESS_SKEW_MS > now) {
      return this.open(await this.key(), row.access_token_enc, 'access');
    }
    return this.refresh(row);
  }

  /**
   * Uses the refresh token once and stores the rotated pair. When two refreshes race on one
   * token, the loser re-reads the row and uses the winner's access token.
   */
  async refresh(current?: TokenRow): Promise<string> {
    const row = current ?? (await this.row());
    if (!row) throw new ItaReconnectError('Connect to ITA first.');
    if (row.status !== 'active') throw new ItaReconnectError();
    const now = this.io.now();
    if (Date.parse(row.refresh_expires_at) <= now.getTime()) {
      await this.markReconnect('The ITA login expired after 90 days.');
      throw new ItaReconnectError('The ITA login expired. Connect again.');
    }
    if (!row.refresh_token_enc) {
      await this.markReconnect('The Tax Authority login for sending the unified file has ended. Sign in again to send.');
      throw new ItaReconnectError('Sign in to the Tax Authority again to send.');
    }
    const key = await this.key();
    const refreshToken = await this.open(key, row.refresh_token_enc, 'refresh');
    // The ITA developer guide sends client_id and client_secret in the refresh body as well as
    // the Basic header. The first refresh with the header alone was refused.
    // A login broker adds the client credentials itself.
    const credentials = itaBroker(this.env) ? {} : (({ clientId, clientSecret }) => ({ client_id: clientId, client_secret: clientSecret }))(itaCredentials(this.env));
    // SHAAM's scope change of 01.11.2026: the new scope first. Until that date a refusal (400) is
    // tried once more with the old scope, for a refresh token issued under it.
    let status = 0;
    let json: unknown = null;
    let used = ITA_SCOPE;
    for (const scope of this.login === 'unified_file' ? [this.scope] : itaScopes(now)) {
      used = scope;
      ({ status, json } = await this.postToken({ grant_type: 'refresh_token', refresh_token: refreshToken, scope, ...credentials }));
      if (status !== 400) break;
    }
    // Before 01.11.2026 only: the ITA refused invoices_scope and took the old scope. Logged so it is
    // seen and fixed (a new login) before the old scope stops working.
    if (status === 200 && used !== ITA_SCOPE) {
      console.warn(`ita refresh env=${this.environment} business=${this.businessId} took the old scope "${used}" after invoices_scope was refused`);
      await run(
        this.db,
        "INSERT INTO audit_log (action, entity, entity_id, details, business_id) VALUES ('ita.legacy_scope', 'ita_tokens', ?, ?, ?)",
        this.environment,
        JSON.stringify({ scope: used, note: 'invoices_scope was refused. Connect to ITA again before 01.11.2026.' }),
        this.businessId,
      );
    }
    if (status >= 500) throw new ItaUnavailableError('The ITA login service is not answering.');
    const tokens = ItaTokenStore.parse(json, this.login === 'unified_file');
    if (status !== 200 || !tokens) {
      const latest = await this.row();
      if (latest && latest.rotation !== row.rotation && latest.status === 'active' && latest.access_token_enc) {
        return this.open(key, latest.access_token_enc, 'access');
      }
      await this.markReconnect(`The ITA refused the refresh token (HTTP ${status}${ItaTokenStore.errorText(json)}).`);
      throw new ItaReconnectError();
    }

    const refreshExpires = tokens.refresh_token_expires_in
      ? addMs(now, tokens.refresh_token_expires_in * 1000)
      : row.refresh_expires_at;
    await run(
      this.db,
      `UPDATE ${this.table} SET refresh_token_enc = ?, refresh_expires_at = ?, access_token_enc = ?, access_expires_at = ?,
         last_refresh_at = ?, rotation = rotation + 1, updated_at = ?
       WHERE environment = ? AND business_id = ? AND rotation = ?`,
      tokens.refresh_token ? await encryptToken(key, tokens.refresh_token, this.aad('refresh')) : '',
      // The re-login date stays tied to the interactive login.
      refreshExpires < row.relogin_due_at ? refreshExpires : row.relogin_due_at,
      await encryptToken(key, tokens.access_token, this.aad('access')),
      addMs(now, tokens.expires_in * 1000),
      now.toISOString(),
      now.toISOString(),
      this.environment,
      this.businessId,
      row.rotation,
    );
    return tokens.access_token;
  }

  async markReconnect(reason: string): Promise<void> {
    await run(
      this.db,
      `UPDATE ${this.table} SET status = 'reconnect_required', status_reason = ?, access_token_enc = NULL,
         access_expires_at = NULL, updated_at = ? WHERE environment = ? AND business_id = ?`,
      reason,
      this.io.now().toISOString(),
      this.environment,
      this.businessId,
    );
  }

  async markReminderSent(): Promise<void> {
    await run(
      this.db,
      `UPDATE ${this.table} SET reminder_sent_at = ?, updated_at = ? WHERE environment = ? AND business_id = ?`,
      this.io.now().toISOString(),
      this.io.now().toISOString(),
      this.environment,
      this.businessId,
    );
  }

  async status(): Promise<ConnectionStatus> {
    const row = await this.row();
    if (!row) {
      return {
        environment: this.environment,
        connected: false,
        status: 'not_connected',
        status_reason: null,
        login_at: null,
        relogin_due_at: null,
        days_since_login: null,
        days_until_relogin: null,
        last_refresh_at: null,
        reminder_sent_at: null,
      };
    }
    const now = this.io.now().getTime();
    return {
      environment: this.environment,
      connected: row.status === 'active',
      status: row.status,
      status_reason: row.status_reason,
      login_at: row.login_at,
      relogin_due_at: row.relogin_due_at,
      days_since_login: Math.floor((now - Date.parse(row.login_at)) / DAY_MS),
      days_until_relogin: Math.max(0, Math.ceil((Date.parse(row.relogin_due_at) - now) / DAY_MS)),
      last_refresh_at: row.last_refresh_at,
      reminder_sent_at: row.reminder_sent_at,
    };
  }
}
