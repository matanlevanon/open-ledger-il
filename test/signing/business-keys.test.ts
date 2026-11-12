import { env } from 'cloudflare:workers';
import * as forgeModule from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { resolveSigningIdentity } from '../../src/modules/pdf/signing';
import { signPdf, verifyPdf } from '../../src/modules/signing';
import { addExpiryTasks } from '../../src/modules/signing/keys';
import { TEST_TOKEN_KEY } from '../ita/helpers';

/**
 * R48 task 3: a signing key per business. Made in the browser or uploaded, checked and encrypted
 * by the Worker, never returned. Single edition falls back to the Ledger's key for every business,
 * firm edition for business 1 only.
 */
const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;
const app = createApp();
const OWNER = 'owner@example.com';

function makePair(name: string, from = new Date('2026-01-01T00:00:00Z'), to = new Date('2036-01-01T00:00:00Z'), keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `0${Math.floor(Math.random() * 1e9).toString(16)}`;
  cert.validity.notBefore = from;
  cert.validity.notAfter = to;
  const subject = [{ name: 'commonName', value: name }, { name: 'countryName', value: 'IL' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert), keys };
}

const LEDGER = makePair('Ledger Owner');
let b2 = 0;
let b3 = 0;

function bindings(edition: 'single' | 'firm') {
  return { ...env, DEV_AUTH_EMAIL: OWNER, LEDGER_EDITION: edition, ITA_TOKEN_KEY: TEST_TOKEN_KEY, SIGNING_KEY_PEM: LEDGER.keyPem, SIGNING_CERT_PEM: LEDGER.certPem };
}

async function call(method: string, path: string, businessId: number, body?: unknown, edition: 'single' | 'firm' = 'single') {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    bindings(edition),
  );
  const text = await res.text();
  return { status: res.status, text, body: (text ? JSON.parse(text) : null) as any };
}

async function signerOf(identity: { keyPem: string; certPem: string }): Promise<string | undefined> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const signed = await signPdf(await doc.save(), { ...identity, signerName: 'Test' });
  return (await verifyPdf(signed)).signerCommonName;
}

const logs: unknown[][] = [];
const logSpies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')].map((s) =>
  s.mockImplementation((...args: unknown[]) => {
    logs.push(args);
  }),
);
afterAll(() => logSpies.forEach((s) => s.mockRestore()));

beforeAll(async () => {
  await call('GET', '/businesses', 1);
  b2 = (await call('POST', '/businesses', 1, { entityType: 'company', nameEn: 'Business Two', nameHe: 'עסק שני', taxId: '514000082', addressEn: 'Haifa' })).body.businessId;
  b3 = (await call('POST', '/businesses', 1, { entityType: 'company', nameEn: 'Business Three', nameHe: 'עסק שלישי', taxId: '514000090', addressEn: 'Haifa' })).body.businessId;
});

describe('R48 a key per business', () => {
  it('stores an uploaded pair for business 2, and no response holds the key', async () => {
    const pair = makePair('Business Two');
    const res = await call('POST', '/signing/key', b2, { keyPem: pair.keyPem, certPem: pair.certPem, source: 'uploaded' });
    expect(res.status).toBe(201);
    expect(res.text).not.toContain('PRIVATE KEY');
    expect(res.body.warning).toBeNull();
    const status = await call('GET', '/signing', b2);
    expect(status.body.mode).toBe('own');
    expect(status.body.active.subject).toContain('CN=Business Two');
    expect(status.text).not.toContain('PRIVATE KEY');
    const row = await first<{ key_enc: string }>(env.DB, 'SELECT key_enc FROM business_signing_keys WHERE business_id = ?', b2);
    expect(row!.key_enc).toMatch(/^v1\./);
    expect(row!.key_enc).not.toContain('PRIVATE');
  });

  it("business 2's PDF carries business 2's certificate", async () => {
    const identity = await resolveSigningIdentity(env.DB, bindings('single'), b2, { require: true });
    expect(await signerOf(identity!)).toBe('Business Two');
  });

  it('single edition: business 3 with no row signs with the Ledger key, as before', async () => {
    const identity = await resolveSigningIdentity(env.DB, bindings('single'), b3, { require: true });
    expect(identity!.keyPem).toBe(LEDGER.keyPem);
    expect(await signerOf(identity!)).toBe('Ledger Owner');
    expect((await call('GET', '/signing', b3)).body.mode).toBe('ledger');
  });

  it('firm edition: business 3 with no row cannot sign, business 1 can', async () => {
    await expect(resolveSigningIdentity(env.DB, bindings('firm'), b3, { require: true })).rejects.toThrow(/Settings > Digital signature/);
    expect(await resolveSigningIdentity(env.DB, bindings('firm'), b3)).toBeNull();
    expect((await resolveSigningIdentity(env.DB, bindings('firm'), 1, { require: true }))!.keyPem).toBe(LEDGER.keyPem);
    expect((await call('GET', '/signing', b3, undefined, 'firm')).body.mode).toBe('none');
  });

  it('refuses a key that does not match the certificate', async () => {
    const a = makePair('Business Three');
    const b = makePair('Business Three');
    const res = await call('POST', '/signing/key', b3, { keyPem: a.keyPem, certPem: b.certPem, source: 'uploaded' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('signing_pair_mismatch');
    expect(res.text).not.toContain('PRIVATE KEY');
  });

  it('refuses an expired certificate', async () => {
    const old = makePair('Business Three', new Date('2015-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const res = await call('POST', '/signing/key', b3, { keyPem: old.keyPem, certPem: old.certPem, source: 'uploaded' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('signing_cert_not_valid');
  });

  it('warns, and still stores, when the subject names another business', async () => {
    const other = makePair('Someone Else');
    const res = await call('POST', '/signing/key', b3, { keyPem: other.keyPem, certPem: other.certPem, source: 'generated' });
    expect(res.status).toBe(201);
    expect(res.body.warning).toContain('Someone Else');
  });

  it('a new key retires the old one, audited, and the signed PDFs stay valid', async () => {
    const before = await resolveSigningIdentity(env.DB, bindings('single'), b2);
    const oldPdf = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      return signPdf(await doc.save(), { ...before!, signerName: 'Test' });
    })();
    const pair = makePair('Business Two');
    expect((await call('POST', '/signing/key', b2, { keyPem: pair.keyPem, certPem: pair.certPem, source: 'generated' })).status).toBe(201);
    const rows = await all<{ status: string; retired_at: string | null }>(env.DB, 'SELECT status, retired_at FROM business_signing_keys WHERE business_id = ? ORDER BY id', b2);
    expect(rows.map((r) => r.status)).toEqual(['retired', 'active']);
    expect(rows[0]!.retired_at).not.toBeNull();
    expect((await verifyPdf(oldPdf)).valid).toBe(true);
    const actions = (await all<{ action: string; details: string | null }>(env.DB, "SELECT action, details FROM audit_log WHERE action LIKE 'signing.%' AND business_id = ? ORDER BY id", b2));
    expect(actions.map((a) => a.action)).toEqual(['signing.upload', 'signing.retire', 'signing.create']);
    expect(actions.map((a) => a.details ?? '').join('')).not.toContain('PRIVATE KEY');
    const history = await call('GET', '/signing', b2);
    expect(history.body.history).toHaveLength(2);
  });
});

describe('R48 the key table never changes', () => {
  it('refuses DELETE, a changed certificate, and a retired row moving back', async () => {
    const row = await first<{ id: number }>(env.DB, "SELECT id FROM business_signing_keys WHERE status = 'retired' LIMIT 1");
    const active = await first<{ id: number }>(env.DB, "SELECT id FROM business_signing_keys WHERE status = 'active' AND business_id = ?", b2);
    const err = async (sql: string, ...p: (string | number)[]) => {
      try {
        await run(env.DB, sql, ...p);
        return null;
      } catch (e) {
        return String(e);
      }
    };
    expect(await err('DELETE FROM business_signing_keys WHERE id = ?', row!.id)).toMatch(/signing_key_fixed|never deleted or changed/);
    expect(await err("UPDATE business_signing_keys SET cert_pem = 'x' WHERE id = ?", active!.id)).toMatch(/signing_key_fixed|never deleted or changed/);
    expect(await err("UPDATE business_signing_keys SET status = 'active', retired_at = NULL WHERE id = ?", row!.id)).toMatch(/signing_key_fixed|never deleted or changed/);
    expect(await err("UPDATE business_signing_keys SET status = 'retired' WHERE id = ?", active!.id)).toMatch(/signing_key_fixed|never deleted or changed/);
  });

  it('one active row per business', async () => {
    const active = await first<Record<string, string>>(env.DB, "SELECT * FROM business_signing_keys WHERE status = 'active' AND business_id = ?", b2);
    let error = '';
    try {
      await run(
        env.DB,
        "INSERT INTO business_signing_keys (business_id, key_enc, cert_pem, subject, serial, not_before, not_after, source) VALUES (?, 'v1.x.y', ?, 's', '1', '2026', '2036', 'uploaded')",
        b2,
        active!.cert_pem!,
      );
    } catch (e) {
      error = String(e);
    }
    expect(error).toMatch(/UNIQUE/);
  });
});

describe('R48 expiry tasks', () => {
  it('adds a task 60 and 14 days before the end, once each', async () => {
    const end = (await first<{ not_after: string }>(env.DB, "SELECT not_after FROM business_signing_keys WHERE status = 'active' AND business_id = ?", b2))!.not_after.slice(0, 10);
    const minus = (days: number) => new Date(Date.parse(`${end}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    expect(await addExpiryTasks(env.DB, b2, minus(90))).toBe(0);
    expect(await addExpiryTasks(env.DB, b2, minus(60))).toBe(1);
    expect(await addExpiryTasks(env.DB, b2, minus(59))).toBe(0);
    expect(await addExpiryTasks(env.DB, b2, minus(14))).toBe(1);
    expect(await addExpiryTasks(env.DB, b2, minus(3))).toBe(0);
    const kinds = (await all<{ kind: string }>(env.DB, "SELECT kind FROM tasks WHERE business_id = ? AND kind LIKE 'signing_expiry_%' ORDER BY id", b2)).map((r) => r.kind);
    expect(kinds).toEqual(['signing_expiry_60', 'signing_expiry_14']);
  });
});

describe('R48 key material never leaks', () => {
  it('no log line holds a private key', () => {
    expect(JSON.stringify(logs)).not.toContain('PRIVATE KEY');
  });

  it('the demo refuses a new key', async () => {
    const pair = makePair('Demo');
    const res = await app.request(
      '/api/signing/key',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keyPem: pair.keyPem, certPem: pair.certPem, source: 'generated' }) },
      { ...bindings('single'), DEMO_MODE: '1' },
    );
    expect(res.status).not.toBe(201);
  });
});
