import { describe, expect, it } from 'vitest';
import { ITA_PATHS, ITA_URLS, relayedFetch } from '../../src/modules/ita/config';
import { ItaClient } from '../../src/modules/ita/client';
import type { ItaTokenStore } from '../../src/modules/ita/tokens';
import { itaEnv } from './helpers';

/** Records every outgoing call instead of reaching the network. */
function recorder() {
  const calls: { url: string; headers: Headers; method: string }[] = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers), method: init?.method ?? 'GET' });
    return Response.json({ status: 'ok' });
  }) as typeof fetch;
  return { calls, base };
}

const RELAY = { ITA_RELAY_URL: 'https://relay.example.test', ITA_RELAY_CLIENT_ID: 'relay-id', ITA_RELAY_CLIENT_SECRET: 'relay-secret' };
const BROKER = { ITA_BROKER_URL: 'https://auth.broker.test/', ITA_BROKER_CLIENT: 'acme', ITA_BROKER_KEY: 'acme-key' };

describe('Tax Authority call routing (R31)', () => {
  it('a broker install sends every ITA call to the broker, with its name and key, and ignores the relay', async () => {
    const { calls, base } = recorder();
    const f = relayedFetch(itaEnv({ ...RELAY, ...BROKER }), base);
    await f('https://ita-api.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval?x=1', { method: 'POST', headers: { Authorization: 'Bearer t' } });
    await f('https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize');
    expect(calls.map((c) => c.url)).toEqual([
      'https://auth.broker.test/ita/ita-api/shaam/tsandbox/Invoices/v2/Approval?x=1',
      'https://auth.broker.test/ita/openapi/shaam/production/longtimetoken/oauth2/authorize',
    ]);
    expect(calls[0]!.headers.get('X-Ita-Client')).toBe('acme');
    expect(calls[0]!.headers.get('X-Ita-Client-Key')).toBe('acme-key');
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer t');
    expect(calls[0]!.headers.get('CF-Access-Client-Id')).toBeNull();
    expect(calls[0]!.headers.get('CF-Access-Client-Secret')).toBeNull();
  });

  it('a broker install sends invoice approvals through the broker', async () => {
    const { calls, base } = recorder();
    const tokens = { environment: 'sandbox', accessToken: async () => 'access-1' } as unknown as ItaTokenStore;
    const client = new ItaClient(itaEnv(BROKER), tokens, { fetch: base, now: () => new Date() });
    const res = await client.post(ITA_PATHS.approval, { invoice_id: '1' });
    expect(res.kind).toBe('response');
    expect(calls[0]!.url).toBe(`https://auth.broker.test/ita/ita-api/shaam/tsandbox/${ITA_PATHS.approval}`);
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer access-1');
    expect(calls[0]!.headers.get('X-Ita-Client')).toBe('acme');
  });

  it('an install with its own relay keeps the relay, unchanged', async () => {
    const { calls, base } = recorder();
    await relayedFetch(itaEnv(RELAY), base)(`${ITA_URLS.sandbox.api}${ITA_PATHS.approval}`, { method: 'POST' });
    expect(calls[0]!.url).toBe(`https://relay.example.test/ita-api/shaam/tsandbox/${ITA_PATHS.approval}`);
    expect(calls[0]!.headers.get('CF-Access-Client-Id')).toBe('relay-id');
    expect(calls[0]!.headers.get('X-Ita-Client')).toBeNull();
  });

  it('an install with its own ITA app and no relay calls the Tax Authority directly', async () => {
    const { calls, base } = recorder();
    await relayedFetch(itaEnv(), base)(`${ITA_URLS.sandbox.api}${ITA_PATHS.approval}`, { method: 'POST' });
    expect(calls[0]!.url).toBe(`${ITA_URLS.sandbox.api}${ITA_PATHS.approval}`);
    expect(calls[0]!.headers.get('X-Ita-Client')).toBeNull();
  });

  it('other hosts are never sent to the broker', async () => {
    const { calls, base } = recorder();
    await relayedFetch(itaEnv(BROKER), base)('https://example.com/x');
    expect(calls[0]!.url).toBe('https://example.com/x');
    expect(calls[0]!.headers.get('X-Ita-Client-Key')).toBeNull();
  });
});
