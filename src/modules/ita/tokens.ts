import { first, run } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { type ItaEnv, type ItaEnvironment, ITA_SCOPE, ITA_URLS, itaCredentials, itaEnvironment, relayedFetch } from './config';
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

export class ItaTokenStore {
  readonly environment: ItaEnvironment;

  constructor(
    private readonly env: ItaEnv,
    private readonly io: ClockAndFetch,
  ) {
    this.environment = itaEnvironment(env);
  }

  private get db() {
    return this.env.DB;
  }

  /** The row for the current environment only. */
  private row(): Promise<TokenRow | null> {
    return first<TokenRow>(this.db, 'SELECT * FROM ita_tokens WHERE environment = ?', this.environment);
  }

  private key() {
    return importTokenKey(this.env.ITA_TOKEN_KEY);
  }

  /** A stored token that no longer decrypts (for example after ITA_TOKEN_KEY changed) needs a new login. */
  private async open(key: CryptoKey, stored: string, kind: 'access' | 'refresh'): Promise<string> {
    try {
      return await decryptToken(key, stored, `${this.environment}:${kind}`);
    } catch {
      await this.markReconnect('The stored ITA token cannot be read with the current ITA_TOKEN_KEY.');
      throw new ItaReconnectError();
    }
  }

  /** Builds the browser URL for the ITA login. */
  authorizeUrl(state: string, redirectUri: string): string {
    const { clientId } = itaCredentials(this.env);
    const url = new URL(ITA_URLS[this.environment].authorize);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', ITA_SCOPE);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async postToken(body: Record<string, string>): Promise<{ status: number; json: unknown }> {
    const { clientId, clientSecret } = itaCredentials(this.env);
    let res: Response;
    try {
      res = await relayedFetch(this.env, this.io.fetch)(ITA_URLS[this.environment].token, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(body).toString(),
      });
    } catch {
      throw new ItaUnavailableError('The ITA login service is not answering.');
    }
    // A reply that is not JSON (a firewall page, say) is kept as text, so the reason shows its source.
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text ? { body: text.replace(/\s+/g, ' ').trim() } : null;
    }
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

  private static parse(json: unknown): TokenResponse | null {
    if (!json || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;
    if (typeof o.access_token !== 'string' || typeof o.refresh_token !== 'string') return null;
    const expiresIn = Number(o.expires_in);
    const refreshIn = o.refresh_token_expires_in === undefined ? undefined : Number(o.refresh_token_expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
    return {
      access_token: o.access_token,
      refresh_token: o.refresh_token,
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
      scope: ITA_SCOPE,
    });
    if (status >= 500) throw new ItaUnavailableError(`The ITA login service is not answering (HTTP ${status}${ItaTokenStore.errorText(json)}).`);
    const tokens = ItaTokenStore.parse(json);
    if (status !== 200 || !tokens) {
      const why = status === 200 ? ': the reply had no usable tokens' : ItaTokenStore.errorText(json);
      throw new ItaReconnectError(`The ITA refused the login (HTTP ${status}${why}). Connect again.`);
    }

    const now = this.io.now();
    const key = await this.key();
    const refreshMs = (tokens.refresh_token_expires_in ?? 90 * 86_400) * 1000;
    const refreshEnc = await encryptToken(key, tokens.refresh_token, `${this.environment}:refresh`);
    const accessEnc = await encryptToken(key, tokens.access_token, `${this.environment}:access`);
    await run(
      this.db,
      `INSERT INTO ita_tokens (environment, refresh_token_enc, refresh_expires_at, access_token_enc, access_expires_at,
         login_at, relogin_due_at, last_refresh_at, rotation, status, status_reason, reminder_sent_at, connected_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'active', NULL, NULL, ?, ?)
       ON CONFLICT (environment) DO UPDATE SET
         refresh_token_enc = excluded.refresh_token_enc, refresh_expires_at = excluded.refresh_expires_at,
         access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
         login_at = excluded.login_at, relogin_due_at = excluded.relogin_due_at, last_refresh_at = NULL,
         rotation = ita_tokens.rotation + 1, status = 'active', status_reason = NULL, reminder_sent_at = NULL,
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
    const key = await this.key();
    const refreshToken = await this.open(key, row.refresh_token_enc, 'refresh');
    // The ITA developer guide sends client_id and client_secret in the refresh body as well as
    // the Basic header. The first refresh with the header alone was refused.
    const { clientId, clientSecret } = itaCredentials(this.env);
    const { status, json } = await this.postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: ITA_SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (status >= 500) throw new ItaUnavailableError('The ITA login service is not answering.');
    const tokens = ItaTokenStore.parse(json);
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
      `UPDATE ita_tokens SET refresh_token_enc = ?, refresh_expires_at = ?, access_token_enc = ?, access_expires_at = ?,
         last_refresh_at = ?, rotation = rotation + 1, updated_at = ?
       WHERE environment = ? AND rotation = ?`,
      await encryptToken(key, tokens.refresh_token, `${this.environment}:refresh`),
      // The re-login date stays tied to the interactive login.
      refreshExpires < row.relogin_due_at ? refreshExpires : row.relogin_due_at,
      await encryptToken(key, tokens.access_token, `${this.environment}:access`),
      addMs(now, tokens.expires_in * 1000),
      now.toISOString(),
      now.toISOString(),
      this.environment,
      row.rotation,
    );
    return tokens.access_token;
  }

  async markReconnect(reason: string): Promise<void> {
    await run(
      this.db,
      `UPDATE ita_tokens SET status = 'reconnect_required', status_reason = ?, access_token_enc = NULL,
         access_expires_at = NULL, updated_at = ? WHERE environment = ?`,
      reason,
      this.io.now().toISOString(),
      this.environment,
    );
  }

  async markReminderSent(): Promise<void> {
    await run(
      this.db,
      'UPDATE ita_tokens SET reminder_sent_at = ?, updated_at = ? WHERE environment = ?',
      this.io.now().toISOString(),
      this.io.now().toISOString(),
      this.environment,
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
