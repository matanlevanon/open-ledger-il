import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/**
 * R24 Done-when: business 1 after every R24 migration is identical to before. The scratch database
 * is migrated to just before R24, filled like a live Ledger that already switched to מורשה, then
 * the R24 migrations run and every row is compared. Each later phase adds its migrations here.
 */
const R24_FIRST = '2400';
const scratch = () => env.SCRATCH_DB;

async function snapshot(table: string, columns: string): Promise<unknown[]> {
  return (await scratch().prepare(`SELECT ${columns} FROM ${table} ORDER BY 1`).all()).results;
}

describe('business 1 across the R24 migrations', () => {
  it('keeps every existing row and column, and backfills osek_murshe from legal_modes', async () => {
    const before = env.TEST_MIGRATIONS.filter((m) => m.name < R24_FIRST);
    const r24 = env.TEST_MIGRATIONS.filter((m) => m.name >= R24_FIRST);
    expect(r24.length).toBeGreaterThan(0);
    await applyD1Migrations(scratch(), before);

    await scratch().batch([
      scratch().prepare(
        "UPDATE business_profile SET name_en = 'Sample Business', name_he = 'עסק לדוגמה', address_en = 'Tel Aviv', tax_id = '123456782', email = 'owner@example.com' WHERE id = 1",
      ),
      scratch().prepare("INSERT INTO legal_modes (mode, effective_from, note) VALUES ('murshe', '2026-09-01', 'crossed the ceiling')"),
      scratch().prepare("INSERT INTO clients (name_en, country) VALUES ('Client One', 'IL')"),
    ]);
    // Every table that holds business 1, read through the columns it had before R24.
    const tables = ['business_profile', 'legal_modes', 'series', 'clients', 'documents', 'finalizations', 'vat_rates', 'ceilings', 'settings', 'users'];
    const columnsBefore: Record<string, string> = {};
    for (const t of tables) {
      const cols = (await scratch().prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((c) => c.name);
      columnsBefore[t] = cols.join(', ');
    }
    const was = await Promise.all(tables.map((t) => snapshot(t, columnsBefore[t]!)));

    await applyD1Migrations(scratch(), r24);

    const now = await Promise.all(tables.map((t) => snapshot(t, columnsBefore[t]!)));
    expect(now).toEqual(was);
    const added = await scratch().prepare('SELECT entity_type, vat_reporting FROM business_profile WHERE id = 1').first();
    expect(added).toEqual({ entity_type: 'osek_murshe', vat_reporting: 'bimonthly' });
    // Phase B: every existing row is business 1, with one default brand and the users' old roles.
    for (const t of ['legal_modes', 'series', 'clients', 'documents', 'finalizations']) {
      const other = await scratch().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE business_id IS NOT 1`).first<{ n: number }>();
      expect(other?.n).toBe(0);
    }
    expect(await scratch().prepare('SELECT business_id, is_default, name_en FROM brands').all().then((r) => r.results)).toEqual([
      { business_id: 1, is_default: 1, name_en: '' },
    ]);
  });
});
