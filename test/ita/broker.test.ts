import { describe, expect, it } from 'vitest';
import { itaManualMode } from '../../src/modules/ita/config';
import { MemoryAllocationDocuments } from '../../src/modules/ita/fake-documents';
import { type ItaDeps, ItaAllocationService } from '../../src/modules/ita/service';
import { MemoryNotifier, MockIta } from '../mocks/ita';
import { insertDocumentRow, itaEnv, makeClock } from './helpers';

const BROKER = 'https://auth.broker.test';
const KEY = 'acme-key';

/**
 * A stand-in for tools/ita-auth: checks the install's key, adds the app credentials and its own
 * redirect address, and forwards the token call to the mock ITA.
 */
function setup(key = KEY) {
  const clock = makeClock();
  const mock = new MockIta(clock.now);
  const brokerCalls: { headers: Headers; body: URLSearchParams }[] = [];
  const brokerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${BROKER}/token`) return mock.fetch(input, init);
    const headers = new Headers(init?.headers);
    const body = new URLSearchParams(String(init?.body ?? ''));
    brokerCalls.push({ headers, body });
    if (headers.get('X-Ita-Broker-Client') !== 'acme' || headers.get('X-Ita-Broker-Key') !== KEY) {
      return new Response(JSON.stringify({ broker_error: 'Unknown client or wrong key.' }), { status: 401 });
    }
    const itaEnvName = body.get('environment') === 'production' ? 'production' : 'tsandbox';
    const forward = new URLSearchParams(body);
    forward.delete('environment');
    forward.set('scope', 'scope');
    if (forward.get('grant_type') === 'authorization_code') forward.set('redirect_uri', `${BROKER}/callback`);
    return mock.fetch(`https://ita-api.taxes.gov.il/shaam/${itaEnvName}/longtimetoken/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa('client-id:client-secret')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: forward.toString(),
    });
  }) as typeof globalThis.fetch;
  const notifier = new MemoryNotifier();
  const docs = new MemoryAllocationDocuments(() => insertDocumentRow('draft'));
  const deps: ItaDeps = { fetch: brokerFetch, now: clock.now, notifier: () => notifier, documents: () => docs };
  const env = itaEnv({
    ITA_CLIENT_ID_SANDBOX: undefined,
    ITA_CLIENT_SECRET_SANDBOX: undefined,
    ITA_BROKER_URL: `${BROKER}/`,
    ITA_BROKER_CLIENT: 'acme',
    ITA_BROKER_KEY: key,
  });
  return { mock, brokerCalls, env, service: new ItaAllocationService(env, deps) };
}

describe('login broker: no ITA app of its own', () => {
  it('is not manual mode, and the sign-in starts at the broker', () => {
    const { env, service } = setup();
    expect(itaManualMode(env)).toBe(false);
    const url = new URL(service.tokens.authorizeUrl('state-1', 'https://ledger.test/api/ita/callback'));
    expect(`${url.origin}${url.pathname}`).toBe(`${BROKER}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ client: 'acme', environment: 'sandbox', state: 'state-1' });
  });

  it('trades the code and renews through the broker, and never sends a client secret', async () => {
    const { mock, brokerCalls, service } = setup();
    await service.tokens.exchangeCode(mock.issueCode(), 'https://ledger.test/api/ita/callback', null);
    expect(await service.tokens.status()).toMatchObject({ connected: true, status: 'active' });
    await service.tokens.refresh();
    expect(mock.tokenCalls.map((c) => [c.grant, c.status])).toEqual([
      ['authorization_code', 200],
      ['refresh_token', 200],
    ]);
    expect(brokerCalls.map((c) => c.body.get('environment'))).toEqual(['sandbox', 'sandbox']);
    for (const call of brokerCalls) {
      expect(call.headers.get('Authorization')).toBeNull();
      expect(call.body.has('client_secret')).toBe(false);
      expect(call.body.has('client_id')).toBe(false);
    }
  });

  it('a wrong broker key is a setup error, not a refused login', async () => {
    const { mock, service } = setup('wrong-key');
    await expect(service.tokens.exchangeCode(mock.issueCode(), 'https://ledger.test/api/ita/callback', null)).rejects.toThrow(
      'The ITA login broker refused the call: Unknown client or wrong key.',
    );
    expect(mock.tokenCalls).toHaveLength(0);
  });
});
