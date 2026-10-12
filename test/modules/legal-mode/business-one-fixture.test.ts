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
    const profileColumns = 'id, name_en, name_he, address_en, address_he, email, phone, website, bank_details, logo_r2_key, tax_id, updated_at';
    const tables: [string, string][] = [
      ['business_profile', profileColumns],
      ['legal_modes', '*'],
      ['series', '*'],
      ['clients', '*'],
      ['vat_rates', '*'],
      ['ceilings', '*'],
    ];
    const was = await Promise.all(tables.map(([t, c]) => snapshot(t, c)));

    await applyD1Migrations(scratch(), r24);

    const now = await Promise.all(tables.map(([t, c]) => snapshot(t, c)));
    expect(now).toEqual(was);
    const added = await scratch().prepare('SELECT entity_type, vat_reporting FROM business_profile WHERE id = 1').first();
    expect(added).toEqual({ entity_type: 'osek_murshe', vat_reporting: 'bimonthly' });
  });
});
