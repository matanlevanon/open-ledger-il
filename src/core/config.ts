import { all, assertDate, first } from './db';
import { ConfigError } from './errors';

/**
 * Effective-dated legal configuration (CLAUDE.md rule 4). For a given date the row with the
 * latest effective_from on or before that date applies. Nothing here hard-codes a rate,
 * a threshold, a ceiling or a switch date.
 */

export type LegalMode = 'patur' | 'murshe';

export interface LegalModeRow {
  id: number;
  mode: LegalMode;
  effective_from: string;
  confirmed_at: string | null;
}

export interface VatRateRow {
  id: number;
  rate_bp: number;
  effective_from: string;
}

export interface ThresholdRow {
  id: number;
  key: string;
  amount_minor: number;
  currency: string;
  effective_from: string;
}

export interface CeilingRow {
  id: number;
  year: number;
  amount_minor: number;
  currency: string;
}

export const THRESHOLD_KEYS = ['allocation'] as const;
export type ThresholdKey = (typeof THRESHOLD_KEYS)[number] | (string & {});

export async function legalModeOn(db: D1Database, date: string): Promise<LegalModeRow> {
  assertDate(date);
  const row = await first<LegalModeRow>(
    db,
    'SELECT id, mode, effective_from, confirmed_at FROM legal_modes WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
    date,
  );
  if (!row) throw new ConfigError(`No legal mode is set for ${date}.`);
  return row;
}

export async function vatRateOn(db: D1Database, date: string): Promise<VatRateRow> {
  assertDate(date);
  const row = await first<VatRateRow>(
    db,
    'SELECT id, rate_bp, effective_from FROM vat_rates WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
    date,
  );
  if (!row) throw new ConfigError(`No VAT rate is set for ${date}.`);
  return row;
}

/** The threshold in force on a date, or null when none applies yet. */
export async function thresholdOn(db: D1Database, key: ThresholdKey, date: string): Promise<ThresholdRow | null> {
  assertDate(date);
  return first<ThresholdRow>(
    db,
    `SELECT id, key, amount_minor, currency, effective_from FROM thresholds
     WHERE key = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`,
    key,
    date,
  );
}

/** The ceiling of the calendar year that holds the date, or null when that year has no row yet. */
export async function ceilingFor(db: D1Database, date: string): Promise<CeilingRow | null> {
  assertDate(date);
  const year = Number(date.slice(0, 4));
  return first<CeilingRow>(db, 'SELECT id, year, amount_minor, currency FROM ceilings WHERE year = ?', year);
}

export interface ConfigSnapshot {
  date: string;
  legalMode: LegalModeRow;
  vatRate: VatRateRow;
  thresholds: Record<string, ThresholdRow>;
  ceiling: CeilingRow | null;
}

/** Everything in force on one date, in one object. */
export async function configOn(db: D1Database, date: string): Promise<ConfigSnapshot> {
  const [legalMode, vatRate, ceiling, thresholdRows] = await Promise.all([
    legalModeOn(db, date),
    vatRateOn(db, date),
    ceilingFor(db, date),
    all<ThresholdRow>(
      db,
      `SELECT t.id, t.key, t.amount_minor, t.currency, t.effective_from FROM thresholds t
       WHERE t.effective_from = (
         SELECT MAX(effective_from) FROM thresholds WHERE key = t.key AND effective_from <= ?
       )`,
      date,
    ),
  ]);
  const thresholds: Record<string, ThresholdRow> = {};
  for (const t of thresholdRows) thresholds[t.key] = t;
  return { date, legalMode, vatRate, thresholds, ceiling };
}
