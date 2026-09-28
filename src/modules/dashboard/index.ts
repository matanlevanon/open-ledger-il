import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom, auditStatement } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { ceilingFor, legalModeOn } from '../../core/config';
import { assertDate, first, nowIso, stmt, todayIsrael, transaction } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { type OpenDemand, openDemands } from '../documents/balances';
import { uploadService } from '../import';
import {
  type AgingRow,
  type Breakdown,
  type CashFlowMonth,
  type IncomeMonth,
  type OpenItem,
  type ProfitLossMonthAgg,
  type YearComparison,
  PAYMENT_REQUEST_TYPES,
  PROFORMA_TYPES,
  agingSummary,
  cashFlowByMonth,
  demandIlsResolver,
  expensesByCategory,
  incomeByClient,
  incomeByMonth,
  incomeByService,
  openItems,
  profitLossByMonth,
  yearComparison,
} from '../reports/aggregates';

/**
 * Read-only dashboard (R05, rebuilt in R21). `GET /api/dashboard?cards=...` answers every
 * requested card in one call, each card one SQL aggregate. A card with a period takes it as
 * `<card>=YYYY-MM-DD..YYYY-MM-DD`; without one it uses its default. The ceiling meter, the VAT
 * card and the ITA status are always included. The card order and visibility live in the
 * `settings` table under `dashboard_layout`.
 */

// Document types that count as turnover once final. Credit types (405, 330) carry negative totals, so they subtract.
export const INCOME_TYPES = ['400', '405', '305', '320', '330'];

/** Card ids in their default order. Quick actions is static and has no data. */
export const DASHBOARD_CARDS = [
  'quickActions',
  'overdue',
  'cashFlow',
  'profitLoss',
  'incomeByMonth',
  'topClients',
  'topServices',
  'expenseCategories',
  'yearComparison',
  'aging',
  'ceiling',
  'vat',
  'ita',
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

/** Cards that read a period, and their default range. */
const PERIOD_CARDS = ['cashFlow', 'profitLoss', 'incomeByMonth', 'topClients', 'topServices', 'expenseCategories'] as const;
type PeriodCard = (typeof PERIOD_CARDS)[number];

const TOP_LIMIT = 5;

interface CurrencyTotal {
  currency: string;
  count: number;
  totalMinor: number;
}

interface Range {
  from: string;
  to: string;
}

export interface DashboardCards {
  overdue?: { items: OpenItem[]; overdueRequests: CurrencyTotal[]; openProformas: CurrencyTotal[] };
  cashFlow?: Range & { months: CashFlowMonth[] };
  profitLoss?: Range & { months: ProfitLossMonthAgg[] };
  incomeByMonth?: Range & { months: IncomeMonth[]; totalIlsMinor: number; importedIlsMinor: number };
  topClients?: Range & Breakdown;
  topServices?: Range & Breakdown;
  expenseCategories?: Range & Breakdown;
  yearComparison?: YearComparison;
  aging?: { buckets: AgingRow[] };
}

export interface DashboardData {
  today: string;
  overdueRequests: CurrencyTotal[];
  ceiling: { year: number; currency: string; limitMinor: number; currentMinor: number } | null;
  vatDue: { applicable: boolean; amountMinor: number; currency: string };
  ita: { connected: boolean; message: string };
  cards: DashboardCards;
}

/** ILS figure for a row: the stored ILS conversion, or the amount itself when it is already ILS. */
const ILS_AMOUNT = (amountCol: string, currencyCol: string, ilsCol: string) =>
  `COALESCE(${ilsCol}, CASE WHEN ${currencyCol} = 'ILS' THEN ${amountCol} ELSE NULL END)`;

function monthStart(today: string, monthsBack: number): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

/** Default ranges, matching the web period control's defaults. */
export function defaultRange(card: PeriodCard, today: string): Range {
  const year = today.slice(0, 4);
  if (card === 'cashFlow' || card === 'profitLoss') return { from: monthStart(today, 11), to: today };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Open demands past their due date, per currency. Counts what is still open after partial payments. */
function totalsByCurrency(items: { currency: string; remaining_minor?: number; remainingMinor?: number }[]): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const d of items) {
    const t = byCurrency.get(d.currency) ?? { currency: d.currency, count: 0, totalMinor: 0 };
    t.count += 1;
    t.totalMinor += d.remaining_minor ?? d.remainingMinor ?? 0;
    byCurrency.set(d.currency, t);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function overdueRequests(demands: OpenDemand[], today: string): CurrencyTotal[] {
  return totalsByCurrency(demands.filter((d) => d.due_date !== null && d.due_date < today));
}

/**
 * ILS projection of the open remainder of this year's demands. Exported for `src/modules/ceiling`,
 * which reads the same "turnover plus open requests" meter (docs/legal-requirements.md). A foreign
 * remainder uses the rate frozen on the demand, or else R04's `rateOn` for today from the cache.
 * A currency with no cached rate yet adds nothing.
 */
export async function openRequestsIls(db: D1Database, demands: OpenDemand[], yearStart: string, yearEnd: string, today: string): Promise<number> {
  const toIls = demandIlsResolver(db, today);
  let total = 0;
  for (const d of demands) {
    if (d.date < yearStart || d.date > yearEnd) continue;
    total += (await toIls(d)) ?? 0;
  }
  return total;
}

/**
 * Final, non-cancelled turnover in ILS for a date range. Exported for `src/modules/ceiling`.
 * A credit (405, 330) is stored with a negative total, so a plain SUM subtracts it.
 */
export async function turnoverIls(db: D1Database, yearStart: string, yearEnd: string): Promise<number> {
  const placeholders = INCOME_TYPES.map(() => '?').join(',');
  const row = await first<{ total: number | null }>(
    db,
    `SELECT SUM(${ILS_AMOUNT('total_minor', 'currency', 'total_ils_minor')}) as total
     FROM documents
     WHERE status = 'final' AND type IN (${placeholders}) AND date BETWEEN ? AND ?`,
    ...INCOME_TYPES,
    yearStart,
    yearEnd,
  );
  return row?.total ?? 0;
}

export interface DashboardRequest {
  cards?: DashboardCard[];
  ranges?: Partial<Record<PeriodCard, Range>>;
}

export async function buildDashboard(db: D1Database, today: string, request: DashboardRequest = {}): Promise<DashboardData> {
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const wanted = new Set<DashboardCard>(request.cards ?? DASHBOARD_CARDS);
  const range = (card: PeriodCard) => request.ranges?.[card] ?? defaultRange(card, today);

  const [legalMode, demands] = await Promise.all([legalModeOn(db, today), openDemands(db)]);
  const needsItems = wanted.has('overdue') || wanted.has('aging');

  const [ceiling, turnover, external, openRequests, items] = await Promise.all([
    ceilingFor(db, today),
    turnoverIls(db, yearStart, yearEnd),
    uploadService.externalTurnoverIls(db, yearStart, yearEnd),
    openRequestsIls(db, demands, yearStart, yearEnd, today),
    needsItems ? openItems(db, today, demands) : Promise.resolve([] as OpenItem[]),
  ]);

  const cards: DashboardCards = {};
  const jobs: Promise<void>[] = [];
  const job = (card: DashboardCard, run: () => Promise<void>) => {
    if (wanted.has(card)) jobs.push(run());
  };

  job('overdue', async () => {
    const overdueRequestItems = items.filter((i) => PAYMENT_REQUEST_TYPES.includes(i.type) && i.dueDate !== null && i.dueDate < today);
    const proformaItems = items.filter((i) => PROFORMA_TYPES.includes(i.type));
    cards.overdue = {
      items: [...overdueRequestItems, ...proformaItems].sort((a, b) => b.daysOverdue - a.daysOverdue),
      overdueRequests: totalsByCurrency(overdueRequestItems),
      openProformas: totalsByCurrency(proformaItems),
    };
  });
  job('cashFlow', async () => {
    const r = range('cashFlow');
    cards.cashFlow = { ...r, months: await cashFlowByMonth(db, r.from, r.to) };
  });
  job('profitLoss', async () => {
    const r = range('profitLoss');
    cards.profitLoss = { ...r, months: await profitLossByMonth(db, r.from, r.to) };
  });
  job('incomeByMonth', async () => {
    const r = range('incomeByMonth');
    const months = await incomeByMonth(db, r.from, r.to);
    cards.incomeByMonth = {
      ...r,
      months,
      totalIlsMinor: months.reduce((s, m) => s + m.totalIlsMinor, 0),
      importedIlsMinor: months.reduce((s, m) => s + m.importedIlsMinor, 0),
    };
  });
  job('topClients', async () => {
    const r = range('topClients');
    cards.topClients = { ...r, ...(await incomeByClient(db, r.from, r.to, TOP_LIMIT)) };
  });
  job('topServices', async () => {
    const r = range('topServices');
    cards.topServices = { ...r, ...(await incomeByService(db, r.from, r.to, TOP_LIMIT)) };
  });
  job('expenseCategories', async () => {
    const r = range('expenseCategories');
    cards.expenseCategories = { ...r, ...(await expensesByCategory(db, r.from, r.to, TOP_LIMIT)) };
  });
  job('yearComparison', async () => {
    cards.yearComparison = await yearComparison(db, today);
  });
  job('aging', async () => {
    cards.aging = { buckets: agingSummary(items) };
  });
  await Promise.all(jobs);

  return {
    today,
    overdueRequests: overdueRequests(demands, today),
    ceiling: ceiling
      ? { year: ceiling.year, currency: ceiling.currency, limitMinor: ceiling.amount_minor, currentMinor: turnover + external + openRequests }
      : null,
    // VAT reporting belongs to עוסק מורשה. עוסק פטור owes no VAT, so the card reads zero and not applicable.
    vatDue: { applicable: legalMode.mode === 'murshe', amountMinor: 0, currency: 'ILS' },
    // Live token status ships in R12.
    ita: {
      connected: false,
      message: legalMode.mode === 'murshe' ? 'Not connected yet.' : 'Connects after the switch to עוסק מורשה.',
    },
    cards,
  };
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

const isCard = (v: string): v is DashboardCard => (DASHBOARD_CARDS as readonly string[]).includes(v);

/** Parses `cards=a,b` and `<card>=from..to`. Unknown card ids are a validation error. */
export function parseDashboardQuery(query: Record<string, string | undefined>): DashboardRequest {
  const request: DashboardRequest = {};
  if (query.cards !== undefined && query.cards !== '') {
    const ids = query.cards.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = ids.filter((id) => !isCard(id));
    if (unknown.length > 0) throw new ValidationError(`Unknown dashboard card: ${unknown.join(', ')}.`);
    request.cards = ids as DashboardCard[];
  }
  for (const card of PERIOD_CARDS) {
    const raw = query[card];
    if (!raw) continue;
    const [from, to] = raw.split('..');
    if (!from || !to) throw new ValidationError(`${card} must be YYYY-MM-DD..YYYY-MM-DD.`);
    assertDate(from, `${card} from`);
    assertDate(to, `${card} to`);
    if (from > to) throw new ValidationError(`${card}: "from" must not be after "to".`);
    request.ranges = { ...request.ranges, [card]: { from, to } };
  }
  return request;
}

// ---------------------------------------------------------------------------
// Layout setting
// ---------------------------------------------------------------------------

export const DASHBOARD_LAYOUT_KEY = 'dashboard_layout';

export interface LayoutEntry {
  id: DashboardCard;
  visible: boolean;
}

const layoutSchema = z.object({
  cards: z
    .array(z.object({ id: z.enum(DASHBOARD_CARDS), visible: z.boolean() }))
    .max(DASHBOARD_CARDS.length)
    .refine((cards) => new Set(cards.map((c) => c.id)).size === cards.length, 'Each card may appear once.'),
});

/** Stored order first, then any card the stored value does not know yet, visible, in default order. */
export function normalizeLayout(stored: LayoutEntry[] | null): LayoutEntry[] {
  const out: LayoutEntry[] = [];
  const seen = new Set<string>();
  for (const e of stored ?? []) {
    if (!isCard(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, visible: e.visible !== false });
  }
  for (const id of DASHBOARD_CARDS) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

export async function getDashboardLayout(db: D1Database): Promise<LayoutEntry[]> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', DASHBOARD_LAYOUT_KEY);
  if (!row) return normalizeLayout(null);
  try {
    const parsed = layoutSchema.safeParse({ cards: JSON.parse(row.value) });
    return normalizeLayout(parsed.success ? parsed.data.cards : null);
  } catch {
    return normalizeLayout(null);
  }
}

export interface DashboardModuleOptions {
  /** Business date. Default: today in Israel. */
  today?: () => string;
}

export function createDashboardModule(options: DashboardModuleOptions = {}): ModuleDef {
  const today = options.today ?? (() => todayIsrael());
  const routes = new Hono<AppEnv>();
  // Without `cards`, the stored layout picks the visible cards and rides along in the answer,
  // so the page renders from this one call.
  routes.get('/', requireFeature('reports'), async (c) => {
    const request = parseDashboardQuery(c.req.query());
    if (request.cards) return c.json(await buildDashboard(c.env.DB, today(), request));
    const layout = await getDashboardLayout(c.env.DB);
    const cards = layout.filter((e) => e.visible).map((e) => e.id);
    return c.json({ ...(await buildDashboard(c.env.DB, today(), { ...request, cards })), layout });
  });
  routes.get('/layout', requireFeature('reports'), async (c) => {
    return c.json({ cards: await getDashboardLayout(c.env.DB) });
  });
  // Settings > Dashboard. Owner only, like every other setting.
  routes.put('/layout', requireRole('owner'), async (c) => {
    const body = await c.req.json().catch(() => {
      throw new ValidationError('The request body is not valid JSON.');
    });
    const parsed = layoutSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid dashboard layout.');
    const cards = normalizeLayout(parsed.data.cards);
    await transaction(c.env.DB, [
      stmt(
        c.env.DB,
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        DASHBOARD_LAYOUT_KEY,
        JSON.stringify(cards),
        nowIso(),
      ),
      auditStatement(c.env.DB, actorFrom(c), 'dashboard.layout_set', 'settings', DASHBOARD_LAYOUT_KEY, { cards }),
    ]);
    return c.json({ cards });
  });
  return { name: 'dashboard', basePath: '/dashboard', routes };
}

export const dashboardModule = createDashboardModule();
