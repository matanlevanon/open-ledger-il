import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first } from '../../src/core/db';
import { ITA_PATHS } from '../../src/modules/ita/config';
import { ItaReconnectError } from '../../src/modules/ita/errors';
import { setupIta } from './helpers';

const MIN = 60_000;
const DAY = 86_400_000;

async function tokenRow(environment = 'sandbox') {
  return first<Record<string, unknown>>(env.DB, 'SELECT * FROM ita_tokens WHERE environment = ?', environment);
}

describe('ITA OAuth2 tokens', () => {
  it('token exchange stores both tokens encrypted, never in plain text', async () => {
    const { service, mock } = await setupIta();
    const row = await tokenRow();
    expect(row?.status).toBe('active');
    expect(String(row?.refresh_token_enc)).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toMatch(/"rt-\d+"|"at-\d+"/);
    expect(mock.tokenCalls.at(-1)).toMatchObject({ grant: 'authorization_code', status: 200 });
    const status = await service.tokens.status();
    expect(status).toMatchObject({ connected: true, days_since_login: 0, days_until_relogin: 90 });
  });

  it('reuses the access token until it is about to expire', async () => {
    const { service, mock } = await setupIta();
    const a = await service.tokens.accessToken();
    const b = await service.tokens.accessToken();
    expect(a).toBe(b);
    expect(mock.tokenCalls.filter((c) => c.grant === 'refresh_token')).toHaveLength(0);
  });

  it('refresh rotates the refresh token: the old one stops working', async () => {
    const { service, mock, clock } = await setupIta();
    const before = (await tokenRow())!;
    clock.advance(11 * MIN);
    const access = await service.tokens.accessToken();
    const after = (await tokenRow())!;
    expect(access).toMatch(/^at-/);
    expect(after.refresh_token_enc).not.toBe(before.refresh_token_enc);
    expect(Number(after.rotation)).toBe(Number(before.rotation) + 1);
    expect(mock.tokenCalls.at(-1)).toMatchObject({ grant: 'refresh_token', status: 200 });
    // The re-login date stays tied to the interactive login.
    expect(after.relogin_due_at).toBe(before.relogin_due_at);

    clock.advance(11 * MIN);
    await service.tokens.accessToken();
    expect(mock.tokenCalls.filter((c) => c.grant === 'refresh_token' && c.status === 200)).toHaveLength(2);
  });

  it('a refused refresh token flags "Reconnect to ITA"', async () => {
    const { service, mock, clock } = await setupIta();
    mock.revokeRefreshTokens();
    clock.advance(11 * MIN);
    await expect(service.tokens.accessToken()).rejects.toBeInstanceOf(ItaReconnectError);
    expect((await tokenRow())?.status).toBe('reconnect_required');
    expect((await service.tokens.status()).connected).toBe(false);
  });

  it('after 90 days the login expires without calling the ITA', async () => {
    const { service, mock, clock } = await setupIta();
    clock.advance(91 * DAY);
    const calls = mock.tokenCalls.length;
    await expect(service.tokens.accessToken()).rejects.toBeInstanceOf(ItaReconnectError);
    expect(mock.tokenCalls).toHaveLength(calls);
  });

  it('401 on an API call refreshes once and retries once', async () => {
    const { service, mock, addInvoice } = await setupIta();
    const doc = await addInvoice();
    mock.revokeAccessTokens();
    const result = await service.request(doc.id, { userId: null, email: 'owner@example.com', role: 'owner', ip: null, userAgent: null });
    expect(result.status).toBe('approved');
    const approvals = mock.apiCalls(ITA_PATHS.approval);
    expect(approvals.map((c) => c.status)).toEqual([401, 200]);
    expect(mock.tokenCalls.filter((c) => c.grant === 'refresh_token')).toHaveLength(1);
  });

  it('401 again after the refresh flags reconnect and queues the document', async () => {
    const { service, mock, addInvoice, docs } = await setupIta();
    const doc = await addInvoice();
    mock.revokeAccessTokens();
    mock.forceNext(401);
    // The forced 401 answers the retry. The first call fails on the revoked token.
    const result = await service.request(doc.id, { userId: null, email: null, role: 'owner', ip: null, userAgent: null });
    expect(result).toMatchObject({ status: 'pending', outcome: 'unauthorized', error_code: 'http_401' });
    expect((await tokenRow())?.status).toBe('reconnect_required');
    expect((await docs.get(doc.id))?.status).toBe('allocation_pending');
  });

  it('sandbox and production credentials never mix', async () => {
    const sandbox = await setupIta();
    const prod = await setupIta({ envOverrides: { ITA_ENV: 'production' } });
    expect(sandbox.service.tokens.environment).toBe('sandbox');
    expect(prod.service.tokens.environment).toBe('production');
    expect(prod.mock.tokenCalls.at(-1)).toMatchObject({ env: 'production', status: 200 });
    // Each environment has its own row and its own client id.
    expect(await tokenRow('production')).not.toBeNull();
    const url = new URL(prod.service.tokens.authorizeUrl('s', 'https://x/cb'));
    expect(url.pathname).toContain('/shaam/production/');
    expect(url.searchParams.get('client_id')).toBe('prod-client-id');
    expect(url.searchParams.get('scope')).toBe('scope');
    const sandboxUrl = new URL(sandbox.service.tokens.authorizeUrl('s', 'https://x/cb'));
    expect(sandboxUrl.pathname).toContain('/shaam/tsandbox/');
    expect(sandboxUrl.searchParams.get('client_id')).toBe('client-id');
  });

  it('a token that no longer decrypts asks for a new login', async () => {
    const { mock, deps, env: ienv } = await setupIta();
    const otherKey = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 7)));
    const { ItaTokenStore } = await import('../../src/modules/ita/tokens');
    const store = new ItaTokenStore({ ...ienv, ITA_TOKEN_KEY: otherKey }, deps);
    await expect(store.accessToken()).rejects.toBeInstanceOf(ItaReconnectError);
    expect((await tokenRow())?.status).toBe('reconnect_required');
    expect(mock.tokenCalls.filter((c) => c.grant === 'refresh_token')).toHaveLength(0);
  });

  it('a missing client secret is a config error that names the environment', async () => {
    const { service, mock } = await setupIta({ connect: false, envOverrides: { ITA_CLIENT_SECRET_SANDBOX: undefined } });
    await expect(service.tokens.exchangeCode(mock.issueCode(), 'https://x/cb', null)).rejects.toThrow(/ITA_CLIENT_SECRET_SANDBOX/);
  });
});
