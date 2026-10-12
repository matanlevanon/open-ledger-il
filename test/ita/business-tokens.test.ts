import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { createItaModule } from '../../src/modules/ita';
import { ItaAllocationService } from '../../src/modules/ita/service';
import { setupIta } from './helpers';

/**
 * R24 B6: each business keeps its own ITA login and allocation queue. The OAuth state carries the
 * business, and the callback stores the token for that business only. Business 1's login, sealed
 * before businesses existed, keeps working untouched.
 */
const B2 = 2;

beforeAll(async () => {
  await run(env.DB, "INSERT OR IGNORE INTO users (email, role) VALUES ('owner@example.com', 'owner')");
  await run(env.DB, "INSERT INTO businesses (id, name_en, name_he, tax_id, entity_type) VALUES (?, 'Second Ltd', 'שנייה', '515555555', 'company')", B2);
  await run(
    env.DB,
    "INSERT OR IGNORE INTO user_businesses (user_id, business_id, role) SELECT id, ?, 'owner' FROM users WHERE email = 'owner@example.com'",
    B2,
  );
});

async function tokenRows() {
  return all<{ business_id: number; rotation: number; refresh_token_enc: string }>(
    env.DB,
    'SELECT business_id, rotation, refresh_token_enc FROM ita_tokens ORDER BY business_id',
  );
}

describe('ITA login per business', () => {
  it('a second business connects on its own row and leaves business 1 as it was', async () => {
    const ctx = await setupIta();
    const before = await tokenRows();
    const second = new ItaAllocationService(ctx.env, ctx.deps, B2);
    expect((await second.tokens.status()).connected).toBe(false);

    await second.tokens.exchangeCode(ctx.mock.issueCode(), 'https://ledger.test/api/ita/callback', null);
    expect((await second.tokens.status()).connected).toBe(true);
    const after = await tokenRows();
    expect(after.find((r) => r.business_id === 1)).toEqual(before.find((r) => r.business_id === 1));
    expect(after.find((r) => r.business_id === B2)).toBeDefined();

    // Each reads its own token. Business 1's sealed context is unchanged, so it still opens.
    expect(await ctx.service.tokens.accessToken()).toMatch(/^at-/);
    expect(await second.tokens.accessToken()).toMatch(/^at-/);
  });

  it('the OAuth state carries the business, and the callback stores the token there only', async () => {
    const ctx = await setupIta({ connect: false });
    await run(env.DB, 'DELETE FROM ita_tokens WHERE business_id = ?', B2);
    const app = createApp({ modules: [createItaModule(ctx.deps)] });
    const call = (path: string, businessId: number) =>
      app.request(`https://ledger.test/api/ita${path}`, { headers: { 'X-Business-Id': String(businessId) } }, { ...ctx.env, DEV_AUTH_EMAIL: 'owner@example.com' });

    const start = await call('/connect', B2);
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    expect((await first<{ business_id: number }>(env.DB, 'SELECT business_id FROM ita_oauth_states WHERE state = ?', state))?.business_id).toBe(B2);

    // The browser comes back without the header. The state, not the request, picks the business.
    const back = await app.request(
      `https://ledger.test/api/ita/callback?code=${ctx.mock.issueCode()}&state=${state}`,
      {},
      { ...ctx.env, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(back.headers.get('Location')).toBe('/ita?connected=1');
    expect((await first(env.DB, 'SELECT 1 FROM ita_tokens WHERE business_id = ?', B2))).not.toBeNull();
  });

  it('a business sends its own VAT number, the user id stays the owner', async () => {
    const ctx = await setupIta();
    const second = new ItaAllocationService(ctx.env, ctx.deps, B2);
    const identity = await (second as unknown as { identity(): Promise<{ vatNumber: string; userId: string }> }).identity();
    expect(identity.vatNumber).toBe('515555555');
    expect(identity.userId).toBe(ctx.env.OWNER_TAX_ID);
  });
});
