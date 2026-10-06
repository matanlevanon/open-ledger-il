import { type ItaEnv, type ItaPath, ITA_URLS, relayedFetch } from './config';
import { ItaReconnectError, ItaUnavailableError } from './errors';
import type { ClockAndFetch, ItaTokenStore } from './tokens';

/**
 * Calls one ITA API path with the stored token. On 401 it refreshes once and retries once,
 * then flags "Reconnect to ITA" (docs/israel-invoices-api.md §3). Request bodies are never logged:
 * they carry the owner ID number.
 */

export type ItaHttpResult =
  | { kind: 'response'; status: number; json: unknown }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'unavailable'; status: number | null; message: string };

const TIMEOUT_MS = 20_000;

/** Every v2 field name is lowercase (CLAUDE.md rule 8). Throws on the first key that is not. */
export function assertLowercaseKeys(value: unknown, path = 'body'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertLowercaseKeys(v, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (k !== k.toLowerCase()) throw new TypeError(`ITA field names must be lowercase: ${path}.${k}`);
    assertLowercaseKeys(v, `${path}.${k}`);
  }
}

export class ItaClient {
  constructor(
    private readonly env: ItaEnv,
    private readonly tokens: ItaTokenStore,
    private readonly io: ClockAndFetch,
  ) {}

  private async send(path: ItaPath, body: unknown, token: string): Promise<Response> {
    const url = `${ITA_URLS[this.tokens.environment].api}${path}`;
    return relayedFetch(this.env, this.io.fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async post(path: ItaPath, body: unknown): Promise<ItaHttpResult> {
    assertLowercaseKeys(body);
    try {
      let token = await this.tokens.accessToken();
      let res = await this.send(path, body, token);
      if (res.status === 401) {
        token = await this.tokens.refresh();
        res = await this.send(path, body, token);
        if (res.status === 401) {
          await this.tokens.markReconnect('The ITA refused the access token after a refresh.');
          return { kind: 'unauthorized', message: 'Reconnect to ITA to continue.' };
        }
      }
      if (res.status >= 500) {
        return { kind: 'unavailable', status: res.status, message: `The ITA answered ${res.status}.` };
      }
      const json = await res.json().catch(() => null);
      return { kind: 'response', status: res.status, json };
    } catch (err) {
      if (err instanceof ItaReconnectError) return { kind: 'unauthorized', message: err.message };
      if (err instanceof ItaUnavailableError) return { kind: 'unavailable', status: null, message: err.message };
      if (err instanceof TypeError && err.message.startsWith('ITA field names')) throw err;
      if (err instanceof Error && err.name === 'ConfigError') throw err;
      // Network error or timeout. Name only, never the request.
      return {
        kind: 'unavailable',
        status: null,
        message: err instanceof Error && err.name === 'TimeoutError' ? 'The ITA did not answer in time.' : 'The ITA could not be reached.',
      };
    }
  }
}
