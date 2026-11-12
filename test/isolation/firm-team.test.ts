import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { forEachBusiness } from '../../src/core/business';
import { first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { FakeMailer, businessReplyTo } from '../../src/modules/sending/mailer';

/**
 * R48 task 1: Ledger admins, the firm team, the user list a client owner sees, the cron loop that
 * survives one failing business, and Reply-To. The single edition behaves as before.
 */
const app = createApp();
const ADMIN = 'owner@example.com';
const CLIENT_OWNER = 'noauto-firm-client@example.com';
const STAFF = 'noauto-firm-staff@example.com';

async function call(email: string, businessId: number | null, method: string, path: string, body?: unknown, edition = 'firm') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (businessId !== null) headers['X-Business-Id'] = String(businessId);
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, {
    ...env,
    DEV_AUTH_EMAIL: email,
    LEDGER_EDITION: edition,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

let b2 = 0;
let b3 = 0;

beforeAll(async () => {
  await call(ADMIN, null, 'GET', '/businesses');
  b2 = (await call(ADMIN, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Client Two Ltd', nameHe: 'לקוח שני בע"מ', taxId: '514000033', addressEn: 'Haifa' })).body.businessId;
  await call(ADMIN, b2, 'POST', '/access/users', { email: CLIENT_OWNER, role: 'owner' });
});

describe('Ledger admin', () => {
  it('the bootstrap owner is an admin', async () => {
    expect((await first<{ is_ledger_admin: number }>(env.DB, 'SELECT is_ledger_admin FROM users WHERE email = ?', ADMIN))?.is_ledger_admin).toBe(1);
  });

  it('owns a business made after the grant, with no user_businesses row', async () => {
    b3 = (await call(CLIENT_OWNER, b2, 'POST', '/businesses', { entityType: 'company', nameEn: 'X', nameHe: 'X', taxId: '514000041', addressEn: 'X' })).status;
    expect(b3).toBe(403);
    await run(env.DB, "INSERT INTO businesses (id, name_en, name_he, entity_type) VALUES (900, 'Later Ltd', 'Later', 'company')");
    const res = await call(ADMIN, 900, 'GET', '/ops/business');
    expect(res.status).toBe(200);
    expect(await first(env.DB, 'SELECT 1 FROM user_businesses ub JOIN users u ON u.id = ub.user_id WHERE u.email = ? AND ub.business_id = 900', ADMIN)).toBeNull();
  });

  it('the single edition does not open other businesses to the admin', async () => {
    expect((await call(ADMIN, 900, 'GET', '/ops/business', undefined, 'single')).status).toBe(403);
  });

  it('the last admin cannot be removed', async () => {
    const admin = await first<{ id: number }>(env.DB, 'SELECT id FROM users WHERE email = ?', ADMIN);
    const res = await call(ADMIN, 1, 'DELETE', `/access/firm-team/${admin!.id}/admin`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_ledger_admin');
  });

  it('a second admin can be added and removed, audited', async () => {
    const add = await call(ADMIN, 1, 'POST', '/access/firm-team', { email: 'noauto-admin-two@example.com', role: 'admin' });
    expect(add.status).toBe(201);
    const two = add.body.team.find((m: { email: string }) => m.email === 'noauto-admin-two@example.com');
    expect(two.role).toBe('admin');
    expect((await call('noauto-admin-two@example.com', b2, 'GET', '/ops/business')).status).toBe(200);
    expect((await call(ADMIN, 1, 'DELETE', `/access/firm-team/${two.id}/admin`)).status).toBe(200);
    const actions = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'ledger.%' ORDER BY id").all<{ action: string }>()).results.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['ledger.admin_add', 'ledger.admin_remove']));
  });

  it('the firm team screen is part of the firm edition only', async () => {
    expect((await call(ADMIN, 1, 'GET', '/access/firm-team', undefined, 'single')).status).toBe(403);
  });
});

describe('firm staff', () => {
  it('a Ledger grant reaches every business, present and future', async () => {
    const add = await call(ADMIN, 1, 'POST', '/access/firm-team', { email: STAFF, role: 'accountant', features: { reports: true } });
    expect(add.status).toBe(201);
    const list = await call(STAFF, b2, 'GET', '/businesses');
    expect(list.status).toBe(200);
    const ids = list.body.businesses.map((b: { id: number }) => b.id);
    expect(ids).toEqual(expect.arrayContaining([1, b2, 900]));
    expect(list.body.businesses.every((b: { role: string }) => b.role === 'accountant')).toBe(true);
    // An accountant has no Settings.
    expect((await call(STAFF, b2, 'GET', '/ops/business')).status).toBe(403);
  });

  it('a direct grant on a business wins over the Ledger grant', async () => {
    const staff = await first<{ id: number }>(env.DB, 'SELECT id FROM users WHERE email = ?', STAFF);
    await run(env.DB, "INSERT INTO user_businesses (user_id, business_id, role) VALUES (?, ?, 'assistant')", staff!.id, b2);
    const list = await call(STAFF, b2, 'GET', '/businesses');
    expect(list.body.businesses.find((b: { id: number }) => b.id === b2).role).toBe('assistant');
    await run(env.DB, 'DELETE FROM user_businesses WHERE user_id = ? AND business_id = ?', staff!.id, b2);
  });

  it('revoking the grant closes every business, audited', async () => {
    const staff = await first<{ id: number }>(env.DB, 'SELECT id FROM users WHERE email = ?', STAFF);
    expect((await call(ADMIN, 1, 'PATCH', `/access/firm-team/${staff!.id}`, { role: 'assistant' })).status).toBe(200);
    expect((await call(ADMIN, 1, 'DELETE', `/access/firm-team/${staff!.id}`)).status).toBe(204);
    expect((await call(STAFF, b2, 'GET', '/businesses')).status).toBe(403);
    const actions = (await env.DB.prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'ledger.%'").bind(STAFF).all<{ action: string }>()).results.map((r) => r.action);
    expect(actions).toEqual(['ledger.grant', 'ledger.grant', 'ledger.revoke']);
  });
});

describe('the user list a client owner sees', () => {
  it('shows the firm team as "Firm team" with no email', async () => {
    const res = await call(CLIENT_OWNER, b2, 'GET', '/access/users');
    expect(res.status).toBe(200);
    const team = res.body.users.filter((u: { firmTeam?: boolean }) => u.firmTeam);
    expect(team.length).toBeGreaterThan(0);
    for (const u of team) {
      expect(u.email).toBe('');
      expect(u.name).toBe('Firm team');
    }
    // Their own row keeps its email and shows no other business.
    const own = res.body.users.find((u: { email: string }) => u.email === CLIENT_OWNER);
    expect(own.businesses).toEqual([{ id: b2, role: 'owner' }]);
  });

  it('an admin sees the emails', async () => {
    const res = await call(ADMIN, b2, 'GET', '/access/users');
    expect(res.body.users.some((u: { email: string; firmTeam?: boolean }) => u.firmTeam && u.email === ADMIN)).toBe(true);
  });

  it('the single edition lists exactly the people of the business, as before', async () => {
    const res = await call(ADMIN, 1, 'GET', '/access/users', undefined, 'single');
    expect(res.body.users.some((u: { firmTeam?: boolean }) => u.firmTeam)).toBe(false);
  });
});

describe('cron loops', () => {
  afterEach(() => vi.restoreAllMocks());

  it('one business that throws never stops the rest, and is logged with its id', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const done: number[] = [];
    const failed = await forEachBusiness(
      env.DB,
      'test.job',
      async (id) => {
        if (id === 2) throw new Error('boom');
        done.push(id);
      },
      [1, 2, 3],
    );
    expect(failed).toEqual([2]);
    expect(done).toEqual([1, 3]);
    expect(log).toHaveBeenCalledWith('business_job_failed', 'test.job', 2, 'Error: boom');
  });
});

describe('email Reply-To', () => {
  it('is the business email when set, absent otherwise', async () => {
    await run(env.DB, "UPDATE businesses SET email = 'office@client-two.example' WHERE id = ?", b2);
    expect(await businessReplyTo(env.DB, b2)).toBe('office@client-two.example');
    await run(env.DB, 'UPDATE businesses SET email = NULL WHERE id = 900');
    expect(await businessReplyTo(env.DB, 900)).toBeUndefined();
  });

  it('the Resend call carries reply_to', async () => {
    const { ResendMailer } = await import('../../src/modules/sending/mailer');
    let sent: Record<string, unknown> = {};
    const mailer = new ResendMailer('key', 'Ledger <ledger@example.com>', async (_i, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'x' }));
    });
    await mailer.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't', fromName: 'Client Two', replyTo: 'office@client-two.example' });
    expect(sent.reply_to).toBe('office@client-two.example');
    expect(sent.from).toBe('Client Two <ledger@example.com>');
    expect(new FakeMailer()).toBeDefined();
  });
});
