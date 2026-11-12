import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthUser, isLedgerAdmin } from '../../core/auth';
import { first, todayIsrael } from '../../core/db';
import { ledgerEdition } from '../../core/edition';
import { ForbiddenError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { declareManualAuth } from '../access/route-guard';
import { ceilingMeter } from '../ceiling/meter';
import { itaEnvironment } from '../ita/config';
import { type EntityType, getEntityType, getVatReporting, vatDueIn, vatPeriodOn, vatReportDueDayOn } from '../legal-mode/business-type';

/**
 * R48 task 7: the Clients page. Firm edition, Ledger admins and firm staff. One row per business
 * they can open, from the existing services, one business at a time, 25 per page, so a page load
 * stays inside the Worker's CPU limit.
 */

export const PAGE_SIZE = 25;

export interface ClientRow {
  id: number;
  nameEn: string;
  nameHe: string;
  taxId: string | null;
  entityType: EntityType;
  status: 'active' | 'moved_out';
  vat: { due: string; amountMinor: number } | null;
  ceiling: { percent: number; currentMinor: number; limitMinor: number } | null;
  ita: 'connected' | 'reconnect_required' | 'none';
  signingNotAfter: string | null;
  unifiedFileSent: boolean;
  openPaymentRequests: number;
  expensesToReview: number;
  lastActivity: string | null;
  needsAttention: boolean;
}

export async function isFirmStaff(db: D1Database, user: AuthUser): Promise<boolean> {
  if (isLedgerAdmin(user)) return true;
  return (await first(db, 'SELECT 1 FROM ledger_grants WHERE user_id = ? AND (ends_at IS NULL OR ends_at >= ?)', user.id, todayIsrael())) !== null;
}

export async function clientRow(db: D1Database, env: AppEnv['Bindings'], businessId: number, today: string): Promise<ClientRow> {
  const b = (await first<{ id: number; name_en: string; name_he: string; tax_id: string | null; status: 'active' | 'moved_out' }>(
    db,
    'SELECT id, name_en, name_he, tax_id, status FROM businesses WHERE id = ?',
    businessId,
  ))!;
  const entityType = await getEntityType(db, businessId);
  let vat: ClientRow['vat'] = null;
  let ceiling: ClientRow['ceiling'] = null;
  if (entityType === 'osek_patur') {
    const m = await ceilingMeter(db, today, businessId);
    if (m && m.legalMode === 'patur') ceiling = { percent: m.limitMinor > 0 ? Math.round((m.currentMinor * 100) / m.limitMinor) : 0, currentMinor: m.currentMinor, limitMinor: m.limitMinor };
  } else {
    const period = vatPeriodOn(today, await getVatReporting(db, businessId), await vatReportDueDayOn(db, today));
    vat = { due: period.reportDue, amountMinor: (await vatDueIn(db, period, businessId)).amountMinor };
  }
  const ita = await first<{ status: string }>(db, 'SELECT status FROM ita_tokens WHERE business_id = ? AND environment = ?', businessId, itaEnvironment(env));
  const key = await first<{ not_after: string }>(db, "SELECT not_after FROM business_signing_keys WHERE business_id = ? AND status = 'active'", businessId);
  const lastYear = String(Number(today.slice(0, 4)) - 1);
  const sent = await first(db, "SELECT 1 FROM unified_file_transmissions WHERE business_id = ? AND substr(period_from, 1, 4) = ?", businessId, lastYear);
  // An open payment request: final, and not yet converted to a receipt or invoice.
  const pr = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM documents d WHERE d.business_id = ? AND d.type = 'PR' AND d.status = 'final'
       AND NOT EXISTS (SELECT 1 FROM document_links l WHERE l.source_id = d.id AND l.kind = 'converted')`,
    businessId,
  );
  const review = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM expenses WHERE business_id = ? AND status = 'new'", businessId);
  const last = await first<{ at: string }>(db, 'SELECT MAX(at) AS at FROM audit_log WHERE business_id = ?', businessId);
  const signingSoon = key ? Date.parse(key.not_after) - Date.parse(`${today}T00:00:00Z`) < 60 * 86_400_000 : ledgerEdition(env) === 'firm' && businessId !== 1;
  const vatSoon = vat ? Date.parse(`${vat.due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`) < 7 * 86_400_000 : false;
  const row: ClientRow = {
    id: b.id,
    nameEn: b.name_en,
    nameHe: b.name_he,
    taxId: b.tax_id,
    entityType,
    status: b.status ?? 'active',
    vat,
    ceiling,
    ita: ita ? (ita.status === 'active' ? 'connected' : 'reconnect_required') : 'none',
    signingNotAfter: key?.not_after ?? null,
    unifiedFileSent: Boolean(sent),
    openPaymentRequests: pr?.n ?? 0,
    expensesToReview: review?.n ?? 0,
    lastActivity: last?.at ?? null,
    needsAttention: false,
  };
  row.needsAttention =
    row.status === 'active' &&
    (vatSoon || signingSoon || row.ita === 'reconnect_required' || (ceiling !== null && ceiling.percent >= 85) || row.expensesToReview > 0);
  return row;
}

const query = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z.string().trim().max(100).optional(),
  attention: z.enum(['1', '0']).optional(),
  sort: z.enum(['name', 'vat', 'activity']).default('name'),
});

export function createFirmModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.get('/clients', declareManualAuth('firm edition, Ledger admins and firm staff, checked inline'), async (c) => {
    const user = c.get('user');
    if (ledgerEdition(c.env) !== 'firm' || !(await isFirmStaff(c.env.DB, user))) throw new ForbiddenError('The Clients page is for the firm team.');
    const input = query.parse(c.req.query());
    const db = c.env.DB;
    const ids = user.businesses.map((b) => b.id);
    const names = new Map<number, { name_en: string; name_he: string; tax_id: string | null }>();
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const rows = await db
        .prepare(`SELECT id, name_en, name_he, tax_id FROM businesses WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<{ id: number; name_en: string; name_he: string; tax_id: string | null }>();
      for (const row of rows.results) names.set(row.id, row);
    }
    const q = (input.q ?? '').toLowerCase();
    let filtered = ids.filter((id) => {
      const n = names.get(id);
      return !q || `${n?.name_en ?? ''} ${n?.name_he ?? ''} ${n?.tax_id ?? ''}`.toLowerCase().includes(q);
    });
    filtered.sort((a, b) => (names.get(a)?.name_en ?? '').localeCompare(names.get(b)?.name_en ?? ''));
    const today = todayIsrael();
    // Needs attention reads every row, so it pages after the filter: still one business at a time.
    if (input.attention === '1') {
      const rows: ClientRow[] = [];
      for (const id of filtered) {
        const row = await clientRow(db, c.env, id, today);
        if (row.needsAttention) rows.push(row);
      }
      const page = rows.slice((input.page - 1) * PAGE_SIZE, input.page * PAGE_SIZE);
      return c.json({ total: rows.length, page: input.page, pageSize: PAGE_SIZE, clients: page });
    }
    const total = filtered.length;
    filtered = filtered.slice((input.page - 1) * PAGE_SIZE, input.page * PAGE_SIZE);
    const clients: ClientRow[] = [];
    for (const id of filtered) clients.push(await clientRow(db, c.env, id, today));
    if (input.sort === 'vat') clients.sort((a, b) => (a.vat?.due ?? '9999').localeCompare(b.vat?.due ?? '9999'));
    if (input.sort === 'activity') clients.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
    return c.json({ total, page: input.page, pageSize: PAGE_SIZE, clients });
  });
  return { name: 'firm', basePath: '/firm', routes: r };
}

export const firmModule = createFirmModule();
