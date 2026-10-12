import { all, first } from '../../core/db';
import { convert } from '../../core/money';
import type { Env } from '../../env';

/**
 * R24 Phase A: the business type. Every read of `entity_type` goes through this file, so Phase B
 * moves it from business_profile to businesses in one place.
 */
export const ENTITY_TYPES = ['osek_patur', 'osek_murshe', 'company'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const VAT_REPORTING = ['monthly', 'bimonthly'] as const;
export type VatReporting = (typeof VAT_REPORTING)[number];

/** legal_modes.note on the `registered` switch: the business was מורשה before the Ledger. */
export const REGISTERED_NOTE = 'already registered';

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

export async function getEntityType(db: D1Database): Promise<EntityType> {
  const row = await first<{ entity_type: string }>(db, 'SELECT entity_type FROM business_profile WHERE id = 1');
  return isEntityType(row?.entity_type) ? row.entity_type : 'osek_patur';
}

export async function getVatReporting(db: D1Database): Promise<VatReporting> {
  const row = await first<{ vat_reporting: string }>(db, 'SELECT vat_reporting FROM business_profile WHERE id = 1');
  return row?.vat_reporting === 'monthly' ? 'monthly' : 'bimonthly';
}

/** A fresh Ledger has no final document yet. `registered` and start-company need one. */
export async function isFreshLedger(db: D1Database): Promise<boolean> {
  return !(await first<{ seq: number }>(db, 'SELECT seq FROM finalizations LIMIT 1'));
}

/** The מורשה row, when the Ledger has switched. */
export async function mursheRow(db: D1Database): Promise<{ effective_from: string; note: string | null } | null> {
  return first(db, "SELECT effective_from, note FROM legal_modes WHERE mode = 'murshe' ORDER BY effective_from LIMIT 1");
}

/** Setup is incomplete while a required business field is empty. Same fields as the first-run setup screen. */
export async function setupIncomplete(db: D1Database): Promise<boolean> {
  const row = await first<Record<string, string | null>>(db, 'SELECT name_en, name_he, tax_id, address_en FROM business_profile WHERE id = 1');
  return ['name_en', 'name_he', 'tax_id', 'address_en'].some((f) => !row?.[f]?.trim());
}

/**
 * The installer's preselection for the first-run Business type step. Read only while setup is
 * incomplete and the Ledger is still פטור. After that it is ignored. Never written to the database.
 */
export async function setupBusinessType(env: Env): Promise<EntityType | null> {
  const wanted = env.SETUP_BUSINESS_TYPE?.trim();
  if (!isEntityType(wanted)) return null;
  if (!(await setupIncomplete(env.DB))) return null;
  if ((await getEntityType(env.DB)) !== 'osek_patur') return null;
  return wanted;
}

/**
 * The ceiling card shows for עוסק פטור, and for an עוסק מורשה in the calendar year it switched
 * from פטור. A company, or a business registered as מורשה before the Ledger, never sees it.
 */
export function showsCeiling(entityType: EntityType, murshe: { effective_from: string; note: string | null } | null, today: string): boolean {
  if (entityType === 'osek_patur') return true;
  if (entityType === 'company' || !murshe || murshe.note === REGISTERED_NOTE) return false;
  return murshe.effective_from.slice(0, 4) === today.slice(0, 4);
}

export interface BusinessTypeStatus {
  entityType: EntityType;
  fresh: boolean;
  switchedOn: string | null;
  vatReporting: VatReporting;
  showCeiling: boolean;
  setupBusinessType: EntityType | null;
}

export async function businessTypeStatus(env: Env, today: string): Promise<BusinessTypeStatus> {
  const [entityType, fresh, murshe, vatReporting, setup] = await Promise.all([
    getEntityType(env.DB),
    isFreshLedger(env.DB),
    mursheRow(env.DB),
    getVatReporting(env.DB),
    setupBusinessType(env),
  ]);
  return {
    entityType,
    fresh,
    switchedOn: murshe?.effective_from ?? null,
    vatReporting,
    showCeiling: showsCeiling(entityType, murshe, today),
    setupBusinessType: setup,
  };
}

// ---------------------------------------------------------------------------
// VAT due for the current reporting period (dashboard VAT card)
// ---------------------------------------------------------------------------

/** Tax documents that carry output VAT. A credit note (330) is stored negative, so it subtracts. */
const OUTPUT_VAT_TYPES = ['305', '320', '330'];

export interface VatPeriod {
  from: string;
  to: string;
  reportDue: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The reporting period that holds `today`, and its report date. Bi-monthly periods start in odd months. */
export function vatPeriodOn(today: string, reporting: VatReporting, dueDay: number): VatPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startMonth = reporting === 'monthly' ? month : month - ((month - 1) % 2);
  const endMonth = reporting === 'monthly' ? month : startMonth + 1;
  const dueYear = endMonth === 12 ? year + 1 : year;
  const dueMonth = endMonth === 12 ? 1 : endMonth + 1;
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`,
    reportDue: `${dueYear}-${pad(dueMonth)}-${pad(dueDay)}`,
  };
}

/** The report due day in force on a date. Dated config, CLAUDE.md rule 4. */
export async function vatReportDueDayOn(db: D1Database, date: string): Promise<number> {
  const row = await first<{ due_day: number }>(
    db,
    'SELECT due_day FROM vat_report_due_days WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
    date,
  );
  if (!row) throw new Error(`No VAT report due day is set for ${date}.`);
  return row.due_day;
}

const toIls = (amountMinor: number, currency: string, rate: string | null): number =>
  currency === 'ILS' ? amountMinor : rate ? convert(amountMinor, rate) : 0;

/**
 * Output VAT of final tax documents in the period minus reclaimable input VAT of expenses dated
 * in it, in ILS minor units. A foreign amount converts at the rate stored on its row.
 */
export async function vatDueIn(db: D1Database, period: { from: string; to: string }): Promise<{ outputMinor: number; inputMinor: number; amountMinor: number }> {
  const [docs, expenses] = await Promise.all([
    all<{ vat_amount_minor: number; currency: string; fx_rate: string | null }>(
      db,
      `SELECT vat_amount_minor, currency, fx_rate FROM documents
        WHERE status = 'final' AND type IN (${OUTPUT_VAT_TYPES.map(() => '?').join(',')}) AND date BETWEEN ? AND ?`,
      ...OUTPUT_VAT_TYPES,
      period.from,
      period.to,
    ),
    all<{ vat_amount_minor: number; currency: string; fx_rate: string | null }>(
      db,
      `SELECT vat_amount_minor, currency, fx_rate FROM expenses
        WHERE input_vat_reclaimable = 1 AND status NOT IN ('not_expense', 'duplicate', 'returned')
          AND document_date BETWEEN ? AND ?`,
      period.from,
      period.to,
    ),
  ]);
  const outputMinor = docs.reduce((s, d) => s + toIls(d.vat_amount_minor, d.currency, d.fx_rate), 0);
  const inputMinor = expenses.reduce((s, e) => s + toIls(e.vat_amount_minor, e.currency, e.fx_rate), 0);
  return { outputMinor, inputMinor, amountMinor: outputMinor - inputMinor };
}
