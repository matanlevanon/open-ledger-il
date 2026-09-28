import type { AuditActor } from '../../core/audit';
import { auditAs } from '../../core/audit';
import { all, assertDate, first, run } from '../../core/db';
import { setStartNumber, type SeriesRow } from '../../core/numbering';
import { CURRENCY_CODES, type Currency, assertCurrency, parseMajor } from '../../core/money';
import { ValidationError } from '../../core/errors';
import { parseCsv, toRecords } from './csv';
import { decodeCsvText } from './encoding';
import { guessCustomerMapping, guessInvoiceMapping } from './mapping';
import { countByRecordType, DECODE_STUB_NOTE, HISTORY_RECORD_TYPES, recordHash, splitBkmvdataRecords } from './sumit';
import type { CommitSummary, HistoryRow, ImportKind, WaveCustomerMapping, WaveInvoiceMapping } from './types';
import { extractUnifiedFile } from './zip';

function decodeText(bytes: ArrayBuffer): string {
  return decodeCsvText(bytes);
}

async function createBatch(db: D1Database, kind: ImportKind, filename: string, mapping: unknown, actor: AuditActor): Promise<number> {
  const { lastRowId } = await run(
    db,
    'INSERT INTO import_batches (kind, filename, mapping_json, created_by) VALUES (?, ?, ?, ?)',
    kind,
    filename,
    mapping === undefined ? null : JSON.stringify(mapping),
    actor.userId,
  );
  return lastRowId;
}

async function recordBatchSummary(db: D1Database, batchId: number, summary: unknown): Promise<void> {
  await run(db, 'UPDATE import_batches SET summary_json = ? WHERE id = ?', JSON.stringify(summary), batchId);
}

// ---------------------------------------------------------------------------
// Wave customers -> clients
// ---------------------------------------------------------------------------

export interface CsvPreview {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  suggestedMapping: Record<string, string | null>;
}

export function previewWaveCustomers(bytes: ArrayBuffer): CsvPreview {
  const csv = parseCsv(decodeText(bytes));
  return {
    headers: csv.headers,
    totalRows: csv.rows.length,
    sampleRows: toRecords(csv).slice(0, 5),
    suggestedMapping: guessCustomerMapping(csv.headers),
  };
}

export function previewWaveInvoices(bytes: ArrayBuffer): CsvPreview {
  const csv = parseCsv(decodeText(bytes));
  return {
    headers: csv.headers,
    totalRows: csv.rows.length,
    sampleRows: toRecords(csv).slice(0, 5),
    suggestedMapping: guessInvoiceMapping(csv.headers),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

function field(record: Record<string, string>, mapping: WaveCustomerMapping, key: keyof WaveCustomerMapping): string | null {
  const header = mapping[key];
  if (!header) return null;
  const value = record[header]?.trim();
  return value ? value : null;
}

/** Creates or updates a client from a CSV row. Never overwrites a field the row did not map. */
async function upsertClientFromRow(
  db: D1Database,
  actor: AuditActor,
  record: Record<string, string>,
  mapping: WaveCustomerMapping,
  rowNumber: number,
  summary: CommitSummary,
): Promise<void> {
  const nameEn = field(record, mapping, 'nameEn');
  if (!nameEn) {
    summary.errors.push({ row: rowNumber, message: 'Missing the client name.' });
    summary.skipped++;
    return;
  }
  const email = field(record, mapping, 'email');
  if (email && !EMAIL_PATTERN.test(email)) {
    summary.errors.push({ row: rowNumber, message: `"${email}" is not a valid email. Row skipped.` });
    summary.skipped++;
    return;
  }
  const country = field(record, mapping, 'country');
  if (country && !COUNTRY_PATTERN.test(country)) {
    summary.errors.push({ row: rowNumber, message: `"${country}" is not a two-letter country code. Row skipped.` });
    summary.skipped++;
    return;
  }
  const currency = field(record, mapping, 'currency');
  if (currency && !(CURRENCY_CODES as readonly string[]).includes(currency.toUpperCase())) {
    summary.errors.push({ row: rowNumber, message: `"${currency}" is not a supported currency. Row skipped.` });
    summary.skipped++;
    return;
  }

  const mapped = {
    name_en: nameEn,
    name_he: field(record, mapping, 'nameHe'),
    company_id: field(record, mapping, 'companyId'),
    vat_number: field(record, mapping, 'vatNumber'),
    country: country ? country.toUpperCase() : null,
    currency: currency ? currency.toUpperCase() : null,
    email,
    phone: field(record, mapping, 'phone'),
    address_en: field(record, mapping, 'addressEn'),
    notes: field(record, mapping, 'notes'),
  };

  const existing = email
    ? await first<{ id: number }>(db, 'SELECT id FROM clients WHERE email = ? COLLATE NOCASE', email)
    : await first<{ id: number }>(db, 'SELECT id FROM clients WHERE name_en = ? COLLATE NOCASE', nameEn);

  if (existing) {
    const set = Object.entries(mapped).filter(([, v]) => v !== null);
    if (set.length > 0) {
      await run(
        db,
        `UPDATE clients SET ${set.map(([col]) => `${col} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        ...set.map(([, v]) => v as string),
        existing.id,
      );
      await auditAs(db, actor, 'client.import_update', 'client', existing.id, { nameEn });
    }
    summary.updated++;
    return;
  }

  const { lastRowId } = await run(
    db,
    `INSERT INTO clients (name_en, name_he, company_id, vat_number, country, currency, email, phone, address_en, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    mapped.name_en,
    mapped.name_he,
    mapped.company_id,
    mapped.vat_number,
    mapped.country ?? 'IL',
    mapped.currency ?? 'ILS',
    mapped.email,
    mapped.phone,
    mapped.address_en,
    mapped.notes,
  );
  await auditAs(db, actor, 'client.import_create', 'client', lastRowId, { nameEn });
  summary.created++;
}

export async function commitWaveCustomers(
  db: D1Database,
  actor: AuditActor,
  bytes: ArrayBuffer,
  filename: string,
  mapping?: WaveCustomerMapping,
): Promise<CommitSummary> {
  const csv = parseCsv(decodeText(bytes));
  const useMapping = mapping ?? guessCustomerMapping(csv.headers);
  if (!useMapping.nameEn) {
    throw new ValidationError('Map a CSV column to the client name before importing.');
  }
  const batchId = await createBatch(db, 'wave_customers', filename, useMapping, actor);
  const records = toRecords(csv);
  const summary: CommitSummary = { totalRows: records.length, created: 0, updated: 0, skipped: 0, errors: [] };
  for (let i = 0; i < records.length; i++) {
    await upsertClientFromRow(db, actor, records[i]!, useMapping, i + 2 /* header is row 1 */, summary);
  }
  await recordBatchSummary(db, batchId, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Wave invoices -> history (read-only, outside the legal series)
// ---------------------------------------------------------------------------

async function insertHistoryRow(
  db: D1Database,
  row: Omit<HistoryRow, 'id' | 'created_at' | 'decoded'> & { decoded?: number },
): Promise<boolean> {
  const { changes } = await run(
    db,
    `INSERT INTO history (
       import_batch_id, source, source_kind, external_id, client_id, client_name,
       doc_type, doc_number, doc_date, currency, amount_minor, status, raw_line, raw_json, decoded, decode_note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, source_kind, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
    row.import_batch_id,
    row.source,
    row.source_kind,
    row.external_id,
    row.client_id,
    row.client_name,
    row.doc_type,
    row.doc_number,
    row.doc_date,
    row.currency,
    row.amount_minor,
    row.status,
    row.raw_line,
    row.raw_json,
    row.decoded ?? 1,
    row.decode_note,
  );
  return changes > 0;
}

function invoiceField(record: Record<string, string>, mapping: WaveInvoiceMapping, key: keyof WaveInvoiceMapping): string | null {
  const header = mapping[key];
  if (!header) return null;
  const value = record[header]?.trim();
  return value ? value : null;
}

export async function commitWaveInvoices(
  db: D1Database,
  actor: AuditActor,
  bytes: ArrayBuffer,
  filename: string,
  mapping?: WaveInvoiceMapping,
): Promise<CommitSummary> {
  const csv = parseCsv(decodeText(bytes));
  const useMapping = mapping ?? guessInvoiceMapping(csv.headers);
  if (!useMapping.externalId) {
    throw new ValidationError('Map a CSV column to the invoice number before importing.');
  }
  const batchId = await createBatch(db, 'wave_invoices', filename, useMapping, actor);
  const records = toRecords(csv);
  const summary: CommitSummary = { totalRows: records.length, created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const rowNumber = i + 2;
    const externalId = invoiceField(record, useMapping, 'externalId');
    if (!externalId) {
      summary.errors.push({ row: rowNumber, message: 'Missing the invoice number.' });
      summary.skipped++;
      continue;
    }
    const currencyRaw = invoiceField(record, useMapping, 'currency') ?? 'USD'; // docs/sumit-teardown.md: account default currency
    let currency: Currency;
    try {
      currency = assertCurrency(currencyRaw.toUpperCase());
    } catch {
      summary.errors.push({ row: rowNumber, message: `"${currencyRaw}" is not a supported currency. Row skipped.` });
      summary.skipped++;
      continue;
    }
    const amountRaw = invoiceField(record, useMapping, 'amount');
    let amountMinor: number | null = null;
    if (amountRaw) {
      try {
        amountMinor = parseMajor(amountRaw.replace(/[^0-9.\-]/g, ''), currency);
      } catch {
        summary.errors.push({ row: rowNumber, message: `"${amountRaw}" is not a valid amount. Row skipped.` });
        summary.skipped++;
        continue;
      }
    }
    const docDateRaw = invoiceField(record, useMapping, 'docDate');
    let docDate: string | null = null;
    if (docDateRaw) {
      try {
        docDate = assertDate(docDateRaw);
      } catch {
        // Wave dates arrive in a few formats; keep the row and the raw text rather than dropping it.
        docDate = null;
        summary.errors.push({ row: rowNumber, message: `Date "${docDateRaw}" is not YYYY-MM-DD; imported with no date (see raw_json).` });
      }
    }
    const clientName = invoiceField(record, useMapping, 'clientName');
    const client = clientName ? await first<{ id: number }>(db, 'SELECT id FROM clients WHERE name_en = ? COLLATE NOCASE', clientName) : null;

    const inserted = await insertHistoryRow(db, {
      import_batch_id: batchId,
      source: 'wave',
      source_kind: 'wave_invoice',
      external_id: externalId,
      client_id: client?.id ?? null,
      client_name: clientName,
      doc_type: null,
      doc_number: invoiceField(record, useMapping, 'docNumber') ?? externalId,
      doc_date: docDate,
      currency,
      amount_minor: amountMinor,
      status: invoiceField(record, useMapping, 'status'),
      raw_line: null,
      raw_json: JSON.stringify(record),
      decode_note: null,
    });
    if (inserted) summary.created++;
    else summary.skipped++;
  }
  await recordBatchSummary(db, batchId, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// SUMIT unified-file (מבנה אחיד) -> history
// ---------------------------------------------------------------------------

export interface UnifiedFilePreview {
  totalLines: number;
  recordTypeCounts: Record<string, number>;
  sampleLines: Record<string, string[]>;
  note: string;
}

export function previewSumitUnified(zipBytes: ArrayBuffer): UnifiedFilePreview {
  const { bkmvdataText } = extractUnifiedFile(zipBytes);
  const records = splitBkmvdataRecords(bkmvdataText);
  const sampleLines: Record<string, string[]> = {};
  for (const type of Object.keys(HISTORY_RECORD_TYPES)) {
    sampleLines[type] = records.filter((r) => r.recordType === type).slice(0, 3).map((r) => r.line);
  }
  return {
    totalLines: records.length,
    recordTypeCounts: countByRecordType(records),
    sampleLines,
    note: DECODE_STUB_NOTE,
  };
}

export async function commitSumitUnified(db: D1Database, actor: AuditActor, zipBytes: ArrayBuffer, filename: string): Promise<CommitSummary> {
  const { bkmvdataText } = extractUnifiedFile(zipBytes);
  const records = splitBkmvdataRecords(bkmvdataText);
  const batchId = await createBatch(db, 'sumit_unified', filename, null, actor);
  const summary: CommitSummary = { totalRows: records.length, created: 0, updated: 0, skipped: 0, errors: [] };

  for (const record of records) {
    if (!record.recordType || !(record.recordType in HISTORY_RECORD_TYPES)) continue;
    const sourceKind = HISTORY_RECORD_TYPES[record.recordType]!;
    const externalId = await recordHash(record.line);
    const inserted = await insertHistoryRow(db, {
      import_batch_id: batchId,
      source: 'sumit',
      source_kind: sourceKind,
      external_id: externalId,
      client_id: null,
      client_name: null,
      doc_type: record.recordType,
      doc_number: null,
      doc_date: null,
      currency: null,
      amount_minor: null,
      status: null,
      raw_line: record.line,
      raw_json: JSON.stringify({ lineNumber: record.lineNumber, recordType: record.recordType }),
      decoded: 0,
      decode_note: DECODE_STUB_NOTE,
    });
    if (inserted) summary.created++;
    else summary.skipped++;
  }
  await recordBatchSummary(db, batchId, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Series starting numbers (runs/R10-import.md: "owner confirmation required")
// ---------------------------------------------------------------------------

export async function listSeries(db: D1Database): Promise<SeriesRow[]> {
  return all<SeriesRow>(db, 'SELECT * FROM series ORDER BY doc_type');
}

export async function confirmSeriesStart(
  db: D1Database,
  actor: AuditActor,
  seriesId: string,
  startNumber: number,
  note: string | null,
): Promise<SeriesRow> {
  await setStartNumber(db, seriesId, startNumber, actor);
  await auditAs(db, actor, 'import.series_start_confirmed', 'series', seriesId, { startNumber, note });
  return first<SeriesRow>(db, 'SELECT * FROM series WHERE id = ?', seriesId) as Promise<SeriesRow>;
}

export async function listHistory(
  db: D1Database,
  filter: { source?: 'wave' | 'sumit'; limit?: number; offset?: number },
): Promise<HistoryRow[]> {
  const where = filter.source ? 'WHERE source = ?' : '';
  const params = filter.source ? [filter.source] : [];
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  return all<HistoryRow>(db, `SELECT * FROM history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}
