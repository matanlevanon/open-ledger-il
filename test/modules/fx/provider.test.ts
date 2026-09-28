import { describe, expect, it } from 'vitest';
import { BoiFxProvider, FakeFxProvider, FxProviderError } from '../../../src/modules/fx/provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('fx: BoiFxProvider', () => {
  it('parses the BOI response into a normalized rate and its published date', async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      expect(String(input)).toContain('key=USD');
      return jsonResponse({ key: 'USD', currentExchangeRate: 3.712, unit: 1, lastUpdate: '2026-10-02T13:45:01.123Z' });
    };
    const provider = new BoiFxProvider(fetchImpl as typeof fetch);
    expect(await provider.rateFor('USD', '2026-10-02')).toEqual({ rate: '3.712000', rateDate: '2026-10-02', source: 'boi' });
  });

  it('divides by unit when the API quotes a currency per multiple units', async () => {
    // None of USD, EUR, GBP are quoted per multiple units, but the BOI response shape allows
    // it for currencies added later (for example JPY, unit 100), so the arithmetic is covered.
    const fetchImpl = async () => jsonResponse({ key: 'USD', currentExchangeRate: 245.0, unit: 100, lastUpdate: '2026-10-02T13:45:01Z' });
    const provider = new BoiFxProvider(fetchImpl as typeof fetch);
    expect((await provider.rateFor('USD', '2026-10-02')).rate).toBe('2.450000');
  });

  it('raises FxProviderError on a non-ok response, a bad body or a network failure', async () => {
    const notOk = new BoiFxProvider((async () => jsonResponse({}, 503)) as unknown as typeof fetch);
    await expect(notOk.rateFor('USD', '2026-10-02')).rejects.toBeInstanceOf(FxProviderError);

    const badBody = new BoiFxProvider((async () => jsonResponse({ key: 'USD' })) as unknown as typeof fetch);
    await expect(badBody.rateFor('USD', '2026-10-02')).rejects.toBeInstanceOf(FxProviderError);

    const networkDown = new BoiFxProvider((async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch);
    await expect(networkDown.rateFor('USD', '2026-10-02')).rejects.toBeInstanceOf(FxProviderError);
  });
});

describe('fx: FakeFxProvider', () => {
  it('returns the fixture rate for a currency', async () => {
    const provider = new FakeFxProvider({ USD: { rate: '3.712000', rateDate: '2026-10-02', source: 'boi' } });
    expect(await provider.rateFor('USD', '2026-10-02')).toEqual({ rate: '3.712000', rateDate: '2026-10-02', source: 'boi' });
  });

  it('supports a fixture keyed by the requested date', async () => {
    const provider = new FakeFxProvider({ USD: (date) => ({ rate: '3.700000', rateDate: date, source: 'boi' }) });
    expect((await provider.rateFor('USD', '2026-10-05')).rateDate).toBe('2026-10-05');
  });

  it('raises FxProviderError for a currency with no fixture, and never calls the network', async () => {
    const provider = new FakeFxProvider({});
    await expect(provider.rateFor('USD', '2026-10-02')).rejects.toBeInstanceOf(FxProviderError);
  });
});
