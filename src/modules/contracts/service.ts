import { type AuditActor, actorBiz, auditStatement, systemActorFor } from '../../core/audit';
import type { Role } from '../../core/auth';
import { all, first, nowIso, stmt, todayIsrael, transaction } from '../../core/db';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../core/errors';
import { HOME_CURRENCY, isCurrency } from '../../core/money';
import type { Env } from '../../env';
import { printedIdentity } from '../businesses/service';
import { clientDisplayName } from '../clients/display';
import { type ClientRow, getClient } from '../clients/service';
import type { Ctx as DocumentsCtx } from '../documents/service';
import { createDraft as createDocumentDraft } from '../documents/service';
import type { DraftInput } from '../documents/schemas';
import type { Notifier } from '../ita/notify';
import type { PdfEngine } from '../pdf/engine';
import { resolveSigningIdentity } from '../pdf/signing';
import { imageDataUri } from '../pdf/signature-image';
import type { Mailer } from '../sending/mailer';
import { signSendToken, verifySendToken } from '../sending/tokens';
import { signPdf } from '../signing';
import { placeFields } from './fields-pdf';
import { type EvidenceEvent, FIELD_LINK_PREFIX, type FieldBox, isMoney, isScope, renderContract, valueText } from './render';
import { getTemplate, templateVersion } from './templates';
import {
  CODE_MAX_TRIES,
  CODE_COOLDOWN_MS,
  CODE_TTL_MS,
  type CodeRow,
  type ContractEventRow,
  type ContractInput,
  type ContractRow,
  type ContractStatus,
  EXPIRING_WITHIN_DAYS,
  type FieldDef,
  type FieldValues,
  MAX_SIGNATURE_BYTES,
  type TemplateVersionRow,
  UNSIGNED_AFTER_DAYS,
} from './types';
import { missingOwnerFields, normalizeOwnerValues, prefill, scopeFees, suggestedSigner } from './values';

/** R25: the life of a contract. Draft, send, view, sign or decline, void, pro forma. */

export const SIGN_PATH = '/api/sending/public/c/';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContractDeps {
  env: Env;
  engine: PdfEngine;
  /** Null when email is not set up: no email sends, and the signing page skips the code step. */
  mailer: Mailer | null;
  notifier: Notifier;
  baseUrl: string;
  now?: () => Date;
}

const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());

export async function sha256Hex(bytes: BufferSource | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** R2 key: content-addressed per business, write-once. */
export function contractPdfKey(businessId: number, sha256: string): string {
  return `business/${businessId}/contracts/${sha256}.pdf`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getContract(db: D1Database, businessId: number, id: number): Promise<ContractRow> {
  const row = await first<ContractRow>(db, 'SELECT * FROM contracts WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Contract', id);
  return row;
}

/** An accountant sees signed contracts only. Anything else reads as not found. */
export async function getVisibleContract(db: D1Database, businessId: number, id: number, role: Role): Promise<ContractRow> {
  const row = await getContract(db, businessId, id);
  if (role === 'accountant' && row.status !== 'signed') throw new NotFoundError('Contract', id);
  return row;
}

export interface EventView {
  id: number;
  kind: string;
  label: string;
  actor: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

/** The line Screen D and the evidence page print for one event. */
export function eventLabel(e: Pick<ContractEventRow, 'kind' | 'actor_email' | 'details_json'>): string {
  const d = (e.details_json ? JSON.parse(e.details_json) : {}) as Record<string, string | undefined>;
  switch (e.kind) {
    case 'created':
      return `Created by ${e.actor_email ?? 'the Ledger'}`;
    case 'owner_signed':
      return `Signed by ${d.name ?? e.actor_email ?? 'the owner'} (owner)`;
    case 'sent':
      return d.channel === 'email' ? `Sent to ${d.to ?? ''} by email · hash ${(d.sha256 ?? '').slice(0, 4)}…` : `Signing link made · hash ${(d.sha256 ?? '').slice(0, 4)}…`;
    case 'reminded':
      return d.channel === 'email' ? `Reminder sent to ${d.to ?? ''}` : 'Reminder link copied';
    case 'viewed':
      return 'Opened';
    case 'code_sent':
      return `Code sent to ${d.to ?? ''}`;
    case 'code_confirmed':
      return `Code confirmed for ${d.to ?? ''}`;
    case 'code_failed':
      return 'Wrong code';
    case 'signed':
      return `Signed by ${[d.name, d.role].filter(Boolean).join(', ')}${d.sha256 ? ` · final hash ${d.sha256.slice(0, 4)}…` : ''}`;
    case 'signed_copy_emailed':
      return 'Signed copy emailed to both sides';
    case 'declined':
      return d.reason ? `Declined: ${d.reason}` : 'Declined';
    case 'expired':
      return 'Link expired';
    case 'voided':
      return d.reason ? `Voided: ${d.reason}` : 'Voided';
    case 'proforma_created':
      return 'Draft pro forma created';
    default:
      return e.kind;
  }
}

function toEventView(e: ContractEventRow): EventView {
  return {
    id: e.id,
    kind: e.kind,
    label: eventLabel(e),
    actor: e.actor_email,
    role: e.actor_role,
    ip: e.ip,
    userAgent: e.user_agent,
    details: e.details_json ? (JSON.parse(e.details_json) as Record<string, unknown>) : null,
    at: e.created_at,
  };
}

export async function contractEvents(db: D1Database, contractId: number): Promise<EventView[]> {
  return (await all<ContractEventRow>(db, 'SELECT * FROM contract_events WHERE contract_id = ? ORDER BY id', contractId)).map(toEventView);
}

export interface ContractSummary {
  id: number;
  title: string;
  kind: ContractRow['kind'];
  templateName: string;
  status: ContractStatus;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  signerEmail: string | null;
}

export async function listClientContracts(db: D1Database, businessId: number, clientId: number, role: Role): Promise<ContractSummary[]> {
  await getClient(db, clientId, businessId);
  const rows = await all<ContractRow & { template_name: string }>(
    db,
    `SELECT c.*, t.name AS template_name FROM contracts c JOIN contract_templates t ON t.id = c.template_id
     WHERE c.business_id = ? AND c.client_id = ? ${role === 'accountant' ? "AND c.status = 'signed'" : ''} ORDER BY c.created_at DESC, c.id DESC`,
    businessId,
    clientId,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    templateName: r.template_name,
    status: r.status,
    sentAt: r.sent_at,
    viewedAt: r.viewed_at,
    signedAt: r.signed_at,
    expiresAt: r.expires_at,
    signerEmail: r.signer_email,
  }));
}

export interface ContractDetail extends ContractSummary {
  clientId: number;
  clientName: string;
  templateId: number;
  templateVersion: number;
  language: ContractRow['language'];
  values: FieldValues;
  signerValues: Record<string, string> | null;
  fields: FieldDef[];
  signer: { name: string | null; email: string | null; phone: string | null };
  linkDays: number;
  ownerSign: boolean;
  declineReason: string | null;
  sentSha256: string | null;
  signedSha256: string | null;
  identityMethod: ContractRow['identity_method'];
  linkedDocumentId: number | null;
  events: EventView[];
}

export async function contractDetail(db: D1Database, businessId: number, id: number, role: Role): Promise<ContractDetail> {
  const row = await getVisibleContract(db, businessId, id, role);
  const template = await getTemplate(db, businessId, row.template_id);
  const version = await templateVersion(db, businessId, row.template_id, row.template_version);
  const client = await getClient(db, row.client_id, businessId);
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    templateName: template.name,
    status: row.status,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
    signerEmail: row.signer_email,
    clientId: row.client_id,
    clientName: clientDisplayName(client, 'en'),
    templateId: row.template_id,
    templateVersion: row.template_version,
    language: row.language,
    values: JSON.parse(row.field_values_json) as FieldValues,
    signerValues: row.signer_values_json ? (JSON.parse(row.signer_values_json) as Record<string, string>) : null,
    fields: JSON.parse(version.fields_json) as FieldDef[],
    signer: { name: row.signer_name, email: row.signer_email, phone: row.signer_phone },
    linkDays: row.link_days,
    ownerSign: row.owner_sign === 1,
    declineReason: row.decline_reason,
    sentSha256: row.sent_pdf_sha256,
    signedSha256: row.signed_pdf_sha256,
    identityMethod: row.identity_method,
    linkedDocumentId: row.linked_document_id,
    events: await contractEvents(db, row.id),
  };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface EventActor {
  email: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
}

const fromAudit = (a: AuditActor): EventActor => ({ email: a.email, role: a.role, ip: a.ip, userAgent: a.userAgent });

function eventStatement(db: D1Database, contract: Pick<ContractRow, 'id' | 'business_id'>, kind: string, actor: EventActor, details?: Record<string, unknown>, at?: string): D1PreparedStatement {
  return stmt(
    db,
    'INSERT INTO contract_events (contract_id, business_id, kind, actor_email, actor_role, ip, user_agent, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    contract.id,
    contract.business_id,
    kind,
    actor.email,
    actor.role,
    actor.ip,
    actor.userAgent?.slice(0, 300) ?? null,
    details ? JSON.stringify(details) : null,
    at ?? nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** What Screen B starts from: the template's fields with every value the Ledger already knows. */
export async function newContractDefaults(db: D1Database, env: Pick<Env, 'OWNER_TAX_ID'>, businessId: number, clientId: number, templateId: number) {
  const client = await getClient(db, clientId, businessId);
  const version = await templateVersion(db, businessId, templateId);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  return {
    templateId,
    templateVersion: version.version,
    kind: version.kind,
    title: `${version.name}, ${clientDisplayName(client, 'en')}`,
    fields,
    values: await prefill(db, businessId, client, fields, env.OWNER_TAX_ID ?? null),
    signer: await suggestedSigner(db, client),
  };
}

async function draftValues(db: D1Database, env: Pick<Env, 'OWNER_TAX_ID'>, businessId: number, client: ClientRow, version: TemplateVersionRow, raw: Record<string, unknown>): Promise<FieldValues> {
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const base = await prefill(db, businessId, client, fields, env.OWNER_TAX_ID ?? null);
  return { ...base, ...(await normalizeOwnerValues(db, businessId, fields, raw)) };
}

export async function createContractDraft(db: D1Database, env: Pick<Env, 'OWNER_TAX_ID'>, actor: AuditActor, input: ContractInput): Promise<number> {
  const businessId = actorBiz(actor);
  const client = await getClient(db, input.clientId, businessId);
  const template = await getTemplate(db, businessId, input.templateId);
  if (template.active !== 1) throw new ValidationError('This template is turned off.');
  const version = await templateVersion(db, businessId, template.id);
  const values = await draftValues(db, env, businessId, client, version, input.values);
  const title = input.title?.trim() || `${version.name}, ${clientDisplayName(client, 'en')}`;
  const res = await transaction(db, [
    stmt(
      db,
      `INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, language, field_values_json, signer_name, signer_email, signer_phone, link_days, owner_sign, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      businessId,
      client.id,
      template.id,
      version.version,
      template.kind,
      title,
      input.language,
      JSON.stringify(values),
      input.signer.name?.trim() || null,
      input.signer.email?.trim() || null,
      input.signer.phone?.trim() || null,
      input.linkDays,
      input.ownerSign ? 1 : 0,
      actor.userId,
    ),
    auditStatement(db, actor, 'contract.create', 'contract', null, { clientId: client.id, templateId: template.id, version: version.version }),
  ]);
  const id = Number(res[0]!.meta.last_row_id);
  await transaction(db, [eventStatement(db, { id, business_id: businessId }, 'created', fromAudit(actor), { templateVersion: version.version })]);
  return id;
}

/** A draft follows the current template version until it is sent. */
export async function updateContractDraft(db: D1Database, env: Pick<Env, 'OWNER_TAX_ID'>, actor: AuditActor, id: number, input: ContractInput): Promise<void> {
  const businessId = actorBiz(actor);
  const row = await getContract(db, businessId, id);
  if (row.status !== 'draft') throw new ConflictError('contract_fixed', 'Only a draft can change. Void it and make a new one.');
  if (input.clientId !== row.client_id) throw new ValidationError('A contract keeps its client.');
  const client = await getClient(db, row.client_id, businessId);
  const template = await getTemplate(db, businessId, input.templateId);
  if (template.kind !== row.kind) throw new ValidationError('Pick a template of the same kind, or make a new contract.');
  const version = await templateVersion(db, businessId, template.id);
  const values = await draftValues(db, env, businessId, client, version, input.values);
  await transaction(db, [
    stmt(
      db,
      `UPDATE contracts SET template_id = ?, template_version = ?, title = ?, language = ?, field_values_json = ?, signer_name = ?, signer_email = ?, signer_phone = ?,
         link_days = ?, owner_sign = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
      template.id,
      version.version,
      input.title?.trim() || row.title,
      input.language,
      JSON.stringify(values),
      input.signer.name?.trim() || null,
      input.signer.email?.trim() || null,
      input.signer.phone?.trim() || null,
      input.linkDays,
      input.ownerSign ? 1 : 0,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'contract.update', 'contract', id, { version: version.version }),
  ]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function identityFor(env: Env, businessId: number) {
  const identity = await printedIdentity(env.DB, businessId, null);
  return { nameEn: identity.nameEn, nameHe: identity.nameHe, logoDataUri: await imageDataUri(env.FILES, identity.logoR2Key) };
}

/** The owner's saved signature image (Settings > Signature), as bytes and a data URI. PNG or JPEG only. */
export async function ownerSignatureImage(env: Env, businessId: number): Promise<{ bytes: Uint8Array; dataUri: string } | null> {
  const row = await first<{ signature_r2_key: string | null }>(env.DB, 'SELECT signature_r2_key FROM businesses WHERE id = ?', businessId);
  if (!row?.signature_r2_key) return null;
  const object = await env.FILES.get(row.signature_r2_key);
  if (!object) return null;
  const type = object.httpMetadata?.contentType ?? '';
  if (type !== 'image/png' && type !== 'image/jpeg') return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return { bytes, dataUri: `data:${type};base64,${btoa(binary)}` };
}

/** The live preview: the HTML the PDF uses, with the field boxes tinted. Nothing is stored. */
export async function previewHtml(env: Env, actor: AuditActor, input: ContractInput): Promise<string> {
  const businessId = actorBiz(actor);
  const client = await getClient(env.DB, input.clientId, businessId);
  const version = await templateVersion(env.DB, businessId, input.templateId);
  const values = await draftValues(env.DB, env, businessId, client, version, input.values);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const owner = input.ownerSign ? await ownerSignatureImage(env, businessId) : null;
  return renderContract({
    title: input.title?.trim() || version.name,
    kind: version.kind,
    language: input.language,
    bodyEn: version.body_en,
    bodyHe: version.body_he,
    fields,
    values: { ...values, ...signerNameValues(fields, input.signer.name ?? '') },
    identity: await identityFor(env, businessId),
    mode: 'preview',
    signatureImages: owner ? { owner: owner.dataUri } : {},
  }).html;
}

/** The signer's name, shown in signer name fields of the preview so the owner sees who signs. */
function signerNameValues(fields: FieldDef[], name: string): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) if (f.kind === 'signer_input' && f.inputType === 'name') out[f.key] = name;
  return out;
}

async function renderPdfWithFields(
  deps: Pick<ContractDeps, 'engine'>,
  html: string,
  boxes: FieldBox[],
  lock: (box: FieldBox) => boolean,
  signatureImages: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  const raw = new Uint8Array(await deps.engine.renderPdf(html));
  const { bytes } = await placeFields(raw, boxes, { lock, signatureImages });
  return bytes;
}

async function storeWriteOnce(env: Env, businessId: number, bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
  const sha256 = await sha256Hex(bytes);
  const key = contractPdfKey(businessId, sha256);
  // Same key means same bytes. The files bucket never overwrites.
  if (!(await env.FILES.head(key))) await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  return { key, sha256 };
}

// ---------------------------------------------------------------------------
// Send, remind, void
// ---------------------------------------------------------------------------

export async function signingUrl(env: Pick<Env, 'SEND_LINK_KEY'>, baseUrl: string, row: Pick<ContractRow, 'id' | 'expires_at'>): Promise<string> {
  if (!row.expires_at) throw new ValidationError('This contract has no signing link yet.');
  const exp = Math.floor(Date.parse(row.expires_at) / 1000);
  const token = await signSendToken(env, { kind: 'contract', contractId: row.id, exp });
  return `${baseUrl}${SIGN_PATH}${token}`;
}

export function whatsappUrl(phone: string | null, message: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '972');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

async function senderLabel(db: D1Database, businessId: number): Promise<string> {
  const identity = await printedIdentity(db, businessId, null);
  return identity.nameEn.trim() || identity.nameHe.trim() || 'Your supplier';
}

function inviteEmail(sender: string, title: string, url: string, expiresAt: string, reminder: boolean) {
  const lead = reminder ? `A reminder: ${sender} sent you ${title} to sign.` : `${sender} sent you ${title} to sign.`;
  return {
    subject: reminder ? `Reminder: ${title} is waiting for your signature` : `${sender} sent you ${title} to sign`,
    html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(url)}">Open and sign</a></p><p>The link works until ${escapeHtml(expiresAt.slice(0, 10))}.</p></body></html>`,
    text: `${lead}\n\nOpen and sign: ${url}\nThe link works until ${expiresAt.slice(0, 10)}.\n`,
  };
}

export interface SendResult {
  url: string;
  whatsappUrl: string;
  expiresAt: string;
  emailed: boolean;
  sha256: string;
}

/**
 * Sends a draft: renders the PDF with its fields, stores it write-once, freezes the values and the
 * template version, makes the signed link and emails it when email is set up.
 */
export async function sendContract(deps: ContractDeps, actor: AuditActor & { name?: string | null }, id: number, opts: { channel: 'email' | 'link' }): Promise<SendResult> {
  const { env } = deps;
  const db = env.DB;
  const businessId = actorBiz(actor);
  const row = await getContract(db, businessId, id);
  if (row.status !== 'draft') throw new ConflictError('contract_fixed', 'This contract was already sent.');
  const version = await templateVersion(db, businessId, row.template_id, row.template_version);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const values = JSON.parse(row.field_values_json) as FieldValues;
  const missing = missingOwnerFields(fields, values);
  if (missing.length > 0) throw new ValidationError(`Fill these fields first: ${missing.join(', ')}.`);
  if (!row.signer_name || !row.signer_email) throw new ValidationError('Add the signer name and email.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.signer_email)) throw new ValidationError('The signer email is not valid.');
  if (opts.channel === 'email' && !deps.mailer) throw new ValidationError('Email is not set up. Copy the link or share it on WhatsApp.');

  const now = nowOf(deps);
  const today = todayIsrael(now);
  const ownerSigns = row.owner_sign === 1;
  let ownerImage: Uint8Array | null = null;
  if (ownerSigns) {
    if (actor.role !== 'owner') throw new ForbiddenError('Only the owner signs for the business.');
    const image = await ownerSignatureImage(env, businessId);
    if (!image) throw new ValidationError('Upload your signature as PNG or JPG in Settings > Signature, or send without signing.');
    ownerImage = image.bytes;
    for (const f of fields) if (f.kind === 'signed_date' && f.party === 'owner') values[f.key] = today;
  }

  const rendered = renderContract({
    title: row.title,
    kind: row.kind,
    language: row.language,
    bodyEn: version.body_en,
    bodyHe: version.body_he,
    fields,
    values,
    identity: await identityFor(env, businessId),
    mode: 'pdf',
  });
  const images: Record<string, Uint8Array> = {};
  if (ownerImage) for (const f of fields) if (f.kind === 'signature' && f.party === 'owner') images[f.key] = ownerImage;
  // Values the owner filled lock now. Signer fields stay open in the sent copy. The owner's
  // signature field locks once the owner signed.
  const pdf = await renderPdfWithFields(deps, rendered.html, rendered.boxes, (b) => b.group === 'owner' || (b.group === 'owner_signature' && ownerSigns), images);
  const stored = await storeWriteOnce(env, businessId, pdf);

  const sentAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + row.link_days * DAY_MS).toISOString();
  const url = await signingUrl(env, deps.baseUrl, { id: row.id, expires_at: expiresAt });
  const ev = fromAudit(actor);
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `UPDATE contracts SET status = 'sent', field_values_json = ?, sent_at = ?, expires_at = ?, sent_pdf_r2_key = ?, sent_pdf_sha256 = ?,
         owner_signed_at = ?, owner_signed_by = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
      JSON.stringify(values),
      sentAt,
      expiresAt,
      stored.key,
      stored.sha256,
      ownerSigns ? sentAt : null,
      ownerSigns ? actor.userId : null,
      sentAt,
      row.id,
    ),
  ];
  if (ownerSigns) statements.push(eventStatement(db, row, 'owner_signed', ev, { name: actor.name || actor.email }, sentAt));
  statements.push(
    eventStatement(db, row, 'sent', ev, { channel: opts.channel, to: opts.channel === 'email' ? row.signer_email : null, sha256: stored.sha256, expiresAt }, sentAt),
    auditStatement(db, actor, 'contract.send', 'contract', row.id, { channel: opts.channel, sha256: stored.sha256, ownerSigned: ownerSigns, templateVersion: row.template_version }),
  );
  await transaction(db, statements);

  const sender = await senderLabel(db, businessId);
  let emailed = false;
  if (opts.channel === 'email' && deps.mailer) {
    const mail = inviteEmail(sender, row.title, url, expiresAt, false);
    await deps.mailer.send({ to: row.signer_email, fromName: sender, ...mail });
    emailed = true;
  }
  return {
    url,
    whatsappUrl: whatsappUrl(row.signer_phone, `${sender} sent you ${row.title} to sign: ${url}`),
    expiresAt,
    emailed,
    sha256: stored.sha256,
  };
}

/** Re-sends the same link. Logged every time. */
export async function remindContract(deps: ContractDeps, actor: AuditActor, id: number, opts: { channel: 'email' | 'link' }): Promise<SendResult> {
  const { env } = deps;
  const businessId = actorBiz(actor);
  const row = await getContract(env.DB, businessId, id);
  if (row.status !== 'sent' && row.status !== 'viewed') throw new ConflictError('contract_not_open', 'Only a sent contract that is not signed gets a reminder.');
  const now = nowOf(deps);
  if (!row.expires_at || Date.parse(row.expires_at) <= now.getTime()) throw new ConflictError('contract_expired', 'The link expired. Void this contract and send a new one.');
  if (opts.channel === 'email' && !deps.mailer) throw new ValidationError('Email is not set up. Copy the link or share it on WhatsApp.');
  const url = await signingUrl(env, deps.baseUrl, row);
  await transaction(env.DB, [
    eventStatement(env.DB, row, 'reminded', fromAudit(actor), { channel: opts.channel, to: opts.channel === 'email' ? row.signer_email : null }),
    auditStatement(env.DB, actor, 'contract.remind', 'contract', row.id, { channel: opts.channel }),
  ]);
  const sender = await senderLabel(env.DB, businessId);
  let emailed = false;
  if (opts.channel === 'email' && deps.mailer && row.signer_email) {
    await deps.mailer.send({ to: row.signer_email, fromName: sender, ...inviteEmail(sender, row.title, url, row.expires_at, true) });
    emailed = true;
  }
  return { url, whatsappUrl: whatsappUrl(row.signer_phone, `${sender} sent you ${row.title} to sign: ${url}`), expiresAt: row.expires_at, emailed, sha256: row.sent_pdf_sha256 ?? '' };
}

/** Void keeps the row and its history. Only an unsigned contract can be voided. */
export async function voidContract(db: D1Database, actor: AuditActor, id: number, reason: string | null): Promise<void> {
  const row = await getContract(db, actorBiz(actor), id);
  if (row.status === 'signed') throw new ConflictError('contract_fixed', 'A signed contract is never voided.');
  if (row.status === 'void') return;
  const at = nowIso();
  await transaction(db, [
    stmt(db, "UPDATE contracts SET status = 'void', void_at = ?, updated_at = ? WHERE id = ?", at, at, id),
    eventStatement(db, row, 'voided', fromAudit(actor), { reason }, at),
    auditStatement(db, actor, 'contract.void', 'contract', id, { reason }),
  ]);
}

/** Opens a stored PDF for a signed-in person. Every opening is audited. */
export async function openContractPdf(env: Env, actor: AuditActor, id: number, which: 'sent' | 'signed', disposition: 'inline' | 'attachment') {
  const row = await getVisibleContract(env.DB, actorBiz(actor), id, (actor.role ?? 'owner') as Role);
  const key = which === 'signed' ? row.signed_pdf_r2_key : row.sent_pdf_r2_key;
  if (!key) throw new NotFoundError(which === 'signed' ? 'Signed PDF' : 'Sent PDF', id);
  const object = await env.FILES.get(key);
  if (!object) throw new NotFoundError('Contract file', id);
  await transaction(env.DB, [auditStatement(env.DB, actor, disposition === 'inline' ? 'contract.view' : 'contract.download', 'contract', id, { which })]);
  return { row, object };
}

// ---------------------------------------------------------------------------
// The public signing link
// ---------------------------------------------------------------------------

export type LinkState = { state: 'open'; row: ContractRow } | { state: 'signed'; row: ContractRow } | { state: 'closed'; row: ContractRow | null; message: string };

/** Signature, kind, row, status and expiry all have to agree. A forged or edited token opens nothing. */
export async function contractFromToken(deps: Pick<ContractDeps, 'env' | 'now'>, token: string): Promise<LinkState> {
  let payload;
  try {
    payload = await verifySendToken(deps.env, token);
  } catch (err) {
    if (err instanceof UnauthorizedError) return { state: 'closed', row: null, message: err.message };
    throw err;
  }
  if (payload.kind !== 'contract') return { state: 'closed', row: null, message: 'This link is not valid.' };
  const row = await first<ContractRow>(deps.env.DB, 'SELECT * FROM contracts WHERE id = ?', payload.contractId);
  if (!row || !row.expires_at || Math.floor(Date.parse(row.expires_at) / 1000) !== payload.exp) return { state: 'closed', row: null, message: 'This link is not valid.' };
  if (row.status === 'signed') return { state: 'signed', row };
  if (row.status === 'void') return { state: 'closed', row, message: 'The sender withdrew this document.' };
  if (row.status === 'declined') return { state: 'closed', row, message: 'This document was declined.' };
  if (row.status === 'expired' || Date.parse(row.expires_at) <= nowOf(deps).getTime()) return { state: 'closed', row, message: 'This link has expired.' };
  if (row.status !== 'sent' && row.status !== 'viewed') return { state: 'closed', row, message: 'This link is not valid.' };
  return { state: 'open', row };
}

export interface PublicRequest {
  ip: string | null;
  userAgent: string | null;
}

const signerActor = (row: ContractRow, req: PublicRequest): EventActor => ({ email: row.signer_email, role: 'signer', ip: req.ip, userAgent: req.userAgent });

/** Opening the page logs `viewed` with IP and user agent. The first opening moves sent to viewed. */
export async function markViewed(db: D1Database, row: ContractRow, req: PublicRequest): Promise<void> {
  const at = nowIso();
  const statements = [eventStatement(db, row, 'viewed', signerActor(row, req), undefined, at)];
  if (row.status === 'sent') statements.unshift(stmt(db, "UPDATE contracts SET status = 'viewed', viewed_at = ? WHERE id = ? AND status = 'sent'", at, row.id));
  await transaction(db, statements);
}

async function codeHash(env: Pick<Env, 'SEND_LINK_KEY'>, contractId: number, code: string): Promise<string> {
  return sha256Hex(`${env.SEND_LINK_KEY ?? ''}:${contractId}:${code}`);
}

function sixDigits(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0]! % 1_000_000).padStart(6, '0');
}

/** Emails a new 6-digit code. Earlier codes stop working. */
export async function requestCode(deps: ContractDeps, row: ContractRow, req: PublicRequest, opts: { code?: string } = {}): Promise<{ sentTo: string }> {
  if (!deps.mailer) throw new ConflictError('code_not_needed', 'No code is needed for this link.');
  if (!row.signer_email) throw new ValidationError('This contract has no signer email.');
  const now = nowOf(deps);
  // Earlier codes stay valid until they expire: emails arrive late or out of order, so whichever
  // one reaches the inbox works. A locked code (too many tries) never comes back.
  const last = await first<CodeRow>(deps.env.DB, 'SELECT * FROM contract_codes WHERE contract_id = ? ORDER BY id DESC LIMIT 1', row.id);
  if (last && last.attempts < CODE_MAX_TRIES && now.getTime() - Date.parse(last.created_at) < CODE_COOLDOWN_MS) {
    throw new ValidationError('A code is on its way. Check your inbox and spam, and ask again in a minute.');
  }
  const code = opts.code ?? sixDigits();
  const minutes = Math.round(CODE_TTL_MS / 60000);
  await transaction(deps.env.DB, [
    stmt(
      deps.env.DB,
      'INSERT INTO contract_codes (contract_id, code_hash, sent_to, expires_at) VALUES (?, ?, ?, ?)',
      row.id,
      await codeHash(deps.env, row.id, code),
      row.signer_email,
      new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    ),
    eventStatement(deps.env.DB, row, 'code_sent', signerActor(row, req), { to: row.signer_email }),
  ]);
  const sender = await senderLabel(deps.env.DB, row.business_id);
  await deps.mailer.send({
    to: row.signer_email,
    fromName: sender,
    subject: `Your code to sign ${row.title}`,
    html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>Your code to sign ${escapeHtml(row.title)} from ${escapeHtml(sender)}:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It works for ${minutes} minutes.</p></body></html>`,
    text: `Your code to sign ${row.title} from ${sender}: ${code}\nIt works for ${minutes} minutes.\n`,
  });
  return { sentTo: row.signer_email };
}

/** Checks a typed code: any unexpired code works, 5 wrong tries lock them all, then a new code. */
async function checkCode(deps: ContractDeps, row: ContractRow, code: string, req: PublicRequest): Promise<void> {
  const db = deps.env.DB;
  const latest = await first<CodeRow>(db, 'SELECT * FROM contract_codes WHERE contract_id = ? ORDER BY id DESC LIMIT 1', row.id);
  if (!latest) throw new ValidationError('Ask for a code first.');
  if (latest.attempts >= CODE_MAX_TRIES) throw new ValidationError('Too many tries. Ask for a new code.');
  const nowIsoText = nowOf(deps).toISOString();
  const live = await all<CodeRow>(
    db,
    'SELECT * FROM contract_codes WHERE contract_id = ? AND superseded = 0 AND attempts < ? AND expires_at > ? ORDER BY id DESC',
    row.id,
    CODE_MAX_TRIES,
    nowIsoText,
  );
  if (live.length === 0) throw new ValidationError('The code expired. Ask for a new one.');
  const hash = await codeHash(deps.env, row.id, code.replace(/\s+/g, ''));
  const match = live.find((c) => c.code_hash === hash);
  if (!match) {
    const newest = live[0]!;
    const lock = newest.attempts + 1 >= CODE_MAX_TRIES;
    await transaction(db, [
      stmt(db, 'UPDATE contract_codes SET attempts = attempts + 1 WHERE id = ?', newest.id),
      ...(lock ? [stmt(db, 'UPDATE contract_codes SET superseded = 1 WHERE contract_id = ? AND id <> ? AND superseded = 0', row.id, newest.id)] : []),
      eventStatement(db, row, 'code_failed', signerActor(row, req), { attempt: newest.attempts + 1 }),
    ]);
    const left = CODE_MAX_TRIES - newest.attempts - 1;
    throw new ValidationError(left > 0 ? `The code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries. Ask for a new code.');
  }
  await transaction(db, [
    stmt(db, 'UPDATE contract_codes SET confirmed_at = ? WHERE id = ?', nowIso(), match.id),
    eventStatement(db, row, 'code_confirmed', signerActor(row, req), { to: match.sent_to }),
  ]);
}

function decodePngDataUri(dataUri: string): Uint8Array {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!m) throw new ValidationError('Draw or type your signature.');
  const binary = atob(m[1]!);
  if (binary.length > MAX_SIGNATURE_BYTES) throw new ValidationError('The signature image is too large.');
  if (binary.length < 100) throw new ValidationError('Draw or type your signature.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new ValidationError('The signature image is not a PNG.');
  return bytes;
}

export interface SignInput {
  values: Record<string, string>;
  code?: string | null;
  signaturePng: string;
  consent: boolean;
}

/**
 * The signature. Renders the final PDF from the sent version plus what the signer typed, puts the
 * signature images in their fields, locks every field, appends the evidence page, then applies the
 * Ledger's certificate signature as a certifying signature. Stored write-once. The sent PDF stays.
 */
export async function signContract(deps: ContractDeps, row: ContractRow, req: PublicRequest, input: SignInput): Promise<{ sha256: string }> {
  const { env } = deps;
  const db = env.DB;
  if (!input.consent) throw new ValidationError('Tick the box to agree to sign electronically.');
  const version = await templateVersion(db, row.business_id, row.template_id, row.template_version);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const signerValues: Record<string, string> = {};
  for (const f of fields.filter((x) => x.kind === 'signer_input')) {
    const v = (input.values[f.key] ?? '').toString().trim().slice(0, 500);
    if (f.inputType === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(`Use a date like 2026-11-01 for ${f.labelEn || f.key}.`);
    if (f.required && !v) throw new ValidationError(`Fill in ${f.labelEn || f.key}.`);
    signerValues[f.key] = v;
  }
  const signature = decodePngDataUri(input.signaturePng);

  const identityMethod: 'email_code' | 'link_only' = deps.mailer ? 'email_code' : 'link_only';
  if (deps.mailer) {
    if (!input.code) throw new ValidationError('Type the code we emailed you.');
    await checkCode(deps, row, input.code, req);
  }

  const now = nowOf(deps);
  const signedAt = now.toISOString();
  // Every signing date is the date in Israel, so a contract signed after midnight Israel time gets that day.
  const today = todayIsrael(now);
  const values = { ...(JSON.parse(row.field_values_json) as FieldValues), ...signerValues };
  for (const f of fields) if (f.kind === 'signed_date' && f.party === 'client') values[f.key] = today;

  const signerName = signerValues[fields.find((f) => f.kind === 'signer_input' && f.inputType === 'name')?.key ?? ''] || row.signer_name || '';
  const signerRole = signerValues[fields.find((f) => f.kind === 'signer_input' && f.inputType === 'role')?.key ?? ''] || '';
  const signedContentSha256 = await sha256Hex(
    JSON.stringify({ sentPdfSha256: row.sent_pdf_sha256, signerValues, signatureSha256: await sha256Hex(signature), signedAt }),
  );
  const events = await contractEvents(db, row.id);
  const evidenceEvents: EvidenceEvent[] = [
    ...events.map((e) => ({ at: e.at, label: e.label, actor: e.actor, ip: e.ip, userAgent: e.userAgent })),
    { at: signedAt, label: `Signed by ${[signerName, signerRole].filter(Boolean).join(', ')}`, actor: row.signer_email, ip: req.ip, userAgent: req.userAgent },
  ];
  const template = await getTemplate(db, row.business_id, row.template_id);
  const rendered = renderContract({
    title: row.title,
    kind: row.kind,
    language: row.language,
    bodyEn: version.body_en,
    bodyHe: version.body_he,
    fields,
    values,
    identity: await identityFor(env, row.business_id),
    mode: 'pdf',
    evidence: {
      contractId: row.id,
      title: row.title,
      templateName: template.name,
      templateVersion: row.template_version,
      sentSha256: row.sent_pdf_sha256 ?? '',
      signedContentSha256,
      identity: identityMethod,
      signerEmail: row.signer_email,
      events: evidenceEvents,
    },
  });
  const images: Record<string, Uint8Array> = {};
  const owner = row.owner_signed_at ? await ownerSignatureImage(env, row.business_id) : null;
  for (const f of fields) {
    if (f.kind !== 'signature') continue;
    if (f.party === 'client') images[f.key] = signature;
    else if (owner) images[f.key] = owner.bytes;
  }
  let pdf = await renderPdfWithFields(deps, rendered.html, rendered.boxes, () => true, images);
  const signing = await resolveSigningIdentity(db, env, row.business_id);
  if (signing) {
    pdf = await signPdf(pdf, {
      ...signing,
      certify: true,
      signedAt: now,
      fieldName: 'ledger_certification',
      signerName: (await senderLabel(db, row.business_id)).slice(0, 100),
      reason: 'Signed electronically through the Ledger. Evidence page attached.',
    });
  }
  const stored = await storeWriteOnce(env, row.business_id, pdf);
  const actor = signerActor(row, req);
  await transaction(db, [
    stmt(
      db,
      `UPDATE contracts SET status = 'signed', signed_at = ?, signer_values_json = ?, signer_name = ?, signed_pdf_r2_key = ?, signed_pdf_sha256 = ?,
         signed_content_sha256 = ?, identity_method = ?, updated_at = ? WHERE id = ? AND status IN ('sent', 'viewed')`,
      signedAt,
      JSON.stringify(signerValues),
      signerName || row.signer_name,
      stored.key,
      stored.sha256,
      signedContentSha256,
      identityMethod,
      signedAt,
      row.id,
    ),
    eventStatement(db, row, 'signed', actor, { name: signerName, role: signerRole, sha256: stored.sha256, certified: Boolean(signing), signedContentSha256 }, signedAt),
    auditStatement(db, { ...systemActorFor(row.business_id), email: row.signer_email, role: 'signer', ip: req.ip, userAgent: req.userAgent }, 'contract.sign', 'contract', row.id, {
      sha256: stored.sha256,
      identityMethod,
    }),
  ]);
  const check = await first<{ status: string }>(db, 'SELECT status FROM contracts WHERE id = ?', row.id);
  if (check?.status !== 'signed') throw new ConflictError('contract_not_open', 'This contract can no longer be signed.');

  const sender = await senderLabel(db, row.business_id);
  if (deps.mailer) {
    const ownerEmails = (
      await all<{ email: string }>(db, "SELECT u.email FROM user_businesses ub JOIN users u ON u.id = ub.user_id WHERE ub.business_id = ? AND ub.role = 'owner' AND u.active = 1", row.business_id)
    ).map((r) => r.email);
    const attachment = { filename: `${row.title.replace(/[^\w.-]+/g, '-')}-signed.pdf`, content: pdf, contentType: 'application/pdf' };
    const recipients = [row.signer_email, ...ownerEmails].filter((e): e is string => Boolean(e));
    for (const to of [...new Set(recipients)]) {
      await deps.mailer.send({
        to,
        fromName: sender,
        subject: `Signed: ${row.title}`,
        html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>${escapeHtml(row.title)} is signed. The signed PDF is attached.</p></body></html>`,
        text: `${row.title} is signed. The signed PDF is attached.\n`,
        attachments: [attachment],
      });
    }
    await transaction(db, [eventStatement(db, row, 'signed_copy_emailed', { email: 'system', role: 'system', ip: null, userAgent: null }, { to: recipients })]);
  }
  await deps.notifier.send(`:white_check_mark: ${signerName || row.signer_email} signed ${row.title} for ${sender}.`);
  return { sha256: stored.sha256 };
}

export async function declineContract(deps: ContractDeps, row: ContractRow, req: PublicRequest, reason: string | null): Promise<void> {
  const db = deps.env.DB;
  const at = nowOf(deps).toISOString();
  const clean = reason?.trim().slice(0, 1000) || null;
  await transaction(db, [
    stmt(db, "UPDATE contracts SET status = 'declined', declined_at = ?, decline_reason = ?, updated_at = ? WHERE id = ? AND status IN ('sent', 'viewed')", at, clean, at, row.id),
    eventStatement(db, row, 'declined', signerActor(row, req), { reason: clean }, at),
  ]);
  const sender = await senderLabel(db, row.business_id);
  await deps.notifier.send(`:x: ${row.signer_name ?? row.signer_email} declined ${row.title} for ${sender}.${clean ? ` Reason: ${clean}` : ''}`);
}

/** The PDF the signing page shows: the signed copy once signed, else the sent copy. */
/**
 * The document as a web page for the signing page, so it reads on any phone without a PDF viewer.
 * Same template version and frozen values as the sent PDF. The client's signature box is a Sign
 * button that scrolls the signing page to the signature step. The PDF stays the signed record.
 */
export async function viewHtml(env: Env, row: ContractRow, signUrl: string, lang: 'en' | 'he'): Promise<string> {
  const version = await templateVersion(env.DB, row.business_id, row.template_id, row.template_version);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const values = JSON.parse(row.field_values_json) as FieldValues;
  let html = renderContract({
    title: row.title,
    kind: row.kind,
    language: row.language,
    bodyEn: version.body_en,
    bodyHe: version.body_he,
    fields,
    values,
    identity: await identityFor(env, row.business_id),
    mode: 'pdf',
  }).html;
  const prefix = FIELD_LINK_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const owner = row.owner_sign === 1 ? await ownerSignatureImage(env, row.business_id) : null;
  const label = lang === 'he' ? 'לחתימה' : 'Sign';
  const jump = `try{parent.document.getElementById('signature').scrollIntoView({behavior:'smooth',block:'center'});return false}catch(e){return true}`;
  for (const f of fields) {
    if (f.kind !== 'signature') continue;
    const open = new RegExp(`<a class="f f-sig" dir="auto" href="${prefix}${encodeURIComponent(f.key)}">\\s*</a>`, 'g');
    if (f.party === 'owner' && owner) html = html.replace(open, `<a class="f f-sig"><img src="${owner.dataUri}" alt=""></a>`);
    if (f.party === 'client') html = html.replace(open, `<a class="f f-sig sign-btn" href="${escapeHtml(signUrl)}" target="_top" onclick="${jump}">${label}</a>`);
  }
  html = html.replace(new RegExp(` href="${prefix}[^"]*"`, 'g'), '');
  const extra = `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>
body { max-width: 820px; margin: 0 auto; padding: 16px; }
@media (max-width: 700px) { body { font-size: 14px; padding: 12px; } a.f-sig { width: 100%; max-width: 260px; height: 64px; } }
a.sign-btn { display: inline-grid; place-items: center; background: #1f5fd1; border-color: #1f5fd1; color: #fff; font-weight: 700; font-size: 16px; text-decoration: none; cursor: pointer; }
</style>`;
  return html.replace('</head>', `${extra}</head>`);
}

export async function publicPdf(env: Env, row: ContractRow): Promise<R2ObjectBody> {
  const key = row.status === 'signed' ? row.signed_pdf_r2_key : row.sent_pdf_r2_key;
  const object = key ? await env.FILES.get(key) : null;
  if (!object) throw new NotFoundError('Contract file', row.id);
  return object;
}

// ---------------------------------------------------------------------------
// Work order to pro forma
// ---------------------------------------------------------------------------

/**
 * Opens a draft pro forma (type 300) for the client of a signed work order. Lines come from the
 * fields the template marks maps_to: one line per ticked service with its fee, or one line per
 * money field. Nothing is finalized: the owner checks the draft in the normal editor.
 */
export async function createProformaFromContract(docCtx: DocumentsCtx, actor: AuditActor, id: number): Promise<number> {
  const db = docCtx.db;
  const businessId = actorBiz(actor);
  const row = await getContract(db, businessId, id);
  if (row.kind !== 'work_order') throw new ValidationError('A pro forma comes from a work order.');
  if (row.status !== 'signed') throw new ValidationError('Wait until the work order is signed.');
  if (row.linked_document_id) return row.linked_document_id;
  const version = await templateVersion(db, businessId, row.template_id, row.template_version);
  const fields = JSON.parse(version.fields_json) as FieldDef[];
  const values = JSON.parse(row.field_values_json) as FieldValues;

  const lines: { description: string; descriptionHe?: string | null; unitPriceMinor: number }[] = [];
  let currency: string | null = null;
  const description = fields.find((f) => f.mapsTo === 'description');
  const descriptionText = description ? valueText(description, values[description.key], 'en') : '';
  for (const field of fields.filter((f) => f.mapsTo === 'amount')) {
    const v = values[field.key];
    if (isScope(v)) {
      for (const s of scopeFees([field], values)) {
        if (!s.fee) continue;
        if (currency && currency !== s.fee.currency) throw new ValidationError('The services use different currencies. Create the pro forma by hand.');
        currency = s.fee.currency;
        lines.push({ description: s.name, descriptionHe: s.nameHe || null, unitPriceMinor: s.fee.amountMinor });
      }
    } else if (isMoney(v)) {
      if (currency && currency !== v.currency) throw new ValidationError('The amounts use different currencies. Create the pro forma by hand.');
      currency = v.currency;
      lines.push({ description: descriptionText.split('\n')[0]?.slice(0, 2000) || row.title, unitPriceMinor: v.amountMinor });
    }
  }
  const currencyField = fields.find((f) => f.mapsTo === 'currency');
  const currencyValue = currencyField ? values[currencyField.key] : null;
  if (!currency && typeof currencyValue === 'string' && isCurrency(currencyValue)) currency = currencyValue;
  const start = fields.find((f) => f.mapsTo === 'start_date');
  const startText = start ? valueText(start, values[start.key], 'en') : '';
  const notes = [`Work order: ${row.title}.`, startText ? `Start date: ${startText}.` : '', descriptionText && lines.every((l) => l.description !== descriptionText) ? descriptionText : '']
    .filter(Boolean)
    .join('\n');

  const documentId = await createDocumentDraft(docCtx, {
    type: '300',
    clientId: row.client_id,
    currency: (currency ?? HOME_CURRENCY) as DraftInput['currency'],
    notes: notes.slice(0, 5000),
    lines: lines.map((l) => ({ description: l.description, descriptionHe: l.descriptionHe ?? null, quantityMilli: 1000, unitPriceMinor: l.unitPriceMinor, discountMinor: 0 })),
    paymentMethodIds: [],
    payments: [],
    showIls: false,
    latestRate: false,
    carryRate: false,
  });
  await transaction(db, [
    stmt(db, 'UPDATE contracts SET linked_document_id = ? WHERE id = ? AND linked_document_id IS NULL', documentId, row.id),
    eventStatement(db, row, 'proforma_created', fromAudit(actor), { documentId }),
    auditStatement(db, actor, 'contract.proforma', 'contract', row.id, { documentId }),
  ]);
  return documentId;
}

// ---------------------------------------------------------------------------
// Dashboard and the 07:00 cron
// ---------------------------------------------------------------------------

export interface ContractAlert {
  id: number;
  clientId: number;
  title: string;
  sentAt: string;
  expiresAt: string;
  daysSinceSent: number;
  daysLeft: number;
}

export interface ContractLines {
  unsigned: ContractAlert[];
  expiring: ContractAlert[];
}

/** Sent and not signed after 7 days, and links that end within 2 days. */
export async function contractLines(db: D1Database, businessId: number, now: Date = new Date()): Promise<ContractLines> {
  const rows = await all<ContractRow>(
    db,
    "SELECT * FROM contracts WHERE business_id = ? AND status IN ('sent', 'viewed') AND expires_at > ? ORDER BY expires_at",
    businessId,
    now.toISOString(),
  );
  const view = (r: ContractRow): ContractAlert => ({
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    sentAt: r.sent_at!,
    expiresAt: r.expires_at!,
    daysSinceSent: Math.floor((now.getTime() - Date.parse(r.sent_at!)) / DAY_MS),
    daysLeft: Math.ceil((Date.parse(r.expires_at!) - now.getTime()) / DAY_MS),
  });
  return {
    unsigned: rows.filter((r) => r.sent_at && now.getTime() - Date.parse(r.sent_at) >= UNSIGNED_AFTER_DAYS * DAY_MS).map(view),
    expiring: rows.filter((r) => Date.parse(r.expires_at!) - now.getTime() <= EXPIRING_WITHIN_DAYS * DAY_MS).map(view),
  };
}

/** The 07:00 sweep: ended links turn expired, and one Slack line per contract unsigned after 7 days. */
export async function contractsCron(db: D1Database, businessId: number, notifier: Notifier, now: Date = new Date()): Promise<{ expired: number[]; alerted: number[] }> {
  const at = now.toISOString();
  const ended = await all<ContractRow>(db, "SELECT * FROM contracts WHERE business_id = ? AND status IN ('sent', 'viewed') AND expires_at <= ?", businessId, at);
  const system = { email: 'system', role: 'system', ip: null, userAgent: null };
  for (const row of ended) {
    await transaction(db, [
      stmt(db, "UPDATE contracts SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('sent', 'viewed')", at, row.id),
      eventStatement(db, row, 'expired', system, undefined, at),
    ]);
  }
  const lines = await contractLines(db, businessId, now);
  const alerted: number[] = [];
  for (const line of lines.unsigned) {
    const row = await first<{ unsigned_alerted_at: string | null }>(db, 'SELECT unsigned_alerted_at FROM contracts WHERE id = ?', line.id);
    if (row?.unsigned_alerted_at) continue;
    await transaction(db, [
      stmt(db, 'UPDATE contracts SET unsigned_alerted_at = ? WHERE id = ? AND unsigned_alerted_at IS NULL', at, line.id),
      auditStatement(db, systemActorFor(businessId), 'contract.unsigned_alert', 'contract', line.id, { daysSinceSent: line.daysSinceSent }),
    ]);
    await notifier.send(`:hourglass: ${line.title} is not signed ${line.daysSinceSent} days after sending. The link ends on ${line.expiresAt.slice(0, 10)}.`);
    alerted.push(line.id);
  }
  return { expired: ended.map((r) => r.id), alerted };
}
