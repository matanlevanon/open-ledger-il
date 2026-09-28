import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import type { Env } from '../../../src/env';
import { createApp } from '../../../src/index';
import { acceptConsent, consentState } from '../../../src/modules/sending/consent';
import { r2Key } from '../../../src/modules/pdf';
import { signSendToken } from '../../../src/modules/sending/tokens';
import { insertPaymentRequest, insertSendingClient } from '../../fixtures/sending/db';
import { OWNER_ACTOR, db } from '../../helpers';

/** No DEV_AUTH_EMAIL, no Cf-Access-Jwt-Assertion: every route needs its own authorization. */
function noAuthApp() {
  return createApp();
}

function noAuthEnv(): Env {
  return { ...env, DEV_AUTH_EMAIL: undefined } as Env;
}

async function get(path: string) {
  return noAuthApp().request(`/api${path}`, {}, noAuthEnv());
}

describe('public sending routes bypass Cloudflare Access', () => {
  it('refuses a normal API route with no session (proves the bypass is scoped, not global)', async () => {
    const res = await get('/sending/documents/1/log');
    expect(res.status).toBe(401);
  });

  it('serves the consent page for a valid token with no session', async () => {
    const clientId = await insertSendingClient();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'consent', clientId, exp });

    const res = await get(`/sending/public/consent/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Allow digital documents');
  });

  it('refuses a consent page for a tampered token', async () => {
    const res = await get('/sending/public/consent/not-a-real-token');
    expect(res.status).toBe(401);
  });

  /** R19: a Hebrew-only client (no nameEn) still gets a real name on the consent page. */
  it('shows the Hebrew name on the consent page for a Hebrew-only client', async () => {
    const clientId = await insertSendingClient({ nameEn: '', nameHe: 'לקוח עברי' });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'consent', clientId, exp });

    const res = await get(`/sending/public/consent/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('לקוח עברי');
  });

  it('accepting consent records ip and user agent from the request, with no session', async () => {
    const clientId = await insertSendingClient();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'consent', clientId, exp });

    const res = await noAuthApp().request(
      `/api/sending/public/consent/${token}/accept`,
      { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.7', 'User-Agent': 'ClientBrowser/1.0' } },
      noAuthEnv(),
    );
    expect(res.status).toBe(200);
    expect(await consentState(env.DB, clientId)).toMatchObject({ status: 'granted' });

    const row = await env.DB.prepare('SELECT ip, user_agent FROM client_consents WHERE client_id = ? ORDER BY id DESC LIMIT 1')
      .bind(clientId)
      .first<{ ip: string; user_agent: string }>();
    expect(row).toEqual({ ip: '198.51.100.7', user_agent: 'ClientBrowser/1.0' });
  });

  it('streams the shared PDF for a valid, unexpired token with no session', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(env.DB, { clientId, ip: null, userAgent: null });
    const docId = await insertPaymentRequest(clientId, { date: '2026-10-01' });
    const finalized = await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });
    const key = r2Key('2026-10-01', 'PR', finalized.number, 'client');
    await env.FILES.put(key, '%PDF-1.7 fake bytes', { httpMetadata: { contentType: 'application/pdf' } });

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'share', documentId: docId, variant: 'client', exp });

    const res = await get(`/sending/public/share/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('%PDF-1.7 fake bytes');
  });

  it('refuses an expired share link', async () => {
    const clientId = await insertSendingClient();
    const docId = await insertPaymentRequest(clientId, { date: '2026-10-01' });
    await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });

    const expired = Math.floor(Date.now() / 1000) - 10;
    const token = await signSendToken(env, { kind: 'share', documentId: docId, variant: 'client', exp: expired });

    const res = await get(`/sending/public/share/${token}`);
    expect(res.status).toBe(401);
  });
});

describe('owner sending routes', () => {
  beforeEach(async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO users (email, role) VALUES ('owner@example.com', 'owner')`).run();
  });

  it('lets the owner read the client consent state through the dev auth bypass', async () => {
    const clientId = await insertSendingClient();
    const res = await createApp().request(`/api/sending/clients/${clientId}/consent`, {}, env as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'none' });
  });
});
