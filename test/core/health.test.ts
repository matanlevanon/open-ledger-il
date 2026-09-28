import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('health', () => {
  it('answers without sign-in', async () => {
    const res = await exports.default.fetch('https://ledger.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
