import { all } from '../../core/db';
import { clientDisplayName } from '../clients/display';
import { displayNumber } from '../documents/types';

/**
 * Income by document date (runs/R08-reports.md: "income by month, client, currency").
 * A document counts once it is `final`. Credit types (405, 330) already carry a negative
 * `total_minor`/`total_ils_minor` (R01 decision, docs/progress.md "R01: Decisions for later
 * runs"), so summing signed amounts nets a credit against the sale it reverses without any
 * special-casing here. R21 removed a sign flip that turned a real credit back into income.
 */

const INCOME_KINDS = ['receipt', 'credit', 'invoice', 'invoice_receipt', 'credit_invoice'];

export interface IncomeDetailRow {
  documentId: number;
  date: string;
  type: string;
  typeNameEn: string;
  displayNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  currency: string;
  amountMinor: number;
  amountIlsMinor: number | null;
  /** Set for a document uploaded from another system (R17 task 7), never for one Open Ledger IL issued. */
  externalSource?: string;
}

interface IncomeSqlRow {
  id: number;
  date: string;
  type: string;
  type_name_en: string;
  number: number | null;
  client_id: number | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string;
  amount_minor: number;
  amount_ils_minor: number | null;
}

interface ExternalIncomeSqlRow {
  id: number;
  issue_date: string;
  source: string;
  original_number: string;
  client_id: number | null;
  client_name_text: string;
  currency: string;
  total_minor: number;
  total_ils_minor: number | null;
}

/** R17 task 7: uploaded documents count as income for their issue date, labeled by source. */
async function externalIncomeDetail(db: D1Database, from: string, to: string): Promise<IncomeDetailRow[]> {
  const rows = await all<ExternalIncomeSqlRow>(
    db,
    `SELECT id, issue_date, source, original_number, client_id, client_name_text, currency, total_minor, total_ils_minor
     FROM external_documents WHERE issue_date BETWEEN ? AND ?
     ORDER BY issue_date, id`,
    from,
    to,
  );
  return rows.map((r) => ({
    documentId: r.id,
    date: r.issue_date,
    type: r.source,
    typeNameEn: `Issued in ${r.source}`,
    displayNumber: r.original_number,
    clientId: r.client_id,
    clientName: r.client_name_text,
    currency: r.currency,
    amountMinor: r.total_minor,
    amountIlsMinor: r.total_ils_minor,
    externalSource: r.source,
  }));
}

export async function incomeDetail(db: D1Database, from: string, to: string): Promise<IncomeDetailRow[]> {
  const placeholders = INCOME_KINDS.map(() => '?').join(',');
  const [rows, externalRows] = await Promise.all([
    all<IncomeSqlRow>(
      db,
      `SELECT d.id, d.date, d.type, dt.name_en AS type_name_en, d.number, d.client_id, c.name_en AS client_name_en, c.name_he AS client_name_he,
       d.currency,
       d.total_minor AS amount_minor,
       COALESCE(d.total_ils_minor, CASE WHEN d.currency = 'ILS' THEN d.total_minor ELSE NULL END) AS amount_ils_minor
     FROM documents d
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.status = 'final' AND dt.kind IN (${placeholders}) AND d.date BETWEEN ? AND ?
     ORDER BY d.date, d.id`,
      ...INCOME_KINDS,
      from,
      to,
    ),
    externalIncomeDetail(db, from, to),
  ]);
  const detail = rows.map((r) => ({
    documentId: r.id,
    date: r.date,
    type: r.type,
    typeNameEn: r.type_name_en,
    displayNumber: displayNumber(r.type, r.number),
    clientId: r.client_id,
    clientName: r.client_id === null ? null : clientDisplayName({ name_en: r.client_name_en, name_he: r.client_name_he }, 'en'),
    currency: r.currency,
    amountMinor: r.amount_minor,
    amountIlsMinor: r.amount_ils_minor,
  }));
  return [...detail, ...externalRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.documentId - b.documentId));
}

export interface MonthTotal {
  month: string;
  totalIlsMinor: number;
}
export interface ClientTotal {
  clientId: number | null;
  clientName: string | null;
  totalIlsMinor: number;
}
export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  totalIlsMinor: number;
}

export interface IncomeReport {
  from: string;
  to: string;
  rows: IncomeDetailRow[];
  byMonth: MonthTotal[];
  byClient: ClientTotal[];
  byCurrency: CurrencyTotal[];
  totalIlsMinor: number;
}

function sortedValues<K, V>(map: Map<K, V>, key: (v: V) => string | number): V[] {
  return [...map.values()].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function summarizeIncome(rows: IncomeDetailRow[]): Omit<IncomeReport, 'from' | 'to' | 'rows'> {
  const byMonth = new Map<string, MonthTotal>();
  const byClient = new Map<string, ClientTotal>();
  const byCurrency = new Map<string, CurrencyTotal>();
  let totalIlsMinor = 0;

  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const ils = r.amountIlsMinor ?? 0;
    totalIlsMinor += ils;

    const m = byMonth.get(month) ?? { month, totalIlsMinor: 0 };
    m.totalIlsMinor += ils;
    byMonth.set(month, m);

    const clientKey = String(r.clientId ?? 'none');
    const cl = byClient.get(clientKey) ?? { clientId: r.clientId, clientName: r.clientName, totalIlsMinor: 0 };
    cl.totalIlsMinor += ils;
    byClient.set(clientKey, cl);

    const cur = byCurrency.get(r.currency) ?? { currency: r.currency, totalMinor: 0, totalIlsMinor: 0 };
    cur.totalMinor += r.amountMinor;
    cur.totalIlsMinor += ils;
    byCurrency.set(r.currency, cur);
  }

  return {
    byMonth: sortedValues(byMonth, (v) => v.month),
    byClient: sortedValues(byClient, (v) => v.clientName ?? ''),
    byCurrency: sortedValues(byCurrency, (v) => v.currency),
    totalIlsMinor,
  };
}

export async function incomeReport(db: D1Database, from: string, to: string): Promise<IncomeReport> {
  const rows = await incomeDetail(db, from, to);
  return { from, to, rows, ...summarizeIncome(rows) };
}
