import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { type ContractDeps, createContractsModule, dueRules, FakeContractPdfEngine, runContractReminders, type ContractsOptions } from '../../../src/modules/contracts';
import { FakeMailer } from '../../../src/modules/sending';
import { setContractReminderSettings } from '../../../src/modules/sending/settings';

/**
 * R28 task 4: automatic signing reminders. Each rule fires once per contract, the email goes
 * through the Remind path, the run logs to reminder_log, and every skip holds.
 */

const OWNER = 'owner@example.com';
const DAY = 24 * 60 * 60 * 1000;
let offsetMs = 0;
const clock = () => new Date(Date.now() + offsetMs);
const mailer = new FakeMailer();
const options: ContractsOptions = { engineFor: () => new FakeContractPdfEngine(), mailerFor: () => mailer, now: clock };
const app = createApp({ modules: [createClientsModule({ today: () => '2026-10-13' }), createContractsModule(options)] });
const envFor = (email: string) => ({ ...env, DEV_AUTH_EMAIL: email, PUBLIC_APP_URL: 'https://ledger.test' });

async function ok(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, { method, headers: { 'X-Business-Id': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, envFor(OWNER));
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

const deps = (withMail = true): ContractDeps => ({
  env: { ...env, PUBLIC_APP_URL: 'https://ledger.test' } as ContractDeps['env'],
  engine: new FakeContractPdfEngine(),
  mailer: withMail ? mailer : null,
  notifier: { send: async () => true },
  baseUrl: 'https://ledger.test',
  now: clock,
});

let templateId = 0;
let clientId = 0;

async function sentContract(opts: { linkDays?: number; phone?: string | null; client?: number } = {}) {
  const res = await ok('POST', '/contracts', {
    clientId: opts.client ?? clientId,
    templateId,
    language: 'en',
    values: {},
    linkDays: opts.linkDays ?? 14,
    signer: { name: 'Dana Cohen', email: 'dana@acme.example', phone: opts.phone === undefined ? '050-1234567' : opts.phone },
  });
  await ok('POST', `/contracts/${res.contract.id}/send`, { channel: 'link' });
  return res.contract.id as number;
}

const logFor = (id: number) => all<{ channel: string; rule: string; result: string }>(env.DB, "SELECT channel, rule, result FROM reminder_log WHERE target_kind = 'contract' AND target_id = ? ORDER BY id", id);
const emailsTo = (n0: number) => mailer.sent.length - n0;

beforeAll(async () => {
  clientId = (await ok('POST', '/clients', { nameEn: 'Acme Ltd', country: 'IL', email: 'office@acme.example' })).client.id;
  templateId = (
    await ok('POST', '/contracts/templates', {
      name: 'Short agreement',
      kind: 'contract',
      bodyEn: 'Agreed.\n\n{{client_signature}}',
      bodyHe: '',
      fields: [{ key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Signature', labelHe: '', required: true, options: [], multiple: false, allowOther: false }],
    })
  ).template.id;
});

beforeEach(async () => {
  offsetMs = 0;
  await setContractReminderSettings(env.DB, 1, { enabled: true, afterDays: [3, 7], beforeEnd: true });
});

describe('R28 signing reminders', () => {
  it('the rules: after N days unsigned, and 2 days before the link ends', () => {
    const now = new Date('2026-10-20T07:00:00Z');
    const s = { afterDays: [3, 7], beforeEnd: true };
    expect(dueRules({ sent_at: '2026-10-18T07:00:00Z', expires_at: '2026-11-01T07:00:00Z' }, now, s)).toEqual([]);
    expect(dueRules({ sent_at: '2026-10-17T07:00:00Z', expires_at: '2026-10-31T07:00:00Z' }, now, s)).toEqual(['unsigned_3']);
    expect(dueRules({ sent_at: '2026-10-13T07:00:00Z', expires_at: '2026-10-22T07:00:00Z' }, now, s)).toEqual(['unsigned_3', 'unsigned_7', 'ends_2']);
    expect(dueRules({ sent_at: '2026-10-19T07:00:00Z', expires_at: '2026-10-21T07:00:00Z' }, now, { afterDays: [3], beforeEnd: false })).toEqual([]);
  });

  it('emails the signer the same link once per rule, logs it, and records a reminded event', async () => {
    const id = await sentContract();
    const n0 = mailer.sent.length;
    offsetMs = 1 * DAY;
    await runContractReminders(deps(), 1);
    expect(emailsTo(n0)).toBe(0);

    offsetMs = 3 * DAY + 60_000;
    expect((await runContractReminders(deps(), 1)).emailed).toContain(id);
    expect(emailsTo(n0)).toBe(1);
    const mail = mailer.sent[mailer.sent.length - 1]!;
    expect(mail.to).toBe('dana@acme.example');
    expect(mail.subject).toContain('Reminder');
    expect(mail.text).toContain('/api/sending/public/c/');

    // The cron running twice the same day sends nothing more.
    await runContractReminders(deps(), 1);
    offsetMs = 4 * DAY;
    await runContractReminders(deps(), 1);
    expect(emailsTo(n0)).toBe(1);

    offsetMs = 7 * DAY + 60_000;
    await runContractReminders(deps(), 1);
    expect(emailsTo(n0)).toBe(2);
    expect(await logFor(id)).toEqual([
      { channel: 'email', rule: 'unsigned_3', result: 'sent' },
      { channel: 'email', rule: 'unsigned_7', result: 'sent' },
    ]);
    const events = await all<{ kind: string; actor_email: string }>(env.DB, "SELECT kind, actor_email FROM contract_events WHERE contract_id = ? AND kind = 'reminded'", id);
    expect(events).toEqual([
      { kind: 'reminded', actor_email: 'system' },
      { kind: 'reminded', actor_email: 'system' },
    ]);

    offsetMs = 12 * DAY + 60_000;
    await runContractReminders(deps(), 1);
    expect(emailsTo(n0)).toBe(3);
    expect((await logFor(id)).map((r) => r.rule)).toContain('ends_2');
  });

  it('skips signed, void, declined and expired contracts', async () => {
    const signed = await sentContract();
    await run(env.DB, "UPDATE contracts SET status = 'signed', signed_at = '2026-10-14T00:00:00Z', signed_pdf_sha256 = 'x' WHERE id = ?", signed);
    const voided = await sentContract();
    await ok('POST', `/contracts/${voided}/void`, {});
    const declined = await sentContract();
    await run(env.DB, "UPDATE contracts SET status = 'declined', declined_at = '2026-10-14T00:00:00Z' WHERE id = ?", declined);
    const expired = await sentContract({ linkDays: 7 });
    offsetMs = 8 * DAY;
    const res = await runContractReminders(deps(), 1);
    for (const id of [signed, voided, declined, expired]) {
      expect(res.emailed).not.toContain(id);
      expect(await logFor(id)).toEqual([]);
    }
  });

  it('skips contracts signed outside the Ledger', async () => {
    await run(env.DB, "INSERT INTO contract_templates (business_id, name, kind, origin, active) VALUES (1, 'Signed outside the Ledger', 'contract', 'external', 0)");
    const hidden = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE origin = 'external'"))!.id;
    await run(
      env.DB,
      `INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status, origin, signed_at, signed_pdf_r2_key, signed_pdf_sha256, signer_email)
       VALUES (1, ?, ?, 1, 'contract', 'Paper', 'signed', 'external', '2026-09-01', 'k', 'ext-sha', 'dana@acme.example')`,
      clientId,
      hidden,
    );
    const ext = (await first<{ id: number }>(env.DB, "SELECT id FROM contracts WHERE origin = 'external'"))!.id;
    offsetMs = 8 * DAY;
    await runContractReminders(deps(), 1);
    expect(await logFor(ext)).toEqual([]);
  });

  it('skips a client with automatic reminders off, and manual Remind still works', async () => {
    const quiet = (await ok('POST', '/clients', { nameEn: 'Quiet Ltd', country: 'IL', email: 'q@quiet.example' })).client.id;
    await run(env.DB, 'UPDATE clients SET auto_reminders = 0 WHERE id = ?', quiet);
    const id = await sentContract({ client: quiet });
    offsetMs = 3 * DAY + 60_000;
    const n0 = mailer.sent.length;
    const res = await runContractReminders(deps(), 1);
    expect(res.emailed).not.toContain(id);
    expect(await logFor(id)).toEqual([]);
    const remindersOf = (c: number) => all<{ kind: string }>(env.DB, "SELECT kind FROM contract_events WHERE contract_id = ? AND kind = 'reminded'", c);
    expect(await remindersOf(id)).toEqual([]);
    await ok('POST', `/contracts/${id}/remind`, { channel: 'email' });
    expect(await remindersOf(id)).toHaveLength(1);
    expect(mailer.sent.slice(n0).some((m) => m.subject.startsWith('Reminder'))).toBe(true);
  });

  it('settings off sends nothing', async () => {
    const id = await sentContract();
    await setContractReminderSettings(env.DB, 1, { enabled: false });
    offsetMs = 3 * DAY + 60_000;
    expect((await runContractReminders(deps(), 1)).emailed).toEqual([]);
    expect(await logFor(id)).toEqual([]);
  });

  it('without email: a WhatsApp reminder is due when the signer has a phone, else skipped, and nothing is emailed', async () => {
    const withPhone = await sentContract();
    const noPhone = await sentContract({ phone: null });
    offsetMs = 3 * DAY + 60_000;
    const n0 = mailer.sent.length;
    const res = await runContractReminders(deps(false), 1);
    expect(emailsTo(n0)).toBe(0);
    expect(res.whatsappDue).toContain(withPhone);
    expect(await logFor(withPhone)).toEqual([{ channel: 'whatsapp_due', rule: 'unsigned_3', result: 'due' }]);
    expect(await logFor(noPhone)).toEqual([]);
    // Due once: the next run the same day adds nothing.
    await runContractReminders(deps(false), 1);
    expect(await logFor(withPhone)).toHaveLength(1);
  });
});
