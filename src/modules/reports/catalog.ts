import { all } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import { displayNumber } from '../documents/types';
import {
  AGING_BUCKETS,
  type AgingBucket,
  EXPENSE_ROWS_SQL,
  INCOME_ROWS_SQL,
  type OpenItem,
  PAYMENT_REQUEST_TYPES,
  PROFORMA_TYPES,
  type ShareRow,
  cashFlowByMonth,
  expensesByCategory,
  incomeByClient,
  incomeByService,
  monthsBetween,
  openItems,
} from './aggregates';
import { toCsv } from './csv';
import { decimalMinor, numberMinor } from './format';
import { type XlsxSheet, buildXlsx } from './xlsx';

/**
 * R21 report catalog. Every report here answers the same shape (columns, rows, totals), so one
 * route serves JSON, CSV and XLSX for all of them, and one web view renders them. Every row
 * carries a link to what it sums: a document, an expense, or a narrower report.
 *
 * The income, expenses, profit and loss, client statement, ceiling and monthly pack reports keep
 * their own routes from R08 and R16.
 */

export type ColumnKind = 'text' | 'date' | 'month' | 'int' | 'quantity' | 'ils' | 'money' | 'moneyList';

export interface ReportColumn {
  key: string;
  header: string;
  kind: ColumnKind;
  /** Summed into the totals row. Only for int, quantity and ils columns. */
  total?: boolean;
}

/** A money cell in its own currency. */
export interface MoneyValue {
  minor: number;
  currency: string;
}

export type Cell = string | number | null | MoneyValue | Record<string, number>;

export type ReportLink =
  | { kind: 'document'; id: number }
  | { kind: 'expense'; id: number }
  | { kind: 'client'; id: number }
  | { kind: 'report'; report: string; params: Record<string, string> };

export interface ReportRow {
  key: string;
  cells: Record<string, Cell>;
  link?: ReportLink;
  imported?: boolean;
}

export interface ReportResult {
  report: string;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number>;
}

export interface ReportParams {
  from: string;
  to: string;
  today: string;
  filters: Record<string, string>;
}

interface ReportDef {
  title: string;
  columns: ReportColumn[];
  rows: (db: D1Database, p: ReportParams) => Promise<ReportRow[]>;
}

const METHOD_NAMES: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cheque: 'Cheque',
  cash: 'Cash',
  other: 'Other',
};

const ILS_SQL = (amount: string, currency: string, ils: string) => `COALESCE(${ils}, CASE WHEN ${currency} = 'ILS' THEN ${amount} END)`;

const clientName = (en: string | null, he: string | null, text?: string | null) => (en ?? '').trim() || (he ?? '').trim() || (text ?? '');

function idFilter(value: string | undefined, label: string): number | 'none' | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'none') return 'none';
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${label} must be a positive integer or "none".`);
  return n;
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function report(name: string, params: Record<string, string>): ReportLink {
  return { kind: 'report', report: name, params };
}

// ---------------------------------------------------------------------------
// Open items (debtors, open pro formas and requests, aging)
// ---------------------------------------------------------------------------

const OPEN_ITEM_COLUMNS: ReportColumn[] = [
  { key: 'document', header: 'Document', kind: 'text' },
  { key: 'client', header: 'Client', kind: 'text' },
  { key: 'date', header: 'Date', kind: 'date' },
  { key: 'due', header: 'Due', kind: 'date' },
  { key: 'daysLate', header: 'Days late', kind: 'int' },
  { key: 'bucket', header: 'Bucket', kind: 'text' },
  { key: 'open', header: 'Open', kind: 'money' },
  { key: 'openIls', header: 'Open ILS', kind: 'ils', total: true },
];

function openItemRows(items: OpenItem[], p: ReportParams, types?: string[]): ReportRow[] {
  const clientId = idFilter(p.filters.clientId, 'clientId');
  const bucket = p.filters.bucket as AgingBucket | undefined;
  if (bucket && !AGING_BUCKETS.includes(bucket)) throw new ValidationError(`bucket must be one of ${AGING_BUCKETS.join(', ')}.`);
  return items
    .filter((i) => !types || types.includes(i.type))
    .filter((i) => clientId === undefined || (clientId === 'none' ? i.clientId === null : i.clientId === clientId))
    .filter((i) => !bucket || i.bucket === bucket)
    .map((i) => ({
      key: String(i.documentId),
      cells: {
        document: `${i.typeNameEn}${i.displayNumber ? ` ${i.displayNumber}` : ''}`,
        client: i.clientNameEn,
        date: i.date,
        due: i.dueDate,
        daysLate: Math.max(0, i.daysOverdue),
        bucket: i.bucket,
        open: { minor: i.remainingMinor, currency: i.currency },
        openIls: i.ilsMinor,
      },
      link: { kind: 'document', id: i.documentId },
    }));
}

// ---------------------------------------------------------------------------
// Breakdown helpers
// ---------------------------------------------------------------------------

function shareRows(rows: ShareRow[], link: (r: ShareRow) => ReportLink | undefined, extra: (r: ShareRow) => Record<string, Cell> = () => ({})): ReportRow[] {
  return rows.map((r) => ({
    key: r.key,
    cells: { name: r.nameEn, count: r.count, original: r.byCurrency, ils: r.ilsMinor, ...extra(r) },
    link: link(r),
    imported: r.imported || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const REPORTS: Record<string, ReportDef> = {
  // Clients -----------------------------------------------------------------
  debtors: {
    title: 'Debtors and balances',
    columns: [
      { key: 'client', header: 'Client', kind: 'text' },
      { key: 'count', header: 'Open documents', kind: 'int', total: true },
      { key: 'open', header: 'Open balance', kind: 'moneyList' },
      { key: 'openIls', header: 'Open ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const items = await openItems(db, p.today);
      const byClient = new Map<string, { name: string; count: number; open: Record<string, number>; openIls: number }>();
      for (const i of items) {
        const key = String(i.clientId ?? 'none');
        const acc = byClient.get(key) ?? { name: i.clientNameEn || 'No client', count: 0, open: {}, openIls: 0 };
        acc.count += 1;
        acc.open[i.currency] = (acc.open[i.currency] ?? 0) + i.remainingMinor;
        acc.openIls += i.ilsMinor ?? 0;
        byClient.set(key, acc);
      }
      return [...byClient.entries()]
        .sort(([, a], [, b]) => b.openIls - a.openIls)
        .map(([key, a]) => ({
          key,
          cells: { client: a.name, count: a.count, open: a.open, openIls: a.openIls },
          link: report('aged-receivables', { clientId: key }),
        }));
    },
  },

  'income-by-client': {
    title: 'Income by client',
    columns: [
      { key: 'name', header: 'Client', kind: 'text' },
      { key: 'count', header: 'Documents', kind: 'int', total: true },
      { key: 'original', header: 'Paid, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Paid ILS', kind: 'ils', total: true },
      { key: 'unpaidIls', header: 'Unpaid ILS', kind: 'ils', total: true },
      { key: 'totalIls', header: 'Total ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const [paid, items, unpaidImported] = await Promise.all([
        incomeByClient(db, p.from, p.to),
        openItems(db, p.today),
        all<{ client_id: number | null; name_en: string | null; name_he: string | null; name_text: string; ils: number | null }>(
          db,
          `SELECT x.client_id, c.name_en, c.name_he, x.client_name_text AS name_text, SUM(${ILS_SQL('x.total_minor', 'x.currency', 'x.total_ils_minor')}) AS ils
           FROM external_documents x LEFT JOIN clients c ON c.id = x.client_id
           WHERE x.paid_status = 'unpaid' AND x.issue_date BETWEEN ? AND ?
           GROUP BY x.client_id, CASE WHEN x.client_id IS NULL THEN x.client_name_text END`,
          p.from,
          p.to,
        ),
      ]);
      // Imported documents count once as income. An unpaid import is also shown as unpaid.
      const unpaid = new Map<string, { name: string; ils: number }>();
      for (const i of items) {
        if (i.date < p.from || i.date > p.to || i.clientId === null) continue;
        const key = `client:${i.clientId}`;
        const u = unpaid.get(key) ?? { name: i.clientNameEn, ils: 0 };
        u.ils += i.ilsMinor ?? 0;
        unpaid.set(key, u);
      }
      for (const r of unpaidImported) {
        const key = r.client_id !== null ? `client:${r.client_id}` : `name:${r.name_text}`;
        const u = unpaid.get(key) ?? { name: clientName(r.name_en, r.name_he, r.name_text), ils: 0 };
        u.ils += r.ils ?? 0;
        unpaid.set(key, u);
      }
      const rows = paid.rows.map((r) => ({ ...r }));
      for (const [key, u] of unpaid) {
        if (!rows.some((r) => r.key === key)) rows.push({ key, nameEn: u.name, nameHe: u.name, ilsMinor: 0, byCurrency: {}, count: 0 });
      }
      const link = (r: ShareRow): ReportLink =>
        r.key.startsWith('client:') ? report('all-documents', { clientId: r.key.slice(7), from: p.from, to: p.to }) : report('all-documents', { clientName: r.key.slice(5), from: p.from, to: p.to });
      return shareRows(rows, link, (r) => {
        const u = unpaid.get(r.key)?.ils ?? 0;
        return { unpaidIls: u, totalIls: r.ilsMinor + u };
      }).sort((a, b) => (b.cells.totalIls as number) - (a.cells.totalIls as number));
    },
  },

  // Income ------------------------------------------------------------------
  'all-documents': {
    title: 'All documents',
    columns: [
      { key: 'date', header: 'Date', kind: 'date' },
      { key: 'type', header: 'Type', kind: 'text' },
      { key: 'number', header: 'Number', kind: 'text' },
      { key: 'client', header: 'Client', kind: 'text' },
      { key: 'status', header: 'Status', kind: 'text' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const f = p.filters;
      const types = f.type ? f.type.split(',').filter(Boolean) : null;
      const status = f.status ?? 'issued';
      const statuses = status === 'all' ? ['draft', 'final', 'cancelled'] : status === 'issued' ? ['final', 'cancelled'] : [status];
      if (!statuses.every((s) => ['draft', 'final', 'cancelled'].includes(s))) throw new ValidationError('status must be issued, final, cancelled, draft or all.');
      const clientId = idFilter(f.clientId, 'clientId');
      const where = [`d.status IN (${statuses.map(() => '?').join(',')})`, 'd.date BETWEEN ? AND ?'];
      const args: (string | number)[] = [...statuses, p.from, p.to];
      const docTypes = types?.filter((t) => t !== 'imported');
      if (docTypes) {
        where.push(docTypes.length ? `d.type IN (${docTypes.map(() => '?').join(',')})` : '0');
        args.push(...docTypes);
      }
      if (clientId === 'none') where.push('d.client_id IS NULL');
      else if (clientId !== undefined) {
        where.push('d.client_id = ?');
        args.push(clientId);
      }
      if (f.clientName) where.push('0');
      if (f.service) {
        const [kind, value] = [f.service.slice(0, f.service.indexOf(':')), f.service.slice(f.service.indexOf(':') + 1)];
        if (kind === 'item') where.push('EXISTS (SELECT 1 FROM document_lines l WHERE l.document_id = d.id AND l.item_id = ?)');
        else if (kind === 'line') where.push('EXISTS (SELECT 1 FROM document_lines l WHERE l.document_id = d.id AND l.item_id IS NULL AND l.description_en = ?)');
        else throw new ValidationError('service must be item:<id> or line:<description>.');
        args.push(kind === 'item' ? Number(value) : value);
      }
      if (f.method) {
        if (f.method.startsWith('pm:')) where.push('EXISTS (SELECT 1 FROM payments p WHERE p.document_id = d.id AND p.method_id = ?)');
        else if (f.method.startsWith('m:')) where.push('EXISTS (SELECT 1 FROM payments p WHERE p.document_id = d.id AND p.method_id IS NULL AND p.method = ?)');
        else if (f.method !== 'imported') throw new ValidationError('method must be pm:<id>, m:<method> or imported.');
        if (f.method === 'imported') where.push('0');
        else args.push(f.method.startsWith('pm:') ? Number(f.method.slice(3)) : f.method.slice(2));
      }
      const docs = await all<{
        id: number;
        date: string;
        type: string;
        type_name: string;
        number: number | null;
        status: string;
        name_en: string | null;
        name_he: string | null;
        currency: string;
        total_minor: number;
        ils: number | null;
      }>(
        db,
        `SELECT d.id, d.date, d.type, dt.name_en AS type_name, d.number, d.status, c.name_en, c.name_he, d.currency, d.total_minor,
           ${ILS_SQL('d.total_minor', 'd.currency', 'd.total_ils_minor')} AS ils
         FROM documents d JOIN document_types dt ON dt.code = d.type LEFT JOIN clients c ON c.id = d.client_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.date, d.id`,
        ...args,
      );
      const rows: ReportRow[] = docs.map((d) => ({
        key: `doc:${d.id}`,
        cells: {
          date: d.date,
          type: d.type_name,
          number: displayNumber(d.type, d.number) ?? '',
          client: clientName(d.name_en, d.name_he),
          status: d.status,
          amount: { minor: d.total_minor, currency: d.currency },
          // A cancelled document never counts, so its ILS figure stays out of the total.
          ils: d.status === 'final' ? d.ils : null,
        },
        link: { kind: 'document', id: d.id },
      }));

      const wantsImported = (!types || types.includes('imported')) && !f.service && (!f.method || f.method === 'imported') && statuses.includes('final');
      if (wantsImported) {
        const xWhere = ['x.issue_date BETWEEN ? AND ?'];
        const xArgs: (string | number)[] = [p.from, p.to];
        if (clientId === 'none') xWhere.push('x.client_id IS NULL');
        else if (clientId !== undefined) {
          xWhere.push('x.client_id = ?');
          xArgs.push(clientId);
        }
        if (f.clientName) {
          xWhere.push('x.client_id IS NULL AND x.client_name_text = ?');
          xArgs.push(f.clientName);
        }
        if (f.method === 'imported') xWhere.push("x.paid_status = 'paid'");
        const ext = await all<{ id: number; issue_date: string; source: string; doc_type: string; original_number: string; name_en: string | null; name_he: string | null; name_text: string; currency: string; total_minor: number; ils: number | null }>(
          db,
          `SELECT x.id, x.issue_date, x.source, x.doc_type, x.original_number, c.name_en, c.name_he, x.client_name_text AS name_text, x.currency, x.total_minor,
             ${ILS_SQL('x.total_minor', 'x.currency', 'x.total_ils_minor')} AS ils
           FROM external_documents x LEFT JOIN clients c ON c.id = x.client_id
           WHERE ${xWhere.join(' AND ')} ORDER BY x.issue_date, x.id`,
          ...xArgs,
        );
        for (const x of ext) {
          rows.push({
            key: `ext:${x.id}`,
            cells: {
              date: x.issue_date,
              type: `${x.doc_type} (imported from ${x.source})`,
              number: x.original_number,
              client: clientName(x.name_en, x.name_he, x.name_text),
              status: 'imported',
              amount: { minor: x.total_minor, currency: x.currency },
              ils: x.ils,
            },
            imported: true,
          });
        }
        rows.sort((a, b) => String(a.cells.date).localeCompare(String(b.cells.date)));
      }
      return rows;
    },
  },

  'sales-by-service': {
    title: 'Sales by service',
    columns: [
      { key: 'name', header: 'Service', kind: 'text' },
      { key: 'quantity', header: 'Quantity', kind: 'quantity', total: true },
      { key: 'count', header: 'Documents', kind: 'int' },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const b = await incomeByService(db, p.from, p.to);
      return shareRows(b.rows, (r) => report('all-documents', { service: r.key, from: p.from, to: p.to }), (r) => ({ quantity: r.quantityMilli ?? 0 }));
    },
  },

  'income-by-payment-method': {
    title: 'Income by payment method',
    columns: [
      { key: 'name', header: 'Payment method', kind: 'text' },
      { key: 'count', header: 'Payments', kind: 'int', total: true },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const rows = await all<{ key: string; name: string | null; method: string; currency: string; n: number; amount: number; ils: number | null }>(
        db,
        `SELECT CASE WHEN p.method_id IS NOT NULL THEN 'pm:' || p.method_id ELSE 'm:' || p.method END AS key,
           pm.display_name AS name, p.method, p.currency, COUNT(*) AS n, SUM(p.amount_minor) AS amount,
           SUM(${ILS_SQL('p.amount_minor', 'p.currency', 'p.amount_ils_minor')}) AS ils
         FROM payments p JOIN documents d ON d.id = p.document_id LEFT JOIN payment_methods pm ON pm.id = p.method_id
         WHERE d.status = 'final' AND p.paid_on BETWEEN ? AND ?
         GROUP BY key, p.currency
         UNION ALL
         SELECT 'imported', NULL, 'imported', x.currency, COUNT(*), SUM(x.total_minor), SUM(${ILS_SQL('x.total_minor', 'x.currency', 'x.total_ils_minor')})
         FROM external_documents x WHERE x.paid_status = 'paid' AND x.issue_date BETWEEN ? AND ?
         GROUP BY x.currency`,
        p.from,
        p.to,
        p.from,
        p.to,
      );
      const map = new Map<string, ShareRow>();
      for (const r of rows) {
        const name = r.key === 'imported' ? 'Imported, method not recorded' : (r.name ?? METHOD_NAMES[r.method] ?? r.method);
        const s = map.get(r.key) ?? { key: r.key, nameEn: name, nameHe: name, ilsMinor: 0, byCurrency: {}, count: 0, imported: r.key === 'imported' };
        s.count += r.n;
        s.ilsMinor += r.ils ?? 0;
        s.byCurrency[r.currency] = (s.byCurrency[r.currency] ?? 0) + r.amount;
        map.set(r.key, s);
      }
      const list = [...map.values()].sort((a, b) => b.ilsMinor - a.ilsMinor);
      return shareRows(list, (r) => report('all-documents', { method: r.key, from: p.from, to: p.to }));
    },
  },

  'open-proformas': {
    title: 'Open pro formas',
    columns: OPEN_ITEM_COLUMNS,
    async rows(db, p) {
      return openItemRows(await openItems(db, p.today), p, PROFORMA_TYPES);
    },
  },

  'open-payment-requests': {
    title: 'Open payment requests',
    columns: OPEN_ITEM_COLUMNS,
    async rows(db, p) {
      return openItemRows(await openItems(db, p.today), p, PAYMENT_REQUEST_TYPES);
    },
  },

  'aged-receivables': {
    title: 'Aged receivables',
    columns: OPEN_ITEM_COLUMNS,
    async rows(db, p) {
      return openItemRows(await openItems(db, p.today), p);
    },
  },

  'credits-issued': {
    title: 'Credits issued',
    columns: [
      { key: 'date', header: 'Date', kind: 'date' },
      { key: 'document', header: 'Credit', kind: 'text' },
      { key: 'client', header: 'Client', kind: 'text' },
      { key: 'credits', header: 'Credits', kind: 'text' },
      { key: 'reason', header: 'Reason', kind: 'text' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const rows = await all<{
        id: number;
        date: string;
        type: string;
        type_name: string;
        number: number | null;
        name_en: string | null;
        name_he: string | null;
        currency: string;
        total_minor: number;
        ils: number | null;
        reason: string | null;
        source_type: string | null;
        source_number: number | null;
      }>(
        db,
        `SELECT d.id, d.date, d.type, dt.name_en AS type_name, d.number, c.name_en, c.name_he, d.currency, d.total_minor,
           ${ILS_SQL('d.total_minor', 'd.currency', 'd.total_ils_minor')} AS ils, m.credit_reason AS reason,
           s.type AS source_type, s.number AS source_number
         FROM documents d
         JOIN document_types dt ON dt.code = d.type
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN document_meta m ON m.document_id = d.id
         LEFT JOIN document_links l ON l.target_id = d.id AND l.kind = 'credit'
         LEFT JOIN documents s ON s.id = l.source_id
         WHERE d.status = 'final' AND dt.kind IN ('credit', 'credit_invoice') AND d.date BETWEEN ? AND ?
         GROUP BY d.id
         ORDER BY d.date, d.id`,
        p.from,
        p.to,
      );
      return rows.map((r) => ({
        key: String(r.id),
        cells: {
          date: r.date,
          document: `${r.type_name} ${displayNumber(r.type, r.number) ?? ''}`.trim(),
          client: clientName(r.name_en, r.name_he),
          credits: r.source_type ? (displayNumber(r.source_type, r.source_number) ?? '') : '',
          reason: r.reason ?? '',
          amount: { minor: r.total_minor, currency: r.currency },
          ils: r.ils,
        },
        link: { kind: 'document', id: r.id },
      }));
    },
  },

  // Expenses ----------------------------------------------------------------
  'purchases-by-supplier': {
    title: 'Purchases by supplier',
    columns: [
      { key: 'name', header: 'Supplier', kind: 'text' },
      { key: 'count', header: 'Expenses', kind: 'int', total: true },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const rows = await all<{ supplier_id: number | null; supplier_name: string | null; currency: string; n: number; amount: number; ils: number | null }>(
        db,
        `SELECT supplier_id, supplier_name, currency, COUNT(*) AS n, SUM(amount_minor) AS amount, SUM(ils_minor) AS ils
         FROM (${EXPENSE_ROWS_SQL}) GROUP BY supplier_id, currency`,
        p.from,
        p.to,
      );
      const map = new Map<string, ShareRow>();
      for (const r of rows) {
        const key = `supplier:${r.supplier_id ?? 'none'}`;
        const s = map.get(key) ?? { key, nameEn: r.supplier_name ?? 'No supplier', nameHe: r.supplier_name ?? 'No supplier', ilsMinor: 0, byCurrency: {}, count: 0 };
        s.count += r.n;
        s.ilsMinor += r.ils ?? 0;
        s.byCurrency[r.currency] = (s.byCurrency[r.currency] ?? 0) + r.amount;
        map.set(key, s);
      }
      const list = [...map.values()].sort((a, b) => b.ilsMinor - a.ilsMinor);
      return shareRows(list, (r) => report('expense-items', { supplierId: r.key.slice(9), from: p.from, to: p.to }));
    },
  },

  'expenses-by-category': {
    title: 'Expenses by category',
    columns: [
      { key: 'name', header: 'Category', kind: 'text' },
      { key: 'count', header: 'Expenses', kind: 'int', total: true },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const b = await expensesByCategory(db, p.from, p.to);
      return shareRows(b.rows, (r) => report('expense-items', { categoryId: r.key.slice(9), from: p.from, to: p.to }));
    },
  },

  'fixed-vs-one-off': {
    title: 'Fixed and one-off expenses',
    columns: [
      { key: 'month', header: 'Month', kind: 'month' },
      { key: 'fixed', header: 'Fixed ILS', kind: 'ils', total: true },
      { key: 'oneOff', header: 'One-off ILS', kind: 'ils', total: true },
      { key: 'unknown', header: 'Not marked ILS', kind: 'ils', total: true },
      { key: 'ils', header: 'Total ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const rows = await all<{ month: string; is_fixed: number | null; ils: number | null }>(
        db,
        `SELECT strftime('%Y-%m', date) AS month, is_fixed, SUM(ils_minor) AS ils FROM (${EXPENSE_ROWS_SQL}) GROUP BY month, is_fixed`,
        p.from,
        p.to,
      );
      return monthsBetween(p.from, p.to).map((month) => {
        const pick = (v: number | null) => rows.find((r) => r.month === month && r.is_fixed === v)?.ils ?? 0;
        const fixed = pick(1);
        const oneOff = pick(0);
        const unknown = pick(null);
        return {
          key: month,
          cells: { month, fixed, oneOff, unknown, ils: fixed + oneOff + unknown },
          link: report('expense-items', { from: `${month}-01`, to: monthEnd(month) }),
        };
      });
    },
  },

  /** Drill-down target for the expense summaries: the expenses behind a row. */
  'expense-items': {
    title: 'Expenses',
    columns: [
      { key: 'date', header: 'Date', kind: 'date' },
      { key: 'supplier', header: 'Supplier', kind: 'text' },
      { key: 'category', header: 'Category', kind: 'text' },
      { key: 'fixed', header: 'Fixed', kind: 'text' },
      { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      const supplierId = idFilter(p.filters.supplierId, 'supplierId');
      const categoryId = idFilter(p.filters.categoryId, 'categoryId');
      const where: string[] = [];
      const args: number[] = [];
      if (supplierId === 'none') where.push('supplier_id IS NULL');
      else if (supplierId !== undefined) {
        where.push('supplier_id = ?');
        args.push(supplierId);
      }
      if (categoryId === 'none') where.push('category_id IS NULL');
      else if (categoryId !== undefined) {
        where.push('category_id = ?');
        args.push(categoryId);
      }
      if (p.filters.fixed === '1' || p.filters.fixed === '0') where.push(`is_fixed = ${p.filters.fixed}`);
      else if (p.filters.fixed === 'unknown') where.push('is_fixed IS NULL');
      const rows = await all<{ id: number; date: string; supplier_name: string | null; category_name: string | null; is_fixed: number | null; currency: string; amount_minor: number; ils_minor: number | null }>(
        db,
        `SELECT * FROM (${EXPENSE_ROWS_SQL}) ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date, id`,
        p.from,
        p.to,
        ...args,
      );
      return rows.map((r) => ({
        key: String(r.id),
        cells: {
          date: r.date,
          supplier: r.supplier_name ?? '',
          category: r.category_name ?? 'Uncategorized',
          fixed: r.is_fixed === 1 ? 'Fixed' : r.is_fixed === 0 ? 'One-off' : '',
          amount: { minor: r.amount_minor, currency: r.currency },
          ils: r.ils_minor,
        },
        link: { kind: 'expense', id: r.id },
      }));
    },
  },

  // Tax ---------------------------------------------------------------------
  'cash-flow': {
    title: 'Cash flow',
    columns: [
      { key: 'month', header: 'Month', kind: 'month' },
      { key: 'inflow', header: 'Money in ILS', kind: 'ils', total: true },
      { key: 'importedInflow', header: 'Money in, imported ILS', kind: 'ils', total: true },
      { key: 'outflow', header: 'Money out ILS', kind: 'ils', total: true },
      { key: 'net', header: 'Net change ILS', kind: 'ils', total: true },
    ],
    async rows(db, p) {
      return (await cashFlowByMonth(db, p.from, p.to)).map((m) => ({
        key: m.month,
        cells: { month: m.month, inflow: m.inflowIlsMinor, importedInflow: m.importedInflowIlsMinor, outflow: m.outflowIlsMinor, net: m.netIlsMinor },
        link: report('all-documents', { from: `${m.month}-01`, to: monthEnd(m.month) }),
      }));
    },
  },

  'annual-summary': {
    title: 'Annual summary for the income tax return',
    columns: [
      { key: 'year', header: 'Year', kind: 'text' },
      { key: 'line', header: 'Line', kind: 'text' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils' },
    ],
    async rows(db, p) {
      const [income, expenses] = await Promise.all([
        all<{ year: string; imported: number; ils: number | null }>(
          db,
          `SELECT strftime('%Y', date) AS year, imported, SUM(ils_minor) AS ils FROM (${INCOME_ROWS_SQL}) GROUP BY year, imported`,
          p.from,
          p.to,
          p.from,
          p.to,
        ),
        all<{ year: string; category_id: number | null; category_name: string | null; ils: number | null }>(
          db,
          `SELECT strftime('%Y', date) AS year, category_id, category_name, SUM(ils_minor) AS ils FROM (${EXPENSE_ROWS_SQL})
           GROUP BY year, category_id ORDER BY year, category_name`,
          p.from,
          p.to,
        ),
      ]);
      const years = [...new Set([...income.map((r) => r.year), ...expenses.map((r) => r.year)])].sort();
      const out: ReportRow[] = [];
      for (const year of years) {
        const from = year === p.from.slice(0, 4) ? p.from : `${year}-01-01`;
        const to = year === p.to.slice(0, 4) ? p.to : `${year}-12-31`;
        const issued = income.find((r) => r.year === year && r.imported === 0)?.ils ?? 0;
        const imported = income.find((r) => r.year === year && r.imported === 1)?.ils ?? 0;
        const cats = expenses.filter((r) => r.year === year);
        const expenseTotal = cats.reduce((s, r) => s + (r.ils ?? 0), 0);
        out.push({ key: `${year}:issued`, cells: { year, line: 'Income, Open Ledger IL documents', ils: issued }, link: report('all-documents', { from, to, type: '400,405,305,320,330' }) });
        out.push({ key: `${year}:imported`, cells: { year, line: 'Income, imported documents', ils: imported }, link: report('all-documents', { from, to, type: 'imported' }), imported: true });
        out.push({ key: `${year}:income`, cells: { year, line: 'Total income', ils: issued + imported } });
        for (const c of cats) {
          out.push({
            key: `${year}:cat:${c.category_id ?? 'none'}`,
            cells: { year, line: `Expenses: ${c.category_name ?? 'Uncategorized'}`, ils: c.ils ?? 0 },
            link: report('expense-items', { categoryId: String(c.category_id ?? 'none'), from, to }),
          });
        }
        out.push({ key: `${year}:expenses`, cells: { year, line: 'Total expenses', ils: expenseTotal } });
        out.push({ key: `${year}:net`, cells: { year, line: 'Net income', ils: issued + imported - expenseTotal } });
      }
      return out;
    },
  },
};

export const REPORT_IDS = Object.keys(REPORTS);

export async function runReport(db: D1Database, id: string, p: ReportParams): Promise<ReportResult> {
  const def = REPORTS[id];
  if (!def) throw new NotFoundError('Report', id);
  const rows = await def.rows(db, p);
  const totals: Record<string, number> = {};
  for (const col of def.columns) {
    if (!col.total) continue;
    totals[col.key] = rows.reduce((s, r) => s + (typeof r.cells[col.key] === 'number' ? (r.cells[col.key] as number) : 0), 0);
  }
  return { report: id, title: def.title, from: p.from, to: p.to, columns: def.columns, rows, totals };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function isMoney(v: Cell | undefined): v is MoneyValue {
  return typeof v === 'object' && v !== null && 'minor' in v && 'currency' in v;
}

function exportTable(result: ReportResult, amount: (minor: number, currency: string) => string | number): (string | number)[][] {
  const headers: string[] = [];
  for (const c of result.columns) {
    if (c.kind === 'money') headers.push(`${c.header} currency`, c.header);
    else headers.push(c.header);
  }
  const line = (cells: Record<string, Cell>): (string | number)[] => {
    const out: (string | number)[] = [];
    for (const c of result.columns) {
      const v = cells[c.key];
      if (c.kind === 'money') {
        if (isMoney(v)) out.push(v.currency, amount(v.minor, v.currency));
        else out.push('', '');
      } else if (c.kind === 'ils') out.push(typeof v === 'number' ? amount(v, 'ILS') : '');
      else if (c.kind === 'quantity') out.push(typeof v === 'number' ? v / 1000 : '');
      else if (c.kind === 'moneyList') {
        const entries = v && typeof v === 'object' && !isMoney(v) ? Object.entries(v) : [];
        out.push(entries.map(([cur, minor]) => `${cur} ${decimalMinor(minor, cur)}`).join('; '));
      } else out.push(v === null || v === undefined ? '' : (v as string | number));
    }
    return out;
  };
  const body = result.rows.map((r) => line(r.cells));
  if (Object.keys(result.totals).length > 0) {
    const totalCells: Record<string, Cell> = { ...result.totals };
    const first = result.columns[0]!;
    if (!(first.key in totalCells)) totalCells[first.key] = 'Total';
    body.push(line(totalCells));
  }
  return [headers, ...body];
}

export function reportCsv(result: ReportResult): string {
  const [headers, ...rows] = exportTable(result, decimalMinor);
  return toCsv(headers as string[], rows);
}

export function reportSheet(result: ReportResult): XlsxSheet {
  return { name: result.title, rows: exportTable(result, numberMinor) };
}

export function reportXlsx(result: ReportResult): Uint8Array {
  return buildXlsx([reportSheet(result)]);
}
