import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDocumentsModule } from '../../../src/modules/documents';
import { createPaymentMethodsModule } from '../../../src/modules/payment-methods';
import { createRecurringModule, nextRunDate } from '../../../src/modules/recurring';
import { ceiling, clock, fx } from '../../documents/helpers';

const sent: number[] = [];
const options = { fx: () => fx, ceiling, today: () => clock.today };
const app = createApp({
  modules: [
    createClientsModule({ today: () => clock.today }),
    createDocumentsModule(options),
    createPaymentMethodsModule(),
    createRecurringModule({ documentsOptions: options, send: () => async (id) => void sent.push(id) }),
  ],
});

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  const json = await res.json();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function template(): Promise<number> {
  const client = (await call('POST', '/clients', { nameEn: `Recurring ${crypto.randomUUID().slice(0, 6)}` })).client.id;
  const draft = await call('POST', '/documents', { type: 'PR', clientId: client, lines: [{ description: 'Retainer', unitPriceMinor: 100000, quantityMilli: 1000 }] });
  const final = await call('POST', `/documents/${draft.document.id}/finalize`, {});
  return final.document.id;
}

describe('nextRunDate', () => {
  it('keeps the day of the month and falls on the last day of a shorter month', () => {
    expect(nextRunDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(nextRunDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(nextRunDate('2026-11-15', 'quarterly', 15)).toBe('2027-02-15');
    expect(nextRunDate('2026-12-29', 'weekly', 29)).toBe('2027-01-05');
    expect(nextRunDate('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
  });
});

describe('recurring documents', () => {
  it('issues and sends automatically, once per run date', async () => {
    const templateId = await template();
    await call('POST', '/recurring', { templateDocumentId: templateId, frequency: 'monthly', startDate: clock.today, mode: 'auto', sendEmail: true });
    const first = await call('POST', '/recurring/run-due');
    const run = first.runs.find((r: any) => r.document_id && r.run_date === clock.today && sent.includes(r.document_id));
    expect(run).toMatchObject({ status: 'sent', document_status: 'final' });
    const schedule = first.schedules.find((s: any) => s.template_document_id === templateId);
    expect(schedule.next_run_date > clock.today).toBe(true);

    const again = await call('POST', '/recurring/run-due');
    expect(again.runs.filter((r: any) => r.schedule_id === schedule.id)).toHaveLength(1);
  });

  it('holds a draft for approval, then issues it on approve', async () => {
    const templateId = await template();
    await call('POST', '/recurring', { templateDocumentId: templateId, frequency: 'monthly', startDate: clock.today, mode: 'approve', sendEmail: false });
    const state = await call('POST', '/recurring/run-due');
    const schedule = state.schedules.find((s: any) => s.template_document_id === templateId);
    const pending = state.runs.find((r: any) => r.schedule_id === schedule.id);
    expect(pending).toMatchObject({ status: 'pending_approval', document_status: 'draft' });

    const after = await call('POST', `/recurring/runs/${pending.id}/approve`);
    expect(after.runs.find((r: any) => r.id === pending.id)).toMatchObject({ status: 'issued', document_status: 'final' });
  });

  it('skips a run and deletes its draft', async () => {
    const templateId = await template();
    await call('POST', '/recurring', { templateDocumentId: templateId, frequency: 'weekly', startDate: clock.today, mode: 'approve', sendEmail: true });
    const state = await call('POST', '/recurring/run-due');
    const schedule = state.schedules.find((s: any) => s.template_document_id === templateId);
    const pending = state.runs.find((r: any) => r.schedule_id === schedule.id);
    const draftId = pending.document_id;
    const after = await call('POST', `/recurring/runs/${pending.id}/skip`);
    expect(after.runs.find((r: any) => r.id === pending.id)).toMatchObject({ status: 'skipped', document_id: null });
    const res = await app.request(`/api/documents/${draftId}`, {}, { ...env, DEV_AUTH_EMAIL: 'owner@example.com' });
    expect(res.status).toBe(404);
  });
});
