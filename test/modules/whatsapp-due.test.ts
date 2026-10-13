import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { createApp } from '../../src/index';
import { accessModule } from '../../src/modules/access';
import { createDashboardModule } from '../../src/modules/dashboard';
import { createSendingModule, FakeMailer } from '../../src/modules/sending';
import { logReminder } from '../../src/modules/sending/reminder-log';
import { insertPaymentRequest, insertSendingClient } from '../fixtures/sending/db';
import { OWNER_ACTOR } from '../helpers';

/**
 * R28 task 7: reminders due on WhatsApp show on the dashboard, Share opens the prefilled message
 * and logs it, and the client page lists every reminder.
 */

const TODAY = '2026-10-13';
const OWNER = 'owner@example.com';
const CPA = 'noauto-r28-wa-cpa@example.com';
const mailer = new FakeMailer();
const app = createApp({ modules: [createDashboardModule({ today: () => TODAY }), createSendingModule(() => mailer), accessModule] });

async function call(email: string, method: string, path: string, body?: unknown) {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': '1' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: email, PUBLIC_APP_URL: 'https://ledger.test' },
  );
  return { status: res.status, body: (await res.json()) as any };
}

let clientId = 0;
let docId = 0;
let contractId = 0;
const at = `${TODAY}T07:00:00.000Z`;

beforeAll(async () => {
  expect((await call(OWNER, 'POST', '/access/users', { email: CPA, accessEndsOn: '2027-12-31', features: { reports: true } })).status).toBe(201);
  clientId = await insertSendingClient({ nameEn: 'Phone Only Ltd', email: null, phone: '050-1112222' });
  docId = await insertPaymentRequest(clientId, { dueDate: '2026-10-16', date: '2026-10-01' });
  await finalizeDocument(env.DB, docId, { actor: OWNER_ACTOR });

  await run(env.DB, "INSERT INTO contract_templates (business_id, name, kind) VALUES (1, 'WA template', 'contract')");
  const tpl = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE name = 'WA template'"))!.id;
  await run(env.DB, "INSERT INTO contract_template_versions (template_id, business_id, version, name, kind) VALUES (?, 1, 1, 'WA template', 'contract')", tpl);
  await run(env.DB, "INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, signer_name, signer_email, signer_phone) VALUES (1, ?, ?, 1, 'contract', 'Retainer', 'Dana', 'dana@x.example', '052-3334444')", clientId, tpl);
  contractId = (await first<{ id: number }>(env.DB, "SELECT id FROM contracts WHERE title = 'Retainer'"))!.id;
  await run(
    env.DB,
    "UPDATE contracts SET status = 'sent', sent_at = '2026-10-09T07:00:00.000Z', expires_at = '2026-10-23T07:00:00.000Z', sent_pdf_r2_key = 'k', sent_pdf_sha256 = 's' WHERE id = ?",
    contractId,
  );

  const base = { businessId: 1, clientId, channel: 'whatsapp_due' as const, result: 'due' as const, at };
  await logReminder(env.DB, { ...base, targetKind: 'document', targetId: docId, rule: 'before_3', details: { label: 'PR 1' } });
  await logReminder(env.DB, { ...base, targetKind: 'contract', targetId: contractId, rule: 'unsigned_3', details: { label: 'Retainer' } });
  // Yesterday's item is not today's.
  await logReminder(env.DB, { ...base, targetKind: 'document', targetId: 99999, rule: 'after_3', at: '2026-10-12T07:00:00.000Z' });
});

describe('R28 reminders due on WhatsApp', () => {
  it('the dashboard lists today’s due items for the owner, none for the accountant', async () => {
    const res = await call(OWNER, 'GET', '/dashboard');
    expect(res.status).toBe(200);
    const items = res.body.whatsappDue;
    expect(items).toHaveLength(2);
    expect(items.find((i: any) => i.targetKind === 'document')).toMatchObject({ clientName: 'Phone Only Ltd', label: 'PR 1', phone: '050-1112222', rules: ['before_3'] });
    expect(items.find((i: any) => i.targetKind === 'contract')).toMatchObject({ label: 'Retainer', phone: '052-3334444' });
    const cpa = await call(CPA, 'GET', '/dashboard');
    expect(cpa.body.whatsappDue).toEqual([]);
    expect((await call(CPA, 'POST', `/dashboard/reminders/${items[0].id}/share`)).status).toBe(403);
  });

  it('Share on a payment reminder opens the prefilled message and logs it shared', async () => {
    const item = (await call(OWNER, 'GET', '/dashboard')).body.whatsappDue.find((i: any) => i.targetKind === 'document');
    const res = await call(OWNER, 'POST', `/dashboard/reminders/${item.id}/share`);
    expect(res.status).toBe(200);
    expect(res.body.waUrl).toMatch(/^https:\/\/wa\.me\/972501112222\?text=/);
    expect(decodeURIComponent(res.body.waUrl)).toContain('is due soon');
    const rows = await all<{ result: string }>(env.DB, "SELECT result FROM reminder_log WHERE target_kind = 'document' AND target_id = ? ORDER BY id", docId);
    expect(rows.map((r) => r.result)).toEqual(['due', 'shared']);
    expect((await call(OWNER, 'GET', '/dashboard')).body.whatsappDue.some((i: any) => i.targetKind === 'document')).toBe(false);
    expect((await call(OWNER, 'POST', `/dashboard/reminders/${item.id}/share`)).status).toBe(409);
  });

  it('Share on a signing reminder sends the same link through Remind and the contract records it', async () => {
    const item = (await call(OWNER, 'GET', '/dashboard')).body.whatsappDue.find((i: any) => i.targetKind === 'contract');
    const res = await call(OWNER, 'POST', `/dashboard/reminders/${item.id}/share`);
    expect(res.status).toBe(200);
    expect(res.body.waUrl).toMatch(/^https:\/\/wa\.me\/972523334444\?text=/);
    expect(decodeURIComponent(res.body.waUrl)).toContain('/api/sending/public/c/');
    const events = await all<{ kind: string }>(env.DB, "SELECT kind FROM contract_events WHERE contract_id = ? AND kind = 'reminded'", contractId);
    expect(events).toHaveLength(1);
    expect((await call(OWNER, 'GET', '/dashboard')).body.whatsappDue).toEqual([]);
  });

  it('a contract signed after the run leaves the list', async () => {
    await logReminder(env.DB, { businessId: 1, clientId, channel: 'whatsapp_due', result: 'due', at, targetKind: 'contract', targetId: contractId, rule: 'ends_2' });
    expect((await call(OWNER, 'GET', '/dashboard')).body.whatsappDue).toHaveLength(1);
    await run(env.DB, "UPDATE contracts SET status = 'signed', signed_at = '2026-10-13T08:00:00Z', signed_pdf_sha256 = 'x' WHERE id = ?", contractId);
    expect((await call(OWNER, 'GET', '/dashboard')).body.whatsappDue).toEqual([]);
  });

  it('the client page lists every reminder, newest first, owner and assistant only', async () => {
    const res = await call(OWNER, 'GET', `/sending/clients/${clientId}/reminders`);
    expect(res.status).toBe(200);
    expect(res.body.reminders.length).toBe(6);
    expect(res.body.reminders.some((r: any) => r.targetKind === 'contract' && r.rule === 'ends_2' && r.result === 'due')).toBe(true);
    const times = res.body.reminders.map((r: any) => r.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(res.body.reminders.some((r: any) => r.result === 'shared' && r.label === 'PR 1')).toBe(true);
    expect((await call(CPA, 'GET', `/sending/clients/${clientId}/reminders`)).status).toBe(403);
  });
});
