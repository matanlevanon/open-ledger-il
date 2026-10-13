import { z } from 'zod';
import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { first, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, ValidationError } from '../../core/errors';
import { isCurrency } from '../../core/money';
import type { Env } from '../../env';
import { getClient } from '../clients/service';
import { contractPdfKey, sha256Hex } from './service';
import { TEMPLATE_KINDS, type TemplateKind } from './types';

/**
 * R28: a contract signed outside the Ledger, filed under its client with the signed PDF. A record
 * only: no link, no code, no signing. Inserted as signed and never changed. Void keeps it on record.
 */

export const EXTERNAL_MAX_BYTES = 20 * 1024 * 1024;
export const EXTERNAL_TEMPLATE_NAME = 'Signed outside the Ledger';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-13.');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const externalInput = z.object({
  clientId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, 'Add a title.').max(200),
  kind: z.enum(TEMPLATE_KINDS),
  signedDate: date,
  signerName: z.string().trim().min(1, 'Add the signer name.').max(200),
  signerRole: optionalText(200),
  signerEmail: z
    .string()
    .trim()
    .max(320)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'The signer email is not valid.'),
  startDate: date.nullish().or(z.literal('')).transform((v) => v || null),
  endDate: date.nullish().or(z.literal('')).transform((v) => v || null),
  feeAmountMinor: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.coerce.number().int().nonnegative().nullable()),
  feeCurrency: optionalText(3),
  notes: optionalText(2000),
});
export type ExternalInput = z.infer<typeof externalInput>;

/** "%PDF-" in the first bytes. The file name and the declared type are not trusted. */
export function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** The hidden template every external contract of one kind points at, made on first use. */
async function externalTemplate(db: D1Database, businessId: number, kind: TemplateKind): Promise<number> {
  const find = () => first<{ id: number }>(db, "SELECT id FROM contract_templates WHERE business_id = ? AND kind = ? AND origin = 'external' ORDER BY id LIMIT 1", businessId, kind);
  const found = await find();
  if (found) return found.id;
  await transaction(db, [
    stmt(db, "INSERT INTO contract_templates (business_id, name, kind, current_version, active, origin) VALUES (?, ?, ?, 1, 0, 'external')", businessId, EXTERNAL_TEMPLATE_NAME, kind),
    stmt(
      db,
      `INSERT INTO contract_template_versions (template_id, business_id, version, name, kind)
       VALUES ((SELECT MAX(id) FROM contract_templates WHERE business_id = ? AND origin = 'external' AND kind = ?), ?, 1, ?, ?)`,
      businessId,
      kind,
      businessId,
      EXTERNAL_TEMPLATE_NAME,
      kind,
    ),
  ]);
  return (await find())!.id;
}

export interface ExternalFile {
  name: string;
  bytes: Uint8Array;
}

/** Files a signed contract from outside the Ledger. Returns the new contract id. */
export async function createExternalContract(env: Pick<Env, 'DB' | 'FILES'>, actor: AuditActor, input: ExternalInput, file: ExternalFile): Promise<number> {
  const db = env.DB;
  const businessId = actorBiz(actor);
  if (file.bytes.byteLength === 0) throw new ValidationError('Choose the signed PDF.');
  if (file.bytes.byteLength > EXTERNAL_MAX_BYTES) throw new ValidationError('The PDF is larger than 20 MB.');
  if (!isPdf(file.bytes)) throw new ValidationError('Upload the signed contract as a PDF.');
  if (input.endDate && input.startDate && input.endDate < input.startDate) throw new ValidationError('The end date is before the start date.');
  if (input.feeAmountMinor !== null && !(input.feeCurrency && isCurrency(input.feeCurrency))) throw new ValidationError('Pick the fee currency.');
  const client = await getClient(db, input.clientId, businessId);

  const sha256 = await sha256Hex(file.bytes);
  const key = contractPdfKey(businessId, sha256);
  const dup = await first<{ id: number }>(db, 'SELECT id FROM contracts WHERE business_id = ? AND signed_pdf_sha256 = ?', businessId, sha256);
  if (dup) throw new ConflictError('contract_duplicate', 'This PDF is already on file.');
  // Content-addressed and write-once: the same key always holds the same bytes.
  if (!(await env.FILES.head(key))) await env.FILES.put(key, file.bytes, { httpMetadata: { contentType: 'application/pdf' } });

  const templateId = await externalTemplate(db, businessId, input.kind);
  const values: Record<string, unknown> = {};
  if (input.signerRole) values.signer_role = input.signerRole;
  if (input.startDate) values.start_date = input.startDate;
  if (input.endDate) values.end_date = input.endDate;
  if (input.feeAmountMinor !== null) values.fee = { amountMinor: input.feeAmountMinor, currency: input.feeCurrency };
  if (input.notes) values.notes = input.notes;
  const at = nowIso();

  const res = await transaction(db, [
    stmt(
      db,
      `INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, language, field_values_json, status, origin,
         signer_name, signer_email, signed_at, signed_pdf_r2_key, signed_pdf_sha256, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, 'en', ?, 'signed', 'external', ?, ?, ?, ?, ?, ?, ?, ?)`,
      businessId,
      client.id,
      templateId,
      input.kind,
      input.title,
      JSON.stringify(values),
      input.signerName,
      input.signerEmail,
      input.signedDate,
      key,
      sha256,
      actor.userId,
      at,
      at,
    ),
    auditStatement(db, actor, 'contract.upload', 'contract', null, { clientId: client.id, kind: input.kind, sha256, bytes: file.bytes.byteLength }),
  ]);
  const id = Number(res[0]!.meta.last_row_id);
  await transaction(db, [
    stmt(
      db,
      'INSERT INTO contract_events (contract_id, business_id, kind, actor_email, actor_role, ip, user_agent, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      businessId,
      'uploaded',
      actor.email,
      actor.role,
      actor.ip,
      actor.userAgent?.slice(0, 300) ?? null,
      JSON.stringify({ sha256, fileName: file.name.slice(0, 200), bytes: file.bytes.byteLength }),
      at,
    ),
  ]);
  return id;
}
