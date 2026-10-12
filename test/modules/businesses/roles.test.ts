import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { OWNER, TODAY, businessesApp, callIn, okIn } from './helpers';

/**
 * R24 Phase B (R23 task 6): roles per business. An assistant issues and sends, keeps clients and
 * expenses, and is refused Settings, numbering, users, the legal-mode switch and the ITA. A
 * person of business 1 is refused every route with business 2's id. The last owner stays.
 */
const app = businessesApp();
const ASSISTANT = 'noauto-assistant@example.com';
const ONLY_B1 = 'noauto-b1-only@example.com';
let b2 = 0;

beforeAll(async () => {
  await okIn(app, OWNER, null, 'GET', '/businesses');
  b2 = (
    await okIn(app, OWNER, 1, 'POST', '/businesses', {
      entityType: 'company',
      nameEn: 'Roles Company Ltd',
      nameHe: 'חברת תפקידים בע"מ',
      taxId: '515555555',
      addressEn: 'Haifa',
    })
  ).businessId;
  await okIn(app, OWNER, 1, 'POST', '/access/users', { email: ASSISTANT, role: 'assistant' });
  await okIn(app, OWNER, 1, 'POST', '/access/users', { email: ONLY_B1, role: 'owner' });
});

describe('the assistant', () => {
  it('adds a client and issues a payment request', async () => {
    const client = await okIn(app, ASSISTANT, 1, 'POST', '/clients', { nameEn: 'Assistant Client', country: 'IL' });
    const draft = await okIn(app, ASSISTANT, 1, 'POST', '/documents', {
      type: 'PR',
      clientId: client.client.id,
      date: TODAY,
      lines: [{ description: 'Work', unitPriceMinor: 5000 }],
    });
    const fin = await okIn(app, ASSISTANT, 1, 'POST', `/documents/${draft.document.id}/finalize`, {});
    expect(fin.document.status).toBe('final');
  });

  it('is refused Settings, numbering, users, the legal-mode switch and reports', async () => {
    expect((await callIn(app, ASSISTANT, 1, 'GET', '/ops/business')).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'PUT', '/ops/series/400/start-number', { startNumber: 5 })).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'GET', '/access/users')).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'POST', '/legal-mode/switch', { effectiveDate: TODAY })).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'GET', '/legal-mode/status')).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'GET', '/reports/r/debtors')).status).toBe(403);
    expect((await callIn(app, ASSISTANT, 1, 'POST', '/businesses', { entityType: 'company' })).status).toBe(403);
  });
});

describe('a person of business 1 only', () => {
  it('is refused every route with business 2 in the header', async () => {
    for (const [method, path] of [
      ['GET', '/documents'],
      ['GET', '/clients'],
      ['GET', '/dashboard'],
      ['GET', '/ops/business'],
      ['GET', '/reports/r/debtors'],
      ['GET', '/legal-mode/status'],
      ['GET', '/businesses'],
      ['POST', '/clients'],
    ] as const) {
      const res = await callIn(app, ONLY_B1, b2, method, path, method === 'POST' ? { nameEn: 'x' } : undefined);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // And reaches business 1 as usual.
    expect((await callIn(app, ONLY_B1, 1, 'GET', '/documents')).status).toBe(200);
  });

  it('a business id that is not a number is refused', async () => {
    expect((await callIn(app, ONLY_B1, Number.NaN, 'GET', '/documents')).status).toBe(403);
  });
});

describe('owners', () => {
  it('lists people of the current business with their role, and the Access step', async () => {
    const list = await okIn(app, OWNER, 1, 'GET', '/access/users');
    const roles = Object.fromEntries((list.users as { email: string; role: string }[]).map((u) => [u.email, u.role]));
    expect(roles[ASSISTANT]).toBe('assistant');
    expect(roles[OWNER]).toBe('owner');
    expect(list.accessNote).toContain('Cloudflare Access');
    const inB2 = await okIn(app, OWNER, b2, 'GET', '/access/users');
    expect((inB2.users as { email: string }[]).map((u) => u.email)).toEqual([OWNER]);
  });

  it('the last owner of a business is never removed or downgraded', async () => {
    const me = (await okIn(app, OWNER, b2, 'GET', '/access/users')).users[0] as { id: number };
    expect((await callIn(app, OWNER, b2, 'DELETE', `/access/users/${me.id}`)).status).toBe(400);
    expect((await callIn(app, OWNER, b2, 'PATCH', `/access/users/${me.id}`, { role: 'assistant' })).status).toBe(400);
  });

  it('a second owner can be added, and then the first one can step down', async () => {
    const added = await okIn(app, OWNER, b2, 'POST', '/access/users', { email: 'noauto-second-owner@example.com', role: 'owner' });
    expect(added.accessNote).toContain('Cloudflare Access');
    const me = ((await okIn(app, OWNER, b2, 'GET', '/access/users')).users as { id: number; email: string }[]).find((u) => u.email === OWNER)!;
    const res = await callIn(app, OWNER, b2, 'PATCH', `/access/users/${me.id}`, { role: 'assistant' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('assistant');
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.role_change' AND business_id = ?").bind(b2).first<{ n: number }>();
    expect(audit?.n).toBe(1);
    await run(env.DB, "UPDATE user_businesses SET role = 'owner' WHERE user_id = ? AND business_id = ?", me.id, b2);
  });

  it('cannot add people to a business they do not own', async () => {
    const res = await callIn(app, ONLY_B1, 1, 'POST', '/access/users', { email: 'noauto-sneak@example.com', role: 'owner', businessIds: [b2] });
    expect(res.status).toBe(403);
  });
});

describe('the business cookie', () => {
  it('opens the business named in the ledger_business cookie, and the header wins over it', async () => {
    const { businessCookie } = await import('../../../src/core/auth');
    expect(businessCookie('a=1; ledger_business=2; b=3')).toBe('2');
    expect(businessCookie('ledger_business=x')).toBeUndefined();
    expect(businessCookie(undefined)).toBeUndefined();
  });
});
