import { describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { db, sqlError } from '../../helpers';
import { TODAY, businessTypeApp, call } from './business-type-helpers';

/**
 * R24 Phase A4: a company starts on a fresh פטור Ledger, VAT registered from its first day.
 * The tests run in order: the company starts once, then every way back is refused.
 */
describe('POST /api/legal-mode/start-company', () => {
  const app = businessTypeApp();

  it('refuses an accountant', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(db(), `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    const res = await call(app, 'POST', '/legal-mode/start-company', {}, { DEV_AUTH_EMAIL: email });
    expect(res.status).toBe(403);
  });

  it('starts a company: מורשה from today, no VAT office task, the same series as the switch', async () => {
    const res = await call(app, 'POST', '/legal-mode/start-company', {});
    expect(res.status).toBe(200);
    expect(res.body.entityType).toBe('company');
    expect(res.body.effectiveDate).toBe(TODAY);
    expect(res.body.vatOfficeTaskDueAt).toBeNull();
    expect(res.body.seriesOpened).toEqual(['305', '320', '330', '332', '400-M']);

    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('company');
    const modes = await all<{ mode: string; effective_from: string; note: string }>(db(), "SELECT mode, effective_from, note FROM legal_modes WHERE mode = 'murshe'");
    expect(modes).toEqual([{ mode: 'murshe', effective_from: TODAY, note: 'already registered' }]);
    expect(await all(db(), "SELECT id FROM tasks WHERE kind = 'vat_office_notice'")).toHaveLength(0);
    const audit = await first<{ action: string }>(db(), "SELECT action FROM audit_log WHERE action = 'legal_mode.company_started'");
    expect(audit?.action).toBe('legal_mode.company_started');
  });

  it('refuses a second start and any switch afterwards', async () => {
    expect((await call(app, 'POST', '/legal-mode/start-company', {})).status).toBe(409);
    expect((await call(app, 'POST', '/legal-mode/switch', { kind: 'registered' })).status).toBe(409);
    expect((await call(app, 'POST', '/legal-mode/switch', { effectiveDate: TODAY })).status).toBe(409);
  });

  it('raw SQL cannot take a company back to פטור or to מורשה', async () => {
    expect(await sqlError("UPDATE business_profile SET entity_type = 'osek_patur' WHERE id = 1")).toContain('entity_type_locked');
    expect(await sqlError("UPDATE business_profile SET entity_type = 'osek_murshe' WHERE id = 1")).toContain('entity_type_locked');
  });

  it('status shows a company with no ceiling card', async () => {
    const res = await call(app, 'GET', '/legal-mode/status');
    expect(res.body).toMatchObject({ entityType: 'company', showCeiling: false, vatReporting: 'bimonthly', setupBusinessType: null });
  });

  it('the dashboard shows the VAT card and hides the ceiling, also from Customize', async () => {
    const dash = await call(app, 'GET', '/dashboard?cards=vat,ceiling');
    expect(dash.body.businessType).toEqual({ entityType: 'company', showCeiling: false });
    expect(dash.body.ceiling).toBeNull();
    expect(dash.body.vatDue.applicable).toBe(true);
    expect(dash.body.vatDue.period.reportDue).toMatch(/^\d{4}-\d{2}-15$/);
    const layout = await call(app, 'GET', '/dashboard/layout');
    expect(layout.body.unavailable).toEqual(['ceiling']);
  });

  it('VAT due is output VAT of final tax documents minus reclaimable input VAT, in ILS', async () => {
    const { lastRowId } = await run(
      db(),
      `INSERT INTO documents (type, series_id, legal_mode, date, currency, subtotal_minor, vat_rate_bp, vat_amount_minor, total_minor)
       VALUES ('305', '305', 'murshe', ?, 'ILS', 100000, 1800, 18000, 118000)`,
      TODAY,
    );
    const { finalizeDocument } = await import('../../../src/core/numbering');
    const { OWNER_ACTOR } = await import('../../helpers');
    await finalizeDocument(db(), lastRowId, { actor: OWNER_ACTOR });
    // A draft never counts.
    await run(
      db(),
      `INSERT INTO documents (type, series_id, legal_mode, date, currency, subtotal_minor, vat_amount_minor, total_minor)
       VALUES ('305', '305', 'murshe', ?, 'ILS', 50000, 9000, 59000)`,
      TODAY,
    );
    const { lastRowId: fileId } = await run(
      db(),
      `INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256) VALUES ('upload', ?, 'a.pdf', 'application/pdf', 1, ?)`,
      `expenses/${crypto.randomUUID()}.pdf`,
      crypto.randomUUID(),
    );
    await run(
      db(),
      `INSERT INTO expenses (file_id, status, document_date, currency, amount_minor, vat_amount_minor, input_vat_reclaimable)
       VALUES (?, 'filed', ?, 'USD', 11800, 1800, 1), (?, 'filed', ?, 'ILS', 5900, 900, 0)`,
      fileId,
      TODAY,
      fileId,
      TODAY,
    );
    await run(db(), "UPDATE expenses SET fx_rate = '3.500000' WHERE currency = 'USD'");

    const dash = await call(app, 'GET', '/dashboard?cards=vat');
    // 18,000 output minus 1,800 USD cents at 3.5 = 6,300 agorot. The non-reclaimable 900 is left out.
    expect(dash.body.vatDue).toMatchObject({ outputMinor: 18000, inputMinor: 6300, amountMinor: 11700, currency: 'ILS' });
  });
});
