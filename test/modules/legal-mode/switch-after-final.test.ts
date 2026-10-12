import { describe, expect, it } from 'vitest';
import { all, first } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { OWNER_ACTOR, db, makeDraft, makeSeries } from '../../helpers';
import { TODAY, businessTypeApp, call } from './business-type-helpers';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * R24 Phase A3 and A4: once a final document exists, "already registered" and a company are
 * refused. `becoming` still works, adds the VAT office task and sets the type. In order.
 */
describe('the switch after the first final document', () => {
  const app = businessTypeApp();

  it('records a final document', async () => {
    await finalizeDocument(db(), await makeDraft({ seriesId: await makeSeries() }), { actor: OWNER_ACTOR });
    expect((await call(app, 'GET', '/legal-mode/status')).body.fresh).toBe(false);
  });

  it('refuses registered and start-company', async () => {
    const registered = await call(app, 'POST', '/legal-mode/switch', { kind: 'registered' });
    expect(registered.status).toBe(409);
    expect(registered.body.error.code).toBe('ledger_not_fresh');
    const company = await call(app, 'POST', '/legal-mode/start-company', {});
    expect(company.status).toBe(409);
    expect(company.body.error.code).toBe('ledger_not_fresh');
    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('osek_patur');
  });

  it('becoming needs a start date', async () => {
    expect((await call(app, 'POST', '/legal-mode/switch', { kind: 'becoming' })).status).toBe(400);
  });

  it('becoming switches on the chosen date, adds the VAT office task and sets the type', async () => {
    const res = await call(app, 'POST', '/legal-mode/switch', { kind: 'becoming', effectiveDate: TODAY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entityType: 'osek_murshe', vatOfficeTaskDueAt: addDays(TODAY, 15) });
    expect(await all(db(), "SELECT id FROM tasks WHERE kind = 'vat_office_notice'")).toHaveLength(1);
    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('osek_murshe');
  });

  it('a מורשה that switched from פטור keeps the ceiling card in the year of the switch', async () => {
    const dash = await call(app, 'GET', '/dashboard?cards=vat,ceiling');
    expect(dash.body.businessType).toEqual({ entityType: 'osek_murshe', showCeiling: true });
    expect(dash.body.vatDue.applicable).toBe(true);
  });

  it('refuses a second switch of either kind', async () => {
    expect((await call(app, 'POST', '/legal-mode/switch', { effectiveDate: TODAY })).status).toBe(409);
    expect((await call(app, 'POST', '/legal-mode/switch', { kind: 'registered' })).status).toBe(409);
  });
});
