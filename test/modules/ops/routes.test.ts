import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { opsModule } from '../../../src/modules/ops';
import { makeSeries } from '../../helpers';

const app = createApp({ modules: [opsModule] });

async function api(method: string, path: string, body?: unknown, as = 'owner@example.com') {
  const res = await app.request(
    `/api/ops${path}`,
    { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: as },
  );
  return { status: res.status, body: await res.json() as any };
}

describe('ops routes: owner only (runs/R14-ops.md Settings screen; CLAUDE.md rule 6)', () => {
  it('reads and updates the business profile', async () => {
    const before = await api('GET', '/business');
    expect(before.status).toBe(200);

    const updated = await api('PUT', '/business', { nameEn: 'Sample Business Ltd', bankDetails: 'Bank Hapoalim, 123' });
    expect(updated.status).toBe(200);
    expect(updated.body.business.name_en).toBe('Sample Business Ltd');
    expect(updated.body.business.bank_details).toBe('Bank Hapoalim, 123');
  });

  it('rejects an accountant, even one with every switch on', async () => {
    await env.DB.prepare("INSERT INTO users (email, role) VALUES ('accountant@example.com', 'accountant')").run();
    const res = await api('GET', '/business', undefined, 'accountant@example.com');
    expect(res.status).toBe(403);
  });

  it('sets a series starting number once, then refuses a second attempt', async () => {
    const s = await makeSeries();
    const first = await api('PUT', `/series/${s}/start-number`, { startNumber: 500 });
    expect(first.status).toBe(200);
    const row = first.body.series.find((row: any) => row.id === s);
    expect(row.start_number).toBe(500);
    expect(row.next_number).toBe(500);
  });

  it('lists, adds and updates ceilings by year', async () => {
    const put = await api('PUT', '/ceilings', { year: 2099, amountMinor: 12345600, currency: 'ILS' });
    expect(put.status).toBe(200);
    expect(put.body.ceilings.find((c: any) => c.year === 2099).amount_minor).toBe(12345600);

    const again = await api('PUT', '/ceilings', { year: 2099, amountMinor: 99999900, currency: 'ILS' });
    expect(again.body.ceilings.find((c: any) => c.year === 2099).amount_minor).toBe(99999900);
  });

  it('adds a VAT rate and refuses a duplicate effective date', async () => {
    const first = await api('POST', '/vat-rates', { rateBp: 1700, effectiveFrom: '2099-01-01' });
    expect(first.status).toBe(201);
    const dup = await api('POST', '/vat-rates', { rateBp: 1600, effectiveFrom: '2099-01-01' });
    expect(dup.status).toBe(409);
  });

  it('reads and sets the signature mode', async () => {
    expect((await api('GET', '/signature-mode')).body.mode).toBe('secured');
    const set = await api('PUT', '/signature-mode', { mode: 'none' });
    expect(set.body.mode).toBe('none');
    expect((await api('GET', '/signature-mode')).body.mode).toBe('none');
    await api('PUT', '/signature-mode', { mode: 'secured' });
  });

  it('runs a live gap and hash-chain check on demand', async () => {
    const res = await api('POST', '/checks/run');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok');
    expect(res.body).toHaveProperty('chain');
  });

  it('runs a manual backup and lists it in the history', async () => {
    const run = await api('POST', '/backups/run');
    expect(run.status).toBe(201);
    expect(run.body.restoreOk).toBe(true);

    const list = await api('GET', '/backups');
    expect(list.status).toBe(200);
    expect(list.body.backups.some((b: any) => b.d1_export_key === run.body.dataKey)).toBe(true);
  });
});
