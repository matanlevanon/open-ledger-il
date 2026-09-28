import { type AuthUser, hasFeature } from '../../core/auth';
import { all, first } from '../../core/db';
import { getPaymentMethods, parseMethodIds } from '../payment-methods';
import { type DemandBalance, demandBalances } from './balances';
import { type DocRow, type EventRow, type LinkRow, loadFull } from './repo';
import { displayNumber } from './types';

/** Display state. Final demands read open, partial, paid or converted. Receipts read final, partially credited or credited. */
export type DocState =
  | 'draft'
  | 'open'
  | 'partial'
  | 'paid'
  | 'converted'
  | 'final'
  | 'partially_credited'
  | 'credited'
  | 'cancelled'
  | 'awaiting_allocation';

interface ListRow extends DocRow {
  kind: string;
  type_name_en: string;
  type_name_he: string;
  client_name_en: string | null;
  client_name_he: string | null;
  converted: number;
  credited_minor: number;
}

const LIST_SELECT = `
  SELECT d.*, dt.kind, dt.name_en AS type_name_en, dt.name_he AS type_name_he,
    c.name_en AS client_name_en, c.name_he AS client_name_he,
    EXISTS (
      SELECT 1 FROM document_links l JOIN documents t ON t.id = l.target_id
      WHERE l.source_id = d.id AND l.kind = 'converted' AND t.status <> 'cancelled'
    ) AS converted,
    COALESCE((
      SELECT SUM(l.amount_minor) FROM document_links l JOIN documents t ON t.id = l.target_id
      WHERE l.source_id = d.id AND l.kind = 'credit' AND t.status <> 'cancelled'
    ), 0) AS credited_minor
  FROM documents d
  JOIN document_types dt ON dt.code = d.type
  LEFT JOIN clients c ON c.id = d.client_id`;

function stateOf(row: ListRow, balance: DemandBalance | undefined): DocState {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status !== 'final') return 'awaiting_allocation';
  if (row.kind === 'quote') return row.converted ? 'converted' : 'open';
  if (row.kind === 'demand') {
    if (!balance) return 'open';
    if (balance.superseded) return 'converted';
    if (balance.remaining_minor <= 0) return 'paid';
    return balance.paid_minor > 0 ? 'partial' : 'open';
  }
  if (row.credited_minor > 0) return row.credited_minor >= Math.abs(row.total_minor) ? 'credited' : 'partially_credited';
  return 'final';
}

function decorate(row: ListRow, balance: DemandBalance | undefined, today: string) {
  const state = stateOf(row, balance);
  const remaining = balance ? balance.remaining_minor : null;
  return {
    ...row,
    display_number: displayNumber(row.type, row.number),
    state,
    paid_minor: balance?.paid_minor ?? null,
    remaining_minor: remaining,
    overdue: Boolean(remaining && remaining > 0 && row.due_date && row.due_date < today),
  };
}

export type DocumentListItem = ReturnType<typeof decorate>;

export interface ListFilter {
  tab: 'unpaid' | 'draft' | 'all';
  type?: string;
  kind?: string;
  clientId?: number;
  from?: string;
  to?: string;
  limit: number;
}

export async function listDocuments(db: D1Database, user: AuthUser, filter: ListFilter, today: string) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!hasFeature(user, 'quotes')) where.push("d.type <> 'QT'");
  if (filter.tab === 'draft') where.push("d.status = 'draft'");
  if (filter.tab === 'unpaid') where.push("dt.kind = 'demand' AND d.status = 'final'");
  if (filter.type) {
    const types = filter.type.split(',').filter(Boolean);
    where.push(`d.type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (filter.kind) {
    where.push('dt.kind = ?');
    params.push(filter.kind);
  }
  if (filter.clientId) {
    where.push('d.client_id = ?');
    params.push(filter.clientId);
  }
  if (filter.from) {
    where.push('d.date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('d.date <= ?');
    params.push(filter.to);
  }
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY d.date DESC, d.id DESC LIMIT ?`;
  const rows = await all<ListRow>(db, sql, ...params, filter.limit);
  const balances = await demandBalances(
    db,
    rows.filter((r) => r.kind === 'demand' && r.status === 'final').map((r) => r.id),
  );
  let items = rows.map((r) => decorate(r, balances.get(r.id), today));
  if (filter.tab === 'unpaid') items = items.filter((i) => (i.remaining_minor ?? 0) > 0);

  // Summary strip: overdue and due within 30 days, per currency.
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonDate = soon.toISOString().slice(0, 10);
  const summary = { overdue: {} as Record<string, number>, due_soon: {} as Record<string, number>, open: {} as Record<string, number> };
  for (const i of items) {
    const rem = i.remaining_minor ?? 0;
    if (rem <= 0) continue;
    summary.open[i.currency] = (summary.open[i.currency] ?? 0) + rem;
    if (i.overdue) summary.overdue[i.currency] = (summary.overdue[i.currency] ?? 0) + rem;
    else if (i.due_date && i.due_date <= soonDate) summary.due_soon[i.currency] = (summary.due_soon[i.currency] ?? 0) + rem;
  }
  return { items, summary };
}

interface LinkView extends LinkRow {
  other_id: number;
  other_type: string;
  other_number: number | null;
  other_status: string;
  other_display_number: string | null;
}

export async function documentView(db: D1Database, id: number, today: string) {
  const loaded = await loadFull(db, id);
  const row = await first<ListRow>(db, `${LIST_SELECT} WHERE d.id = ?`, id);
  const balances = row?.kind === 'demand' && row.status === 'final' ? await demandBalances(db, [id]) : new Map();
  const [outgoing, incoming, events] = await Promise.all([
    all<LinkView>(
      db,
      `SELECT l.*, t.id AS other_id, t.type AS other_type, t.number AS other_number, t.status AS other_status
       FROM document_links l JOIN documents t ON t.id = l.target_id WHERE l.source_id = ? ORDER BY l.id`,
      id,
    ),
    all<LinkView>(
      db,
      `SELECT l.*, s.id AS other_id, s.type AS other_type, s.number AS other_number, s.status AS other_status
       FROM document_links l JOIN documents s ON s.id = l.source_id WHERE l.target_id = ? ORDER BY l.id`,
      id,
    ),
    all<EventRow>(db, 'SELECT * FROM document_events WHERE document_id = ? ORDER BY at, id', id),
  ]);
  const withLabel = (l: LinkView) => ({ ...l, other_display_number: displayNumber(l.other_type, l.other_number) });
  let source: { id: number; type: string; display_number: string | null; status: string } | null = null;
  if (loaded.meta?.source_id) {
    const s = await first<DocRow>(db, 'SELECT * FROM documents WHERE id = ?', loaded.meta.source_id);
    if (s) source = { id: s.id, type: s.type, display_number: displayNumber(s.type, s.number), status: s.status };
  }

  // R17 task 2: resolve the document's payment methods multi-select, and each payment's own
  // method, into full catalog rows so the frontend and PDF need no second round trip.
  const methodIds = new Set(parseMethodIds(loaded.doc.payment_method_ids));
  for (const p of loaded.payments) if (p.method_id !== null) methodIds.add(p.method_id);
  const methodRows = await getPaymentMethods(db, [...methodIds]);
  const methodById = new Map(methodRows.map((m) => [m.id, { ...m, details: JSON.parse(m.details) as Record<string, unknown> }]));
  const paymentMethods = parseMethodIds(loaded.doc.payment_method_ids)
    .map((mid) => methodById.get(mid))
    .filter((m) => m !== undefined);
  const payments = loaded.payments.map((p) => ({ ...p, method_detail: p.method_id !== null ? (methodById.get(p.method_id) ?? null) : null }));

  return {
    document: decorate(row!, balances.get(id), today),
    lines: loaded.lines,
    payments,
    paymentMethods,
    meta: loaded.meta,
    source,
    links: { outgoing: outgoing.map(withLabel), incoming: incoming.map(withLabel) },
    events: events.map((e) => ({ ...e, details: e.details ? (JSON.parse(e.details) as unknown) : null })),
  };
}
