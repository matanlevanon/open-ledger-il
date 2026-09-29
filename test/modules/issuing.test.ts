import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/index';
import { createClientsModule } from '../../src/modules/clients';
import { createDocumentsModule } from '../../src/modules/documents';
import { createOpsModule } from '../../src/modules/ops';
import { createPaymentMethodsModule } from '../../src/modules/payment-methods';
import { createRecurringModule } from '../../src/modules/recurring';
import { todayIsrael } from '../../src/core/db';
import { ceiling, clock, fx } from '../documents/helpers';

const options = { fx: () => fx, ceiling, today: () => clock.today };
const app = createApp({
  modules: [
    createClientsModule({ today: () => clock.today }),
    createDocumentsModule(options),
    createPaymentMethodsModule(),
    createOpsModule(),
    createRecurringModule({ documentsOptions: options, send: () => async () => undefined }),
  ],
});

async function call(method: string, path: string, body?: unknown, as = 'owner@example.com') {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: as },
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function newDraft(): Promise<number> {
  const client = (await call('POST', '/clients', { nameEn: `Issuing ${crypto.randomUUID().slice(0, 6)}` })).body.client.id;
  const draft = await call('POST', '/documents', { type: 'PR', clientId: client, lines: [{ description: 'Work', unitPriceMinor: 50000, quantityMilli: 1000 }] });
  expect(draft.status).toBe(201);
  return draft.body.document.id;
}

afterAll(async () => {
  await call('PUT', '/ops/issuing', { enabled: true });
});

describe('issuing switch', () => {
  it('is on by default and shows in /me', async () => {
    expect((await call('GET', '/ops/issuing')).body).toEqual({ enabled: true });
    expect((await call('GET', '/me')).body.user.issuing).toBe(true);
  });

  it('refuses every document change while off, and allows reading and deleting a draft', async () => {
    const draft = await newDraft();
    const spare = await newDraft();
    expect((await call('PUT', '/ops/issuing', { enabled: false })).body).toEqual({ enabled: false });
    expect((await call('GET', '/me')).body.user.issuing).toBe(false);

    const create = await call('POST', '/documents', { type: 'PR', lines: [{ description: 'x', unitPriceMinor: 100, quantityMilli: 1000 }] });
    expect(create.status).toBe(409);
    expect(create.body.error.code).toBe('issuing_off');
    expect((await call('POST', `/documents/${draft}/finalize`, {})).body.error.code).toBe('issuing_off');
    expect((await call('POST', `/documents/${draft}/duplicate`, {})).body.error.code).toBe('issuing_off');

    expect((await call('GET', `/documents/${draft}`)).status).toBe(200);
    expect((await call('GET', '/documents')).status).toBe(200);
    expect((await call('DELETE', `/documents/${spare}`)).status).toBeLessThan(300);

    await call('PUT', '/ops/issuing', { enabled: true });
    expect((await call('POST', `/documents/${draft}/finalize`, {})).status).toBe(200);
  });

  it('skips recurring runs while off and does not catch up missed runs when turned back on', async () => {
    const draft = await newDraft();
    const final = (await call('POST', `/documents/${draft}/finalize`, {})).body.document.id;
    const created = await call('POST', '/recurring', { templateDocumentId: final, frequency: 'monthly', startDate: clock.today, mode: 'auto', sendEmail: false });
    expect(created.status).toBeLessThan(300);
    const scheduleId = created.body.schedules.find((s: any) => s.template_document_id === final).id;
    // Pretend the schedule fell behind while issuing was off.
    await env.DB.prepare("UPDATE recurring_schedules SET next_run_date = '2026-01-15', anchor_day = 15 WHERE id = ?").bind(scheduleId).run();

    await call('PUT', '/ops/issuing', { enabled: false });
    const due = await call('POST', '/recurring/run-due');
    expect(due.status).toBe(200);
    expect(due.body.issuingOff).toBe(true);
    expect(due.body.runs.filter((r: any) => r.schedule_id === scheduleId)).toHaveLength(0);

    await call('PUT', '/ops/issuing', { enabled: true });
    const schedule = (await call('GET', '/recurring')).body.schedules.find((s: any) => s.id === scheduleId);
    expect(schedule.next_run_date >= todayIsrael()).toBe(true);
    expect(schedule.next_run_date.slice(8)).toBe('15');
  });

  it('lets only the owner change it', async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES ('acct-issuing@example.com', 'accountant')").run();
    const res = await call('PUT', '/ops/issuing', { enabled: false }, 'acct-issuing@example.com');
    expect(res.status).toBe(403);
    expect((await call('GET', '/ops/issuing')).body).toEqual({ enabled: true });
  });
});
