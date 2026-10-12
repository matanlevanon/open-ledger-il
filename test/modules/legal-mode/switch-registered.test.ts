import { describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { db } from '../../helpers';
import { TODAY, businessTypeApp, call } from './business-type-helpers';

/** R24 Phase A3: the `registered` flavour, for a business that was מורשה before the Ledger. In order. */
describe('POST /api/legal-mode/switch with kind registered', () => {
  const app = businessTypeApp();

  it('SETUP_BUSINESS_TYPE preselects the first-run step while setup is incomplete', async () => {
    await run(db(), "UPDATE business_profile SET name_en = '' WHERE id = 1");
    const res = await call(app, 'GET', '/legal-mode/status', undefined, { SETUP_BUSINESS_TYPE: 'osek_murshe' });
    expect(res.body).toMatchObject({ entityType: 'osek_patur', fresh: true, setupBusinessType: 'osek_murshe', showCeiling: true });
    const bogus = await call(app, 'GET', '/legal-mode/status', undefined, { SETUP_BUSINESS_TYPE: 'llc' });
    expect(bogus.body.setupBusinessType).toBeNull();
  });

  it('SETUP_BUSINESS_TYPE is ignored once setup is complete', async () => {
    await run(db(), "UPDATE business_profile SET name_en = 'Sample', name_he = 'דוגמה', tax_id = '123456782', address_en = 'Tel Aviv' WHERE id = 1");
    const res = await call(app, 'GET', '/legal-mode/status', undefined, { SETUP_BUSINESS_TYPE: 'company' });
    expect(res.body.setupBusinessType).toBeNull();
  });

  it('the dashboard of a פטור Ledger shows the ceiling and no VAT card', async () => {
    const dash = await call(app, 'GET', '/dashboard?cards=vat,ceiling');
    expect(dash.body.businessType).toEqual({ entityType: 'osek_patur', showCeiling: true });
    expect(dash.body.vatDue).toMatchObject({ applicable: false, period: null });
    expect((await call(app, 'GET', '/dashboard/layout')).body.unavailable).toEqual(['vat']);
  });

  it('switches from today with no VAT office task, and ignores a given date', async () => {
    const res = await call(app, 'POST', '/legal-mode/switch', { kind: 'registered', effectiveDate: '2099-01-01' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ effectiveDate: TODAY, vatOfficeTaskDueAt: null, entityType: 'osek_murshe' });
    expect(res.body.message).not.toContain('VAT office');
    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('osek_murshe');
    expect(await all(db(), "SELECT id FROM tasks WHERE kind = 'vat_office_notice'")).toHaveLength(0);
    const audit = await first<{ details: string }>(db(), "SELECT details FROM audit_log WHERE action = 'legal_mode.switch_confirmed'");
    expect(JSON.parse(audit!.details)).toMatchObject({ kind: 'registered', note: 'already registered' });
  });

  it('a registered מורשה never sees the ceiling card', async () => {
    const res = await call(app, 'GET', '/legal-mode/status');
    expect(res.body).toMatchObject({ entityType: 'osek_murshe', switchedOn: TODAY, showCeiling: false });
  });

  it('refuses a second switch and start-company', async () => {
    expect((await call(app, 'POST', '/legal-mode/switch', { kind: 'registered' })).status).toBe(409);
    expect((await call(app, 'POST', '/legal-mode/start-company', {})).status).toBe(409);
  });

  it('sets the VAT reporting frequency', async () => {
    const res = await call(app, 'PUT', '/legal-mode/vat-reporting', { vatReporting: 'monthly' });
    expect(res.body.vatReporting).toBe('monthly');
    const dash = await call(app, 'GET', '/dashboard?cards=vat');
    expect(dash.body.vatDue.period.reporting).toBe('monthly');
    expect(dash.body.vatDue.period.from).toBe(`${TODAY.slice(0, 7)}-01`);
    expect((await call(app, 'PUT', '/legal-mode/vat-reporting', { vatReporting: 'yearly' })).status).toBe(400);
  });
});
