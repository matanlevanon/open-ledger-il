import { legalModeOn } from '../../core/config';
import { all, first } from '../../core/db';
import { NotFoundError } from '../../core/errors';
import { clientBalances } from '../documents/balances';
import { documentView, documentsPage } from '../documents/views';
import type { ClientRow } from '../clients/service';

/**
 * R41: what /v1 reads. Each query is scoped to one business and pages by id: oldest first, after
 * the cursor's id, one row more than the limit to know whether there is a next page. The shapes
 * are the API's own (camelCase, minor units with a currency, ISO dates). The business rules stay
 * in the services these call.
 */

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export function encodeCursor(id: number): string {
  return btoa(`id:${id}`).replace(/=+$/, '');
}

/** The id after which the next page starts. A cursor that does not decode starts from the beginning. */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const m = /^id:(\d+)$/.exec(atob(cursor));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** Rows fetched with limit + 1 become one page and the cursor to the next. */
export function toPage<R extends { id: number }, T>(rows: R[], limit: number, map: (r: R) => T): Page<T> {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  return { data: kept.map(map), nextCursor: more ? encodeCursor(kept[kept.length - 1]!.id) : null };
}

export async function businessInfo(db: D1Database, businessId: number, today: string) {
  const b = await first<{ id: number; name_en: string; name_he: string; tax_id: string | null; entity_type: string; address_en: string | null; address_he: string | null; email: string | null; phone: string | null }>(
    db,
    'SELECT id, name_en, name_he, tax_id, entity_type, address_en, address_he, email, phone FROM businesses WHERE id = ?',
    businessId,
  );
  if (!b) throw new NotFoundError('Business', businessId);
  const mode = await legalModeOn(db, today, businessId);
  return {
    id: b.id,
    nameEn: b.name_en || null,
    nameHe: b.name_he || null,
    taxId: b.tax_id,
    entityType: b.entity_type,
    // patur: עוסק פטור, murshe: עוסק מורשה.
    legalMode: mode.mode,
    currency: 'ILS',
    addressEn: b.address_en,
    addressHe: b.address_he,
    email: b.email,
    phone: b.phone,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function clientOut(r: ClientRow, balances: Map<number, Record<string, number>>) {
  return {
    id: r.id,
    nameEn: r.name_en || null,
    nameHe: r.name_he || null,
    companyId: r.company_id,
    email: r.email,
    currency: r.currency,
    active: r.active === 1,
    openBalance: balances.get(r.id) ?? {},
    updatedAt: r.updated_at,
  };
}

export async function clientsPage(db: D1Database, businessId: number, q: { q?: string; active?: boolean; updatedSince?: string; afterId: number; limit: number }) {
  const where = ['business_id = ?', 'id > ?'];
  const params: (string | number)[] = [businessId, q.afterId];
  if (q.q) {
    where.push('(name_en LIKE ? OR name_he LIKE ? OR company_id LIKE ? OR email LIKE ?)');
    const like = `%${q.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  if (q.active !== undefined) {
    where.push('active = ?');
    params.push(q.active ? 1 : 0);
  }
  if (q.updatedSince) {
    where.push('updated_at > ?');
    params.push(q.updatedSince);
  }
  const rows = await all<ClientRow>(db, `SELECT * FROM clients WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`, ...params, q.limit + 1);
  const balances = await clientBalances(db, businessId);
  return toPage(rows, q.limit, (r) => clientOut(r, balances));
}

export async function clientById(db: D1Database, businessId: number, id: number) {
  const row = await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Client', id);
  return clientOut(row, await clientBalances(db, businessId));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

type DocItem = Awaited<ReturnType<typeof documentsPage>>[number];

function documentOut(d: DocItem) {
  const paid = d.paid_minor ?? (d.kind === 'demand' ? 0 : null);
  return {
    id: d.id,
    type: d.type,
    typeName: d.type_name_en,
    number: d.display_number,
    status: d.status,
    state: d.state,
    date: d.date,
    dueDate: d.due_date,
    clientId: d.client_id,
    clientName: d.client_name_en || d.client_name_he || null,
    currency: d.currency,
    totals: { subtotal: d.subtotal_minor, vat: d.vat_amount_minor, total: d.total_minor, paid, open: d.remaining_minor },
    allocationNumber: d.allocation_number,
    relatedDocumentIds: d.related.map((r) => r.id),
    updatedAt: d.updated_at,
  };
}

export async function documentsList(
  db: D1Database,
  businessId: number,
  q: { types?: string[]; status?: string; from?: string; to?: string; clientId?: number; updatedSince?: string; afterId: number; limit: number },
  today: string,
) {
  const rows = await documentsPage(db, businessId, { ...q, limit: q.limit + 1 }, today);
  return toPage(rows, q.limit, documentOut);
}

export async function documentById(db: D1Database, businessId: number, id: number, today: string) {
  const v = await documentView(db, id, today, businessId);
  const vatRate = v.document.vat_rate_bp;
  return {
    ...documentOut(v.document),
    exchangeRate: v.document.fx_rate,
    vatRateBp: vatRate,
    lines: v.lines.map((l) => ({
      description: l.description_en || l.description_he,
      descriptionHe: l.description_he,
      quantity: l.quantity_milli / 1000,
      quantityMilli: l.quantity_milli,
      unitPrice: l.unit_price_minor,
      discount: l.discount_minor,
      vatRateBp: vatRate,
      lineTotal: l.line_total_minor,
    })),
    payments: v.payments.map((p) => ({ date: p.paid_on, method: p.method, amount: p.amount_minor, currency: p.currency, reference: p.reference })),
  };
}

// ---------------------------------------------------------------------------
// Payments, expenses, suppliers
// ---------------------------------------------------------------------------

export async function paymentsPage(db: D1Database, businessId: number, q: { from?: string; to?: string; updatedSince?: string; afterId: number; limit: number }) {
  const where = ['d.business_id = ?', "d.status = 'final'", 'p.id > ?'];
  const params: (string | number)[] = [businessId, q.afterId];
  if (q.from) {
    where.push('p.paid_on >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('p.paid_on <= ?');
    params.push(q.to);
  }
  if (q.updatedSince) {
    // A payment does not change once recorded, so its creation time stands in.
    where.push('p.created_at > ?');
    params.push(q.updatedSince);
  }
  const rows = await all<{ id: number; document_id: number; paid_on: string; method: string; amount_minor: number; currency: string; reference: string | null; created_at: string }>(
    db,
    `SELECT p.id, p.document_id, p.paid_on, p.method, p.amount_minor, p.currency, p.reference, p.created_at
       FROM payments p JOIN documents d ON d.id = p.document_id WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT ?`,
    ...params,
    q.limit + 1,
  );
  return toPage(rows, q.limit, (p) => ({ id: p.id, documentId: p.document_id, date: p.paid_on, method: p.method, amount: p.amount_minor, currency: p.currency, reference: p.reference, createdAt: p.created_at }));
}

export async function expensesPage(db: D1Database, businessId: number, q: { from?: string; to?: string; status?: string; updatedSince?: string; afterId: number; limit: number }) {
  const where = ['e.business_id = ?', 'e.id > ?'];
  const params: (string | number)[] = [businessId, q.afterId];
  if (q.from) {
    where.push('e.document_date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('e.document_date <= ?');
    params.push(q.to);
  }
  if (q.status) {
    where.push('e.status = ?');
    params.push(q.status);
  }
  if (q.updatedSince) {
    where.push('e.updated_at > ?');
    params.push(q.updatedSince);
  }
  const rows = await all<{
    id: number;
    status: string;
    supplier_name: string | null;
    supplier_tax_id: string | null;
    document_type: string | null;
    document_number: string | null;
    document_date: string | null;
    currency: string;
    amount_minor: number;
    vat_amount_minor: number;
    amount_ils_minor: number | null;
    category_name: string | null;
    read_status: string | null;
    updated_at: string;
  }>(
    db,
    `SELECT e.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id, c.name_en AS category_name
       FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN expense_categories c ON c.id = e.category_id
      WHERE ${where.join(' AND ')} ORDER BY e.id LIMIT ?`,
    ...params,
    q.limit + 1,
  );
  return toPage(rows, q.limit, (e) => ({
    id: e.id,
    status: e.status,
    supplierName: e.supplier_name,
    supplierTaxId: e.supplier_tax_id,
    documentType: e.document_type,
    documentNumber: e.document_number,
    date: e.document_date,
    currency: e.currency,
    total: e.amount_minor,
    vat: e.vat_amount_minor,
    totalIls: e.amount_ils_minor,
    category: e.category_name,
    readStatus: e.read_status,
    updatedAt: e.updated_at,
  }));
}

export async function suppliersPage(db: D1Database, businessId: number, q: { updatedSince?: string; afterId: number; limit: number }) {
  const where = ['business_id = ?', 'id > ?'];
  const params: (string | number)[] = [businessId, q.afterId];
  if (q.updatedSince) {
    where.push('updated_at > ?');
    params.push(q.updatedSince);
  }
  const rows = await all<{ id: number; name: string; tax_id: string | null; country: string; default_currency: string; updated_at: string }>(
    db,
    `SELECT id, name, tax_id, country, default_currency, updated_at FROM suppliers WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,
    ...params,
    q.limit + 1,
  );
  return toPage(rows, q.limit, (s) => ({ id: s.id, name: s.name, taxId: s.tax_id, country: s.country, currency: s.default_currency, updatedAt: s.updated_at }));
}
