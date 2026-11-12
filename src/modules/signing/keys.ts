import * as forgeModule from 'node-forge';
import { type AuditActor, auditStatement } from '../../core/audit';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { ConfigError, ConflictError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { decryptToken, encryptToken, importTokenKey } from '../ita/crypto';

// Same unwrap as src/modules/signing/cms.ts: the bundle may hand back the namespace or its default.
const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;

/**
 * R48 task 3: a signing key per business (business_signing_keys). The key is made in the browser
 * or uploaded, never generated here. The Worker checks the pair, encrypts the private key with
 * ITA_TOKEN_KEY (context `signing:<businessId>`) and stores it. No response, log, audit row,
 * export, backup or error message holds the key.
 */

export type SigningKeySource = 'generated' | 'uploaded';

export interface SigningKeyRow {
  id: number;
  business_id: number;
  key_enc: string;
  cert_pem: string;
  subject: string;
  serial: string;
  not_before: string;
  not_after: string;
  source: SigningKeySource;
  status: 'active' | 'retired';
  created_at: string;
  created_by: string | null;
  retired_at: string | null;
}

/** What a screen may see of a key. Never key material. */
export interface SigningKeyInfo {
  id: number;
  subject: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  source: SigningKeySource;
  status: 'active' | 'retired';
  createdAt: string;
  retiredAt: string | null;
}

export function keyContext(businessId: number): string {
  return `signing:${businessId}`;
}

export function infoOf(row: SigningKeyRow): SigningKeyInfo {
  return {
    id: row.id,
    subject: row.subject,
    serial: row.serial,
    notBefore: row.not_before,
    notAfter: row.not_after,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

export async function activeSigningKey(db: D1Database, businessId: number): Promise<SigningKeyRow | null> {
  return first<SigningKeyRow>(db, "SELECT * FROM business_signing_keys WHERE business_id = ? AND status = 'active'", businessId);
}

export async function signingKeyHistory(db: D1Database, businessId: number): Promise<SigningKeyInfo[]> {
  const rows = await all<SigningKeyRow>(db, 'SELECT * FROM business_signing_keys WHERE business_id = ? ORDER BY id DESC', businessId);
  return rows.map(infoOf);
}

/** The private key of the business's active row, decrypted, with its certificate. Null without one. */
export async function decryptActiveKey(db: D1Database, env: Pick<Env, 'ITA_TOKEN_KEY'>, businessId: number): Promise<{ keyPem: string; certPem: string } | null> {
  const row = await activeSigningKey(db, businessId);
  if (!row) return null;
  const key = await importTokenKey(env.ITA_TOKEN_KEY);
  try {
    return { keyPem: await decryptToken(key, row.key_enc, keyContext(businessId)), certPem: row.cert_pem };
  } catch {
    throw new ConfigError('The signing key of this business could not be opened. Make a new one in Settings > Digital signature.');
  }
}

function decodeField(value: string): string {
  try {
    return forge.util.decodeUtf8(value);
  } catch {
    return value;
  }
}

/** The subject as one line, CN first, decoded from UTF-8. */
export function subjectLine(cert: forgeModule.pki.Certificate): string {
  const order = ['CN', 'O', 'C', 'serialNumber'];
  const parts: string[] = [];
  for (const short of order) {
    const field = cert.subject.attributes.find((a) => a.shortName === short || a.name === short);
    if (field && typeof field.value === 'string') parts.push(`${short}=${decodeField(field.value)}`);
  }
  return parts.join(', ');
}

function base64UrlToHex(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex.replace(/^0+/, '');
}

function pemBody(pemText: string, label: string): Uint8Array {
  const match = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`).exec(pemText);
  if (!match) throw new ValidationError(`Paste a PEM ${label.toLowerCase()}.`);
  const bin = atob(match[1]!.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface CheckedPair {
  keyPem: string;
  certPem: string;
  subject: string;
  commonName: string;
  serial: string;
  notBefore: string;
  notAfter: string;
}

/**
 * Checks a key and certificate pair: the key is PKCS#8 RSA, it matches the certificate's public
 * key, and the certificate is valid on `now`. Cheap work only: WebCrypto imports the key, forge
 * reads the certificate. Errors never echo the key.
 */
export async function checkPair(rawKeyPem: string, certPem: string, now: Date): Promise<CheckedPair> {
  // A PKCS#1 key (BEGIN RSA PRIVATE KEY, what OpenSSL and the installer write) is stored as PKCS#8.
  let keyPem = rawKeyPem.trim();
  if (keyPem.includes('BEGIN RSA PRIVATE KEY')) {
    try {
      keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(forge.pki.privateKeyFromPem(keyPem))));
    } catch {
      throw new ValidationError('The private key could not be read. Upload an unencrypted RSA key.');
    }
  }
  let cert: forgeModule.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ValidationError('The certificate could not be read. Upload a PEM certificate.');
  }
  let jwk: JsonWebKey;
  try {
    const imported = await crypto.subtle.importKey('pkcs8', pemBody(keyPem, 'PRIVATE KEY'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']);
    jwk = (await crypto.subtle.exportKey('jwk', imported)) as JsonWebKey;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('The private key could not be read. Upload an unencrypted PKCS#8 RSA key.');
  }
  const certKey = cert.publicKey as forgeModule.pki.rsa.PublicKey;
  if (!jwk.n || !certKey.n || base64UrlToHex(jwk.n) !== certKey.n.toString(16).replace(/^0+/, '')) {
    throw new ConflictError('signing_pair_mismatch', 'The key does not match the certificate.');
  }
  if (cert.validity.notBefore.getTime() > now.getTime() || cert.validity.notAfter.getTime() < now.getTime()) {
    throw new ConflictError('signing_cert_not_valid', 'The certificate is not valid today. Upload a certificate that is valid now.');
  }
  const cn = cert.subject.getField('CN');
  return {
    keyPem,
    certPem: forge.pki.certificateToPem(cert),
    subject: subjectLine(cert),
    commonName: cn && typeof cn.value === 'string' ? decodeField(cn.value) : '',
    serial: cert.serialNumber,
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
  };
}

/**
 * Stores a checked pair as the business's active key. The old active row, if any, is retired in
 * the same transaction. Signed PDFs never change. Audited as signing.create or signing.upload,
 * and signing.retire for the old row. Returns a warning when the subject does not name the business.
 */
export async function storeSigningKey(
  db: D1Database,
  env: Pick<Env, 'ITA_TOKEN_KEY'>,
  actor: AuditActor,
  businessId: number,
  input: { keyPem: string; certPem: string; source: SigningKeySource },
  now = new Date(),
): Promise<{ key: SigningKeyInfo; warning: string | null }> {
  const checked = await checkPair(input.keyPem, input.certPem, now);
  const cryptoKey = await importTokenKey(env.ITA_TOKEN_KEY);
  const keyEnc = await encryptToken(cryptoKey, checked.keyPem, keyContext(businessId));
  const business = await first<{ name_en: string; name_he: string }>(db, 'SELECT name_en, name_he FROM businesses WHERE id = ?', businessId);
  const names = [business?.name_en, business?.name_he].map((n) => (n ?? '').trim()).filter(Boolean);
  const warning = names.length > 0 && !names.includes(checked.commonName.trim()) ? `The certificate names "${checked.commonName}", not this business.` : null;
  const old = await activeSigningKey(db, businessId);
  const at = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (old) {
    statements.push(stmt(db, "UPDATE business_signing_keys SET status = 'retired', retired_at = ? WHERE id = ? AND status = 'active'", at, old.id));
    statements.push(auditStatement(db, actor, 'signing.retire', 'signing_key', old.id, { serial: old.serial }));
  }
  statements.push(
    stmt(
      db,
      `INSERT INTO business_signing_keys (business_id, key_enc, cert_pem, subject, serial, not_before, not_after, source, status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      businessId,
      keyEnc,
      checked.certPem,
      checked.subject,
      checked.serial,
      checked.notBefore,
      checked.notAfter,
      input.source,
      at,
      actor.email ?? null,
    ),
  );
  statements.push(
    auditStatement(db, actor, input.source === 'generated' ? 'signing.create' : 'signing.upload', 'signing_key', null, {
      subject: checked.subject,
      serial: checked.serial,
      notAfter: checked.notAfter,
    }),
  );
  await transaction(db, statements);
  const row = (await activeSigningKey(db, businessId))!;
  return { key: infoOf(row), warning };
}

/**
 * R48 task 3: the daily check. A task for the business's owners 60 and 14 days before the active
 * certificate ends, once each. The task names the serial, so a new key gets its own tasks.
 */
export async function addExpiryTasks(db: D1Database, businessId: number, today: string): Promise<number> {
  const row = await activeSigningKey(db, businessId);
  if (!row) return 0;
  const end = row.not_after.slice(0, 10);
  const daysLeft = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  let added = 0;
  for (const mark of [60, 14]) {
    if (daysLeft > mark) continue;
    const kind = `signing_expiry_${mark}`;
    const title = `The signing certificate ends on ${end} (serial ${row.serial}). Create a new key in Settings > Digital signature.`;
    const exists = await first(db, 'SELECT 1 FROM tasks WHERE kind = ? AND business_id = ? AND title = ?', kind, businessId, title);
    if (exists) continue;
    await db.prepare('INSERT INTO tasks (kind, title, due_at, business_id) VALUES (?, ?, ?, ?)').bind(kind, title, end, businessId).run();
    added++;
  }
  return added;
}
