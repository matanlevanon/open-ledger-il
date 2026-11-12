import { zipSync } from 'fflate';
import { type AuditActor, auditStatement } from '../../core/audit';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { GENESIS_HASH } from '../../core/hashchain';
import type { Env } from '../../env';
import { APP_VERSION } from '../../version';
import { buildUnifiedFile } from '../exports/unified-file/build';
import { buildDocumentsZip } from '../reports/documents-zip';

/**
 * R48 task 4: export one business. No single giant zip, since a Worker has 128 MB of memory.
 * A run lists its files. Each file is built by its own request, stored in R2 under
 * exports/business/<id>/<run>/, and hashed. manifest.json comes last and names every file's
 * SHA-256, the row counts, the business's hash-chain head and the next number of each series.
 *
 * Never in an export: Worker secrets, ITA and Financy tokens, API keys, MCP tokens, signing keys,
 * rows of other businesses, audit rows of other businesses. Files are collected from this
 * business's rows, never by an R2 prefix, since expense files are shared by their content hash.
 */

/** A zip larger than this is stored in parts (name.001, name.002, ...). Join them with `copy /b` or `cat`. */
export const PART_BYTES = 60 * 1024 * 1024;

export interface ExportFileState {
  key: string;
  size: number;
  sha256: string;
  builtAt: string;
  /** Extra R2 keys when the file was split into parts. */
  parts?: { key: string; size: number; sha256: string }[];
}

export interface ExportRun {
  id: string;
  businessId: number;
  plan: string[];
  files: Record<string, ExportFileState>;
  createdAt: string;
  completedAt: string | null;
}

interface RunRow {
  id: string;
  business_id: number;
  plan: string;
  files: string;
  created_at: string;
  completed_at: string | null;
}

function toRun(row: RunRow): ExportRun {
  return {
    id: row.id,
    businessId: row.business_id,
    plan: JSON.parse(row.plan) as string[],
    files: JSON.parse(row.files) as Record<string, ExportFileState>,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();

/** The tax years with documents, expenses or imported history in this business. */
async function yearsOf(db: D1Database, businessId: number): Promise<{ documents: string[]; expenses: string[] }> {
  const docs = await all<{ y: string }>(
    db,
    "SELECT DISTINCT substr(date, 1, 4) AS y FROM documents WHERE business_id = ? AND number IS NOT NULL AND status IN ('final', 'cancelled') ORDER BY y",
    businessId,
  );
  const ext = await all<{ y: string }>(db, 'SELECT DISTINCT substr(issue_date, 1, 4) AS y FROM external_documents WHERE business_id = ? ORDER BY y', businessId);
  const exp = await all<{ y: string }>(
    db,
    "SELECT DISTINCT substr(COALESCE(document_date, created_at), 1, 4) AS y FROM expenses WHERE business_id = ? ORDER BY y",
    businessId,
  );
  const documents = [...new Set([...docs, ...ext].map((r) => r.y).filter((y) => /^\d{4}$/.test(y)))].sort();
  return { documents, expenses: exp.map((r) => r.y).filter((y) => /^\d{4}$/.test(y)) };
}

/** The file names of a run, in build order. manifest.json is always last. */
export async function planFor(db: D1Database, businessId: number): Promise<string[]> {
  const years = await yearsOf(db, businessId);
  return [
    'data.json',
    ...years.documents.flatMap((y) => [`unified-file-${y}.zip`, `documents-${y}.zip`]),
    ...years.expenses.flatMap((y) => [`expenses-${y}.csv`, `expenses-${y}.zip`]),
    'contracts-and-business-documents.zip',
    'manifest.json',
  ];
}

function randomRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startRun(db: D1Database, actor: AuditActor, businessId: number): Promise<ExportRun> {
  const id = randomRunId();
  const plan = await planFor(db, businessId);
  await transaction(db, [
    stmt(db, 'INSERT INTO business_export_runs (id, business_id, plan, created_by) VALUES (?, ?, ?, ?)', id, businessId, JSON.stringify(plan), actor.email ?? null),
    auditStatement(db, actor, 'business.export', 'business', businessId, { run: id, files: plan.length }),
  ]);
  return (await getRun(db, businessId, id))!;
}

export async function getRun(db: D1Database, businessId: number, runId: string): Promise<ExportRun | null> {
  const row = await first<RunRow>(db, 'SELECT * FROM business_export_runs WHERE id = ? AND business_id = ?', runId, businessId);
  return row ? toRun(row) : null;
}

export async function listRuns(db: D1Database, businessId: number): Promise<ExportRun[]> {
  return (await all<RunRow>(db, 'SELECT * FROM business_export_runs WHERE business_id = ? ORDER BY created_at DESC LIMIT 20', businessId)).map(toRun);
}

/** True when this business has a run with every planned file built. */
export async function hasCompleteExport(db: D1Database, businessId: number): Promise<boolean> {
  return (await first(db, 'SELECT 1 FROM business_export_runs WHERE business_id = ? AND completed_at IS NOT NULL', businessId)) !== null;
}

const PAGE = 500;

/** Rows of one business, paged, so no single query loads a huge table at once. */
async function paged<T>(db: D1Database, sql: string, ...params: (string | number)[]): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await all<T>(db, `${sql} LIMIT ${PAGE} OFFSET ${offset}`, ...params);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The business's own settings. Business 1 keeps bare keys, which it shares with Ledger-wide ones. */
const LEDGER_WIDE_SETTING = /^(mcp\.|inbox\.|updates\.|demo|update_check|backup)/;

async function businessSettings(db: D1Database, businessId: number): Promise<Record<string, string>> {
  const rows =
    businessId === 1
      ? await all<{ key: string; value: string }>(db, "SELECT key, value FROM settings WHERE key NOT GLOB 'b[0-9]*:*'")
      : await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings WHERE key LIKE ?', `b${businessId}:%`);
  const out: Record<string, string> = {};
  for (const r of rows) {
    const key = businessId === 1 ? r.key : r.key.slice(`b${businessId}:`.length);
    if (LEDGER_WIDE_SETTING.test(key)) continue;
    out[key] = r.value;
  }
  return out;
}

export async function buildDataJson(db: D1Database, businessId: number): Promise<Uint8Array> {
  const business = await first<Record<string, unknown>>(db, 'SELECT * FROM businesses WHERE id = ?', businessId);
  const clients = await paged<Record<string, unknown>>(db, 'SELECT * FROM clients WHERE business_id = ? ORDER BY id', businessId);
  const contacts = await paged<Record<string, unknown>>(
    db,
    'SELECT cc.* FROM client_contacts cc JOIN clients c ON c.id = cc.client_id WHERE c.business_id = ? ORDER BY cc.id',
    businessId,
  );
  const data = {
    format: 'mtn-ledger-business/1',
    business,
    brands: await all(db, 'SELECT * FROM brands WHERE business_id = ? ORDER BY id', businessId),
    clients: clients.map((c) => ({ ...c, contacts: contacts.filter((x) => x.client_id === c.id) })),
    items: await paged(db, 'SELECT * FROM items WHERE business_id = ? ORDER BY id', businessId),
    paymentMethods: await all(db, 'SELECT * FROM payment_methods WHERE business_id = ? ORDER BY id', businessId),
    series: await all(db, 'SELECT id, doc_type, name_en, name_he, legal_mode, start_number, next_number, closed_at FROM series WHERE business_id = ? ORDER BY id', businessId),
    recurringSchedules: await all(db, 'SELECT * FROM recurring_schedules WHERE business_id = ? ORDER BY id', businessId),
    settings: await businessSettings(db, businessId),
    users: await all(
      db,
      'SELECT u.email, ub.role FROM user_businesses ub JOIN users u ON u.id = ub.user_id WHERE ub.business_id = ? ORDER BY u.email',
      businessId,
    ),
  };
  return enc.encode(JSON.stringify(data, null, 2));
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXPENSE_COLUMNS = [
  'id',
  'document_date',
  'document_number',
  'document_type',
  'supplier',
  'category',
  'status',
  'currency',
  'amount_minor',
  'vat_amount_minor',
  'amount_ils_minor',
  'allocation_number',
  'file',
  'notes',
];

interface ExpenseRow {
  id: number;
  document_date: string | null;
  document_number: string | null;
  document_type: string | null;
  supplier: string | null;
  category: string | null;
  status: string;
  currency: string;
  amount_minor: number;
  vat_amount_minor: number;
  amount_ils_minor: number | null;
  allocation_number: string | null;
  r2_key: string | null;
  filename: string | null;
  notes: string | null;
}

async function expensesOfYear(db: D1Database, businessId: number, year: string): Promise<ExpenseRow[]> {
  return paged<ExpenseRow>(
    db,
    `SELECT e.id, e.document_date, e.document_number, e.document_type, s.name AS supplier, COALESCE(NULLIF(bc.name_en, ''), c.name_en) AS category, e.status, e.currency,
            e.amount_minor, e.vat_amount_minor, e.amount_ils_minor, e.allocation_number, f.r2_key, f.filename, e.notes
       FROM expenses e
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN business_expense_categories bc ON bc.business_id = e.business_id AND bc.category_key = c.key
       LEFT JOIN expense_files f ON f.id = e.file_id
      WHERE e.business_id = ? AND substr(COALESCE(e.document_date, e.created_at), 1, 4) = ?
      ORDER BY e.id`,
    businessId,
    year,
  );
}

function fileNameFor(row: { id: number; filename: string | null; r2_key: string }): string {
  const ext = /\.[a-z0-9]+$/i.exec(row.r2_key)?.[0] ?? '';
  const base = (row.filename ?? `expense-${row.id}${ext}`).replace(/[^\p{L}\p{N}._ -]/gu, '_');
  return `${row.id}-${base}`;
}

export async function buildExpensesCsv(db: D1Database, businessId: number, year: string): Promise<Uint8Array> {
  const rows = await expensesOfYear(db, businessId, year);
  const lines = [EXPENSE_COLUMNS.join(',')];
  for (const r of rows) {
    const file = r.r2_key ? fileNameFor({ id: r.id, filename: r.filename, r2_key: r.r2_key }) : '';
    lines.push(
      [r.id, r.document_date, r.document_number, r.document_type, r.supplier, r.category, r.status, r.currency, r.amount_minor, r.vat_amount_minor, r.amount_ils_minor, r.allocation_number, file, r.notes]
        .map(csvCell)
        .join(','),
    );
  }
  return enc.encode(`﻿${lines.join('\n')}\n`);
}

/** The receipt files this business's expenses of the year reference. Collected from rows, never by prefix. */
export async function buildExpensesZip(env: Env, businessId: number, year: string): Promise<Uint8Array> {
  const rows = await expensesOfYear(env.DB, businessId, year);
  const files: Record<string, Uint8Array> = {};
  for (const r of rows) {
    if (!r.r2_key) continue;
    const obj = await env.FILES.get(r.r2_key);
    if (!obj) continue;
    files[fileNameFor({ id: r.id, filename: r.filename, r2_key: r.r2_key })] = new Uint8Array(await obj.arrayBuffer());
  }
  return zipSync(files, { level: 0 });
}

export async function buildContractsZip(env: Env, businessId: number): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const contracts = await all<{ id: number; title: string; sent_pdf_r2_key: string | null; signed_pdf_r2_key: string | null }>(
    env.DB,
    'SELECT id, title, sent_pdf_r2_key, signed_pdf_r2_key FROM contracts WHERE business_id = ? ORDER BY id',
    businessId,
  );
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 80);
  for (const c of contracts) {
    for (const [which, key] of [
      ['sent', c.sent_pdf_r2_key],
      ['signed', c.signed_pdf_r2_key],
    ] as const) {
      if (!key) continue;
      const obj = await env.FILES.get(key);
      if (obj) files[`contracts/${c.id}-${safe(c.title)}-${which}.pdf`] = new Uint8Array(await obj.arrayBuffer());
    }
  }
  const docs = await all<{ id: number; type: string; file_name: string; r2_key: string }>(
    env.DB,
    'SELECT id, type, file_name, r2_key FROM business_documents WHERE business_id = ? ORDER BY id',
    businessId,
  );
  for (const d of docs) {
    const obj = await env.FILES.get(d.r2_key);
    if (obj) files[`business-documents/${d.id}-${d.type}-${safe(d.file_name)}`] = new Uint8Array(await obj.arrayBuffer());
  }
  return zipSync(files, { level: 0 });
}

const ROW_COUNT_TABLES = [
  'documents',
  'clients',
  'items',
  'payment_methods',
  'series',
  'recurring_schedules',
  'expenses',
  'external_documents',
  'contracts',
  'business_documents',
] as const;

export async function buildManifest(env: Env, run: ExportRun): Promise<Uint8Array> {
  const db = env.DB;
  const businessId = run.businessId;
  const business = await first<{ tax_id: string | null; name_en: string; name_he: string }>(db, 'SELECT tax_id, name_en, name_he FROM businesses WHERE id = ?', businessId);
  const lastMigration = await first<{ name: string }>(db, 'SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').catch(() => null);
  const counts: Record<string, number> = {};
  for (const t of ROW_COUNT_TABLES) {
    counts[t] = (await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t} WHERE business_id = ?`, businessId))?.n ?? 0;
  }
  const head = await first<{ hash: string }>(db, 'SELECT hash FROM finalizations WHERE business_id = ? ORDER BY seq DESC LIMIT 1', businessId);
  const series = await all<{ id: string; doc_type: string; next_number: number }>(db, 'SELECT id, doc_type, next_number FROM series WHERE business_id = ? ORDER BY id', businessId);
  const files: Record<string, { sha256: string; size: number; parts?: { name: string; sha256: string; size: number }[] }> = {};
  for (const [name, f] of Object.entries(run.files)) {
    if (name === 'manifest.json') continue;
    files[name] = {
      sha256: f.sha256,
      size: f.size,
      ...(f.parts ? { parts: f.parts.map((p) => ({ name: p.key.split('/').pop()!, sha256: p.sha256, size: p.size })) } : {}),
    };
  }
  const manifest = {
    format: 'mtn-ledger-business-export/1',
    ledgerVersion: APP_VERSION,
    lastMigration: lastMigration?.name ?? null,
    exportedAt: nowIso(),
    business: { taxId: business?.tax_id ?? null, nameEn: business?.name_en ?? '', nameHe: business?.name_he ?? '' },
    rowCounts: counts,
    hashChainHead: head?.hash ?? GENESIS_HASH,
    files,
    // The content of start-numbers.json: the next number of each series. Settings > Numbering >
    // "Continue from another Ledger" in the new Ledger reads it.
    startNumbers: series.map((s) => ({ docType: s.doc_type, seriesId: s.id, nextNumber: s.next_number })),
  };
  return enc.encode(JSON.stringify(manifest, null, 2));
}

async function buildFile(env: Env, run: ExportRun, name: string): Promise<Uint8Array> {
  const businessId = run.businessId;
  if (name === 'data.json') return buildDataJson(env.DB, businessId);
  if (name === 'contracts-and-business-documents.zip') return buildContractsZip(env, businessId);
  if (name === 'manifest.json') return buildManifest(env, run);
  let m = /^unified-file-(\d{4})\.zip$/.exec(name);
  if (m) return (await buildUnifiedFile(env, `${m[1]}-01-01`, `${m[1]}-12-31`, { businessId })).zip;
  m = /^documents-(\d{4})\.zip$/.exec(name);
  if (m) return (await buildDocumentsZip(env, `${m[1]}-01-01`, `${m[1]}-12-31`, businessId)).bytes;
  m = /^expenses-(\d{4})\.csv$/.exec(name);
  if (m) return buildExpensesCsv(env.DB, businessId, m[1]!);
  m = /^expenses-(\d{4})\.zip$/.exec(name);
  if (m) return buildExpensesZip(env, businessId, m[1]!);
  throw new ValidationError(`Unknown export file "${name}".`);
}

/**
 * Builds one file of a run and stores it. manifest.json waits for every other file. A file above
 * PART_BYTES is stored in parts. When the manifest is built, the run is complete.
 */
export async function buildRunFile(env: Env, actor: AuditActor, businessId: number, runId: string, name: string): Promise<ExportRun> {
  const run = await getRun(env.DB, businessId, runId);
  if (!run) throw new NotFoundError('Export run', runId);
  if (!run.plan.includes(name)) throw new NotFoundError('Export file', name);
  if (name === 'manifest.json') {
    const missing = run.plan.filter((f) => f !== 'manifest.json' && !run.files[f]);
    if (missing.length > 0) throw new ConflictError('export_incomplete', `Build these files first: ${missing.join(', ')}.`);
  }
  const bytes = await buildFile(env, run, name);
  const base = `exports/business/${businessId}/${runId}/`;
  const state: ExportFileState = { key: `${base}${name}`, size: bytes.length, sha256: await sha256Bytes(bytes), builtAt: nowIso() };
  if (bytes.length > PART_BYTES) {
    state.parts = [];
    for (let i = 0, n = 1; i < bytes.length; i += PART_BYTES, n++) {
      const part = bytes.subarray(i, Math.min(i + PART_BYTES, bytes.length));
      const key = `${base}${name}.${String(n).padStart(3, '0')}`;
      await env.FILES.put(key, part);
      state.parts.push({ key, size: part.length, sha256: await sha256Bytes(part) });
    }
  } else {
    await env.FILES.put(state.key, bytes);
  }
  const files = { ...run.files, [name]: state };
  const complete = run.plan.every((f) => files[f]);
  await transaction(env.DB, [
    stmt(
      env.DB,
      'UPDATE business_export_runs SET files = ?, completed_at = ? WHERE id = ? AND business_id = ?',
      JSON.stringify(files),
      complete ? nowIso() : null,
      runId,
      businessId,
    ),
    auditStatement(env.DB, actor, 'business.export_file', 'business', businessId, { run: runId, file: name, sha256: state.sha256 }),
  ]);
  return (await getRun(env.DB, businessId, runId))!;
}
