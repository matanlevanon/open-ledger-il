import { externalKind } from '../import/external-kind';
import { all } from '../../core/db';
import { displayNumber } from './types';

/**
 * Open balances and the client book.
 *
 * Model (docs/currency-and-fx.md, "Balances"):
 * - A demand (payment request, חשבון עסקה) is a charge in its own currency.
 * - Receipts linked to it by a `payment` link reduce what is left. Cancelled receipts do not count.
 * - A demand converted into another demand hands its balance to the new one and reads 0.
 * - A credit receipt reverses part of a receipt. It lowers the paid amount and the charge by the
 *   same amount, so the open balance of the demand does not move.
 * - Balances stay per currency. No ILS on open items, no revaluation.
 */

export interface DemandBalance {
  id: number;
  currency: string;
  total_minor: number;
  paid_minor: number;
  remaining_minor: number;
  superseded: boolean;
}

const DEMAND_SQL = `
  SELECT d.id, d.currency, d.total_minor, d.status, d.client_id, d.date, d.due_date, d.fx_rate,
    COALESCE((
      SELECT SUM(l.amount_minor) FROM document_links l JOIN documents t ON t.id = l.target_id
      WHERE l.source_id = d.id AND l.kind = 'payment' AND t.status <> 'cancelled'
    ), 0) AS paid_minor,
    EXISTS (
      SELECT 1 FROM document_links l
      JOIN documents t ON t.id = l.target_id
      JOIN document_types tt ON tt.code = t.type
      WHERE l.source_id = d.id AND l.kind = 'converted' AND t.status <> 'cancelled'
        AND tt.kind IN ('demand', 'invoice', 'invoice_receipt')
    ) AS superseded
  FROM documents d JOIN document_types dt ON dt.code = d.type
  WHERE dt.kind = 'demand' AND d.status = 'final'`;

interface DemandSqlRow {
  id: number;
  currency: string;
  total_minor: number;
  status: string;
  client_id: number | null;
  date: string;
  due_date: string | null;
  fx_rate: string | null;
  paid_minor: number;
  superseded: number;
}

function toBalance(r: DemandSqlRow): DemandBalance {
  const superseded = r.superseded === 1;
  return {
    id: r.id,
    currency: r.currency,
    total_minor: r.total_minor,
    paid_minor: r.paid_minor,
    remaining_minor: superseded ? 0 : r.total_minor - r.paid_minor,
    superseded,
  };
}

/** Balances of final demands. Pass ids to limit the query. */
export async function demandBalances(db: D1Database, ids?: number[]): Promise<Map<number, DemandBalance>> {
  const out = new Map<number, DemandBalance>();
  if (ids && ids.length === 0) return out;
  const filter = ids ? ` AND d.id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = await all<DemandSqlRow>(db, DEMAND_SQL + filter, ...(ids ?? []));
  for (const r of rows) out.set(r.id, toBalance(r));
  return out;
}

export async function demandBalance(db: D1Database, id: number): Promise<DemandBalance | null> {
  return (await demandBalances(db, [id])).get(id) ?? null;
}

export interface OpenDemand extends DemandBalance {
  client_id: number | null;
  date: string;
  due_date: string | null;
  /** Rate frozen on the demand (agreed or indicative), or null. Never applied to the balance itself. */
  fx_rate: string | null;
}

/** Final demands with money still open, for one client or all. */
export async function openDemands(db: D1Database, clientId?: number): Promise<OpenDemand[]> {
  const filter = clientId === undefined ? '' : ' AND d.client_id = ?';
  const rows = await all<DemandSqlRow>(db, DEMAND_SQL + filter, ...(clientId === undefined ? [] : [clientId]));
  return rows
    .map((r) => ({ ...toBalance(r), client_id: r.client_id, date: r.date, due_date: r.due_date, fx_rate: r.fx_rate }))
    .filter((b) => b.remaining_minor > 0);
}

export type CurrencyTotals = Record<string, number>;

function add(totals: CurrencyTotals, currency: string, amount: number) {
  totals[currency] = (totals[currency] ?? 0) + amount;
}

/** Open balance per client per currency. */
export async function clientBalances(db: D1Database): Promise<Map<number, CurrencyTotals>> {
  const out = new Map<number, CurrencyTotals>();
  for (const d of await openDemands(db)) {
    if (d.client_id === null) continue;
    const totals = out.get(d.client_id) ?? {};
    add(totals, d.currency, d.remaining_minor);
    out.set(d.client_id, totals);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client book (תוספת ה׳)
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  kind: 'document' | 'payment' | 'imported';
  date: string;
  document_id: number;
  type: string;
  type_name_en: string;
  number: number | null;
  display_number: string | null;
  status: string;
  description: string;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number;
  payment_id?: number;
  method?: string;
  paid_on?: string;
  reference?: string | null;
  amount_ils_minor?: number | null;
  fx_rate?: string | null;
}

export interface ClientLedger {
  client_id: number;
  from: string | null;
  to: string | null;
  opening: CurrencyTotals;
  closing: CurrencyTotals;
  entries: LedgerEntry[];
}

interface LedgerDocRow {
  id: number;
  type: string;
  number: number | null;
  status: string;
  date: string;
  currency: string;
  total_minor: number;
  kind: string;
  name_en: string;
  seq: number | null;
  source_id: number | null;
  source_kind: string | null;
  source_total: number | null;
  source_type_kind: string | null;
  source_type: string | null;
  source_number: number | null;
}

interface LedgerPaymentRow {
  id: number;
  document_id: number;
  method: string;
  paid_on: string;
  reference: string | null;
  amount_minor: number;
  amount_ils_minor: number | null;
  fx_rate: string | null;
}

/**
 * Every final and cancelled document and payment of a client, with a running balance per currency.
 * Debit is what the client was charged, credit is what the client paid.
 * Cancelled documents stay in the book with zero effect. Quotes are not bookkeeping and stay out.
 */
interface LedgerImportedRow {
  id: number;
  source: string;
  doc_type: string;
  original_number: string;
  issue_date: string;
  currency: string;
  total_minor: number;
  paid_status: string;
  settled: number;
}

/**
 * The client book. With `includeImported`, past documents filed under Import join the book in date
 * order, the way a demand and its receipt book here:
 * - A payment request, pro forma or tax invoice is charged (debit).
 * - A receipt or invoice/receipt is paid (credit). It pays the open imported demands of the same
 *   currency dated on or before it, oldest first, demands marked paid before those marked unpaid.
 *   Whatever is left after that is a sale paid on the spot and is charged on the same line.
 * - A receipt issued here for an imported demand (external_document_receipts) pays that demand, so
 *   it is not charged again.
 * - A demand marked paid that no imported receipt or receipt issued here paid (the receipt was
 *   never imported, or was paid in another currency) is paid on its own line.
 * - Quotes stay out.
 * The accountant report keeps imported documents in their own list instead
 * (reports/client-ledgers.ts), so it never passes `includeImported`.
 */
export async function clientLedger(db: D1Database, clientId: number, from?: string, to?: string, includeImported = false): Promise<ClientLedger> {
  const docs = await all<LedgerDocRow>(
    db,
    `SELECT d.id, d.type, d.number, d.status, d.date, d.currency, d.total_minor, dt.kind, dt.name_en, f.seq,
            m.source_id, m.source_kind, s.total_minor AS source_total, st.kind AS source_type_kind,
            s.type AS source_type, s.number AS source_number
     FROM documents d
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN finalizations f ON f.document_id = d.id
     LEFT JOIN document_meta m ON m.document_id = d.id
     LEFT JOIN documents s ON s.id = m.source_id
     LEFT JOIN document_types st ON st.code = s.type
     WHERE d.client_id = ? AND d.status IN ('final', 'cancelled') AND dt.kind <> 'quote'
       AND (? IS NULL OR d.date <= ?)
     ORDER BY d.date, f.seq, d.id`,
    clientId,
    to ?? null,
    to ?? null,
  );
  const payments = await all<LedgerPaymentRow>(
    db,
    `SELECT p.id, p.document_id, p.method, p.paid_on, p.reference, p.amount_minor, p.amount_ils_minor, p.fx_rate
     FROM payments p JOIN documents d ON d.id = p.document_id
     WHERE d.client_id = ? AND d.status IN ('final', 'cancelled')
     ORDER BY p.id`,
    clientId,
  );
  const paymentsByDoc = new Map<number, LedgerPaymentRow[]>();
  for (const p of payments) {
    const list = paymentsByDoc.get(p.document_id) ?? [];
    list.push(p);
    paymentsByDoc.set(p.document_id, list);
  }

  const imported = includeImported
    ? await all<LedgerImportedRow>(
        db,
        `SELECT x.id, x.source, x.doc_type, x.original_number, x.issue_date, x.currency, x.total_minor, x.paid_status,
           EXISTS (SELECT 1 FROM external_document_receipts r JOIN documents d ON d.id = r.document_id
                   WHERE r.external_id = x.id AND d.status = 'final') AS settled
         FROM external_documents x WHERE x.client_id = ? AND (? IS NULL OR x.issue_date <= ?) ORDER BY x.issue_date, x.id`,
        clientId,
        to ?? null,
        to ?? null,
      )
    : [];

  // Receipts issued here for an imported demand. They pay it, so they are not a sale of their own.
  const paysImported = new Map<number, string>();
  if (includeImported) {
    const links = await all<{ document_id: number; doc_type: string; original_number: string }>(
      db,
      `SELECT r.document_id, x.doc_type, x.original_number FROM external_document_receipts r
       JOIN external_documents x ON x.id = r.external_id WHERE x.client_id = ?`,
      clientId,
    );
    for (const l of links) paysImported.set(l.document_id, `${l.doc_type} ${l.original_number}`);
  }

  // Match imported receipts to the imported demands they pay, before booking in date order.
  const importedLabel = (x: LedgerImportedRow) => `${x.doc_type} ${x.original_number}`;
  const demandsOpen = imported
    .filter((x) => ['demand', 'invoice'].includes(externalKind(x.doc_type)) && x.settled !== 1)
    .map((x) => ({ x, left: x.total_minor }));
  const receiptPays = new Map<number, { spot: number; paid: string[] }>();
  const demandPaid = new Map<number, number>();
  for (const r of imported) {
    if (externalKind(r.doc_type) !== 'receipt') continue;
    let left = r.total_minor;
    const paid: string[] = [];
    const candidates = demandsOpen
      .filter((d) => d.left > 0 && d.x.currency === r.currency && d.x.issue_date <= r.issue_date)
      .sort((a, b) => Number(b.x.paid_status === 'paid') - Number(a.x.paid_status === 'paid') || a.x.issue_date.localeCompare(b.x.issue_date) || a.x.id - b.x.id);
    for (const d of candidates) {
      if (left <= 0) break;
      const amount = Math.min(left, d.left);
      d.left -= amount;
      left -= amount;
      demandPaid.set(d.x.id, (demandPaid.get(d.x.id) ?? 0) + amount);
      paid.push(importedLabel(d.x));
    }
    receiptPays.set(r.id, { spot: left, paid });
  }

  const running: CurrencyTotals = {};
  const opening: CurrencyTotals = {};
  const entries: LedgerEntry[] = [];

  let next = 0;
  /** Books every imported document dated on or before `date` (all of them when `date` is null). */
  const bookImported = (date: string | null) => {
    while (next < imported.length && (date === null || imported[next]!.issue_date <= date)) {
      const x = imported[next]!;
      next += 1;
      const kind = externalKind(x.doc_type);
      if (kind === 'quote') continue;
      let debit: number;
      let credit: number;
      let description = 'Imported past document';
      if (kind === 'receipt') {
        const pays = receiptPays.get(x.id) ?? { spot: x.total_minor, paid: [] };
        debit = pays.spot;
        credit = x.total_minor;
        if (pays.paid.length > 0) description = `${description}, pays ${pays.paid.join(', ')}`;
      } else if (kind === 'credit') {
        debit = -x.total_minor;
        credit = -x.total_minor;
      } else {
        // A demand. Paid by a matched receipt later in the book, or by a receipt issued here.
        debit = x.total_minor;
        const unmatched = x.total_minor - (demandPaid.get(x.id) ?? 0);
        credit = x.paid_status === 'paid' && x.settled !== 1 ? unmatched : 0;
        if (credit > 0) description = `${description}, marked paid`;
      }
      running[x.currency] = (running[x.currency] ?? 0) + debit - credit;
      const inPeriod = !from || x.issue_date >= from;
      if (!inPeriod) {
        opening[x.currency] = running[x.currency]!;
        continue;
      }
      entries.push({
        kind: 'imported',
        date: x.issue_date,
        document_id: x.id,
        type: 'imported',
        type_name_en: x.doc_type,
        number: null,
        display_number: `${x.doc_type} / ${x.original_number}`,
        status: 'final',
        description,
        currency: x.currency,
        debit_minor: debit,
        credit_minor: credit,
        balance_minor: running[x.currency] ?? 0,
      });
    }
  };

  for (const d of docs) {
    bookImported(d.date);
    const live = d.status !== 'cancelled';
    let debit = 0;
    let description = d.name_en;
    const sourceLabel = displayNumber(d.source_type ?? '', d.source_number);
    if (d.kind === 'demand' || d.kind === 'invoice') {
      // 'invoice' (305): a standalone tax invoice charges like a demand, with no receipt to follow.
      debit = d.total_minor;
      if (d.source_kind === 'converted' && d.source_type_kind === 'demand') {
        // The balance moved here from the source demand, which now reads zero.
        debit -= d.source_total ?? 0;
        description = `${d.name_en}, replaces ${sourceLabel}`;
      }
    } else if (d.kind === 'receipt' || d.kind === 'credit' || d.kind === 'invoice_receipt' || d.kind === 'credit_invoice') {
      // A receipt paying a demand only credits. Any other receipt is a sale paid on the spot.
      const paysLabel = paysImported.get(d.id);
      if (d.source_kind !== 'payment' && !paysLabel) debit = d.total_minor;
      if (sourceLabel) description = `${d.name_en} for ${sourceLabel}`;
      else if (paysLabel) description = `${d.name_en} for ${paysLabel}`;
    }
    if (!live) debit = 0;

    const inPeriod = !from || d.date >= from;
    const apply = (amount: number) => {
      running[d.currency] = (running[d.currency] ?? 0) + amount;
      if (!inPeriod) opening[d.currency] = running[d.currency]!;
    };

    apply(debit);
    if (inPeriod) {
      entries.push({
        kind: 'document',
        date: d.date,
        document_id: d.id,
        type: d.type,
        type_name_en: d.name_en,
        number: d.number,
        display_number: displayNumber(d.type, d.number),
        status: d.status,
        description,
        currency: d.currency,
        debit_minor: debit,
        credit_minor: 0,
        balance_minor: running[d.currency] ?? 0,
      });
    }
    for (const p of paymentsByDoc.get(d.id) ?? []) {
      const credit = live ? p.amount_minor : 0;
      apply(-credit);
      if (inPeriod) {
        entries.push({
          kind: 'payment',
          date: d.date,
          document_id: d.id,
          type: d.type,
          type_name_en: d.name_en,
          number: d.number,
          display_number: displayNumber(d.type, d.number),
          status: d.status,
          description: `Payment by ${p.method.replace('_', ' ')}`,
          currency: d.currency,
          debit_minor: 0,
          credit_minor: credit,
          balance_minor: running[d.currency] ?? 0,
          payment_id: p.id,
          method: p.method,
          paid_on: p.paid_on,
          reference: p.reference,
          amount_ils_minor: p.amount_ils_minor,
          fx_rate: p.fx_rate,
        });
      }
    }
  }

  bookImported(null);

  return { client_id: clientId, from: from ?? null, to: to ?? null, opening, closing: { ...running }, entries };
}
