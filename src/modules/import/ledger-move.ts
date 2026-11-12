import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { all, first, stmt, transaction } from '../../core/db';
import { setStartNumber } from '../../core/numbering';
import { ValidationError } from '../../core/errors';
import { C100_FIELDS, type FieldSpec } from '../exports/unified-file/records';

/**
 * R48 task 5: a client moves from a firm's Ledger to a Ledger of their own. No row-level import
 * of final documents. The history comes in through the paths that exist:
 * - Settings > Numbering > "Continue from another Ledger": the manifest's next numbers become the
 *   start numbers, through the start-number rule (only a series with no final document),
 * - the unified-file import, which now decodes the C100 document headers,
 * - data.json for clients, items and payment methods: new rows, no ids kept, duplicates skipped.
 */

/** Reads one fixed-width record into its fields, by the same layout the builder writes. */
export function parseRecord(fields: FieldSpec[], line: string): Record<number, string> {
  const out: Record<number, string> = {};
  let at = 0;
  for (const spec of fields) {
    out[spec.no] = line.slice(at, at + spec.width);
    at += spec.width;
  }
  return out;
}

function signedMinor(raw: string | undefined): number | null {
  const m = /^([+-])(\d+)$/.exec((raw ?? '').trim());
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === '-' ? -n : n;
}

/** A C100 document header: type code, number, date and total in agorot. */
export function decodeC100(line: string): { docType: string; docNumber: string; docDate: string | null; totalMinor: number | null; cancelled: boolean } {
  const f = parseRecord(C100_FIELDS, line);
  const ymd = (f[1205] ?? '').trim();
  return {
    docType: (f[1203] ?? '').trim(),
    docNumber: (f[1204] ?? '').trim(),
    docDate: /^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : null,
    totalMinor: signedMinor(f[1223]),
    cancelled: (f[1228] ?? '').trim() === '1',
  };
}

export interface StartNumberEntry {
  docType: string;
  nextNumber: number;
}

export interface ContinueResult {
  applied: { docType: string; seriesId: string; startNumber: number }[];
  skipped: { docType: string; reason: string }[];
}

/** Sets each open series' start number from the old Ledger's manifest. A series in use is skipped. */
export async function continueFromManifest(db: D1Database, actor: AuditActor, entries: StartNumberEntry[]): Promise<ContinueResult> {
  const businessId = actorBiz(actor);
  const result: ContinueResult = { applied: [], skipped: [] };
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.docType)) continue;
    seen.add(e.docType);
    const series = await first<{ id: string; started_at: string | null }>(
      db,
      'SELECT id, started_at FROM series WHERE business_id = ? AND doc_type = ? AND closed_at IS NULL',
      businessId,
      e.docType,
    );
    if (!series) {
      result.skipped.push({ docType: e.docType, reason: 'no open series of this type' });
      continue;
    }
    if (series.started_at) {
      result.skipped.push({ docType: e.docType, reason: 'the series already has a final document' });
      continue;
    }
    await setStartNumber(db, series.id, e.nextNumber, actor);
    result.applied.push({ docType: e.docType, seriesId: series.id, startNumber: e.nextNumber });
  }
  return result;
}

export function startNumbersFromManifest(manifest: unknown): StartNumberEntry[] {
  const list = (manifest as { startNumbers?: unknown })?.startNumbers;
  if (!Array.isArray(list)) throw new ValidationError('This is not a Ledger export manifest: it has no startNumbers.');
  return list
    .map((x) => x as { docType?: unknown; nextNumber?: unknown })
    .filter((x) => typeof x.docType === 'string' && Number.isSafeInteger(x.nextNumber) && (x.nextNumber as number) >= 1)
    .map((x) => ({ docType: x.docType as string, nextNumber: x.nextNumber as number }));
}

// ---------------------------------------------------------------------------
// data.json: clients, items and payment methods
// ---------------------------------------------------------------------------

const NEVER_COPIED = new Set(['id', 'business_id', 'created_at', 'updated_at', 'demo_session_id', 'client_id']);

async function columnsOf(db: D1Database, table: string): Promise<Set<string>> {
  const rows = await all<{ name: string }>(db, `SELECT name FROM pragma_table_info('${table}')`);
  return new Set(rows.map((r) => r.name));
}

function insertStatement(db: D1Database, table: string, cols: Set<string>, row: Record<string, unknown>, businessId: number | null, extra: Record<string, unknown> = {}): D1PreparedStatement {
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (NEVER_COPIED.has(k) || !cols.has(k)) continue;
    if (v !== null && typeof v === 'object') continue;
    values[k] = v;
  }
  Object.assign(values, extra);
  if (businessId !== null && cols.has('business_id')) values.business_id = businessId;
  const keys = Object.keys(values);
  return stmt(db, `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => values[k] as string | number | null));
}

export interface DataImportResult {
  created: { clients: number; contacts: number; items: number; paymentMethods: number };
  skipped: { kind: string; name: string; reason: string }[];
}

const taxDigits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');

/**
 * Imports data.json from another Ledger as new rows. No ids are kept. A client whose tax id or
 * email is already here is skipped and listed, so are items and payment methods with a name that
 * exists. Recurring schedules need their template document, which is not imported, so each is
 * listed to set up again.
 */
export async function importLedgerData(db: D1Database, actor: AuditActor, data: unknown): Promise<DataImportResult> {
  const businessId = actorBiz(actor);
  const d = data as {
    format?: string;
    clients?: (Record<string, unknown> & { contacts?: Record<string, unknown>[] })[];
    items?: Record<string, unknown>[];
    paymentMethods?: Record<string, unknown>[];
    recurringSchedules?: Record<string, unknown>[];
  };
  if (d?.format !== 'mtn-ledger-business/1') throw new ValidationError('This is not a Ledger data.json export.');
  const result: DataImportResult = { created: { clients: 0, contacts: 0, items: 0, paymentMethods: 0 }, skipped: [] };
  const clientCols = await columnsOf(db, 'clients');
  const contactCols = await columnsOf(db, 'client_contacts');
  const itemCols = await columnsOf(db, 'items');
  const pmCols = await columnsOf(db, 'payment_methods');

  const existing = await all<{ email: string | null; company_id: string | null; vat_number: string | null }>(
    db,
    'SELECT email, company_id, vat_number FROM clients WHERE business_id = ?',
    businessId,
  );
  const emails = new Set(existing.map((c) => (c.email ?? '').toLowerCase()).filter(Boolean));
  const taxIds = new Set(existing.flatMap((c) => [taxDigits(c.company_id), taxDigits(c.vat_number)]).filter(Boolean));

  for (const c of d.clients ?? []) {
    const name = String(c.name_en ?? c.name_he ?? '');
    const email = String(c.email ?? '').toLowerCase();
    const tax = [taxDigits(c.company_id), taxDigits(c.vat_number)].filter(Boolean);
    if ((email && emails.has(email)) || tax.some((t) => taxIds.has(t))) {
      result.skipped.push({ kind: 'client', name, reason: 'a client with this tax id or email exists' });
      continue;
    }
    const [res] = await transaction(db, [insertStatement(db, 'clients', clientCols, c, businessId)]);
    const clientId = res!.meta.last_row_id;
    result.created.clients++;
    if (email) emails.add(email);
    tax.forEach((t) => taxIds.add(t));
    for (const contact of c.contacts ?? []) {
      await transaction(db, [insertStatement(db, 'client_contacts', contactCols, contact, null, { client_id: clientId })]);
      result.created.contacts++;
    }
  }

  const itemNames = new Set((await all<{ name_en: string }>(db, 'SELECT name_en FROM items WHERE business_id = ?', businessId)).map((r) => r.name_en));
  for (const item of d.items ?? []) {
    const name = String(item.name_en ?? '');
    if (itemNames.has(name)) {
      result.skipped.push({ kind: 'item', name, reason: 'an item with this name exists' });
      continue;
    }
    await transaction(db, [insertStatement(db, 'items', itemCols, item, businessId)]);
    itemNames.add(name);
    result.created.items++;
  }

  const pmNames = new Set((await all<{ display_name: string }>(db, 'SELECT display_name FROM payment_methods WHERE business_id = ?', businessId)).map((r) => r.display_name));
  for (const pm of d.paymentMethods ?? []) {
    const name = String(pm.display_name ?? '');
    if (pmNames.has(name)) {
      result.skipped.push({ kind: 'payment method', name, reason: 'a payment method with this name exists' });
      continue;
    }
    await transaction(db, [insertStatement(db, 'payment_methods', pmCols, pm, businessId)]);
    pmNames.add(name);
    result.created.paymentMethods++;
  }

  for (const r of d.recurringSchedules ?? []) {
    result.skipped.push({ kind: 'recurring schedule', name: `#${String(r.id ?? '')} ${String(r.frequency ?? '')}`, reason: 'set it up again from a document in this Ledger' });
  }

  await transaction(db, [auditStatement(db, actor, 'import.ledger_data', 'business', businessId, { created: result.created, skipped: result.skipped.length })]);
  return result;
}
