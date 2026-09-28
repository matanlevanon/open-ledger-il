import { ceilingFor, legalModeOn } from '../../core/config';
import { openDemands } from '../documents/balances';
import { openRequestsIls, turnoverIls } from '../dashboard';
import { uploadService } from '../import';

/**
 * The עוסק פטור ceiling meter (docs/legal-requirements.md, "Ceiling guard": "turnover to date
 * plus open payment requests, against the year's ceiling"). Reuses R05's dashboard math so the
 * dashboard card and this module never compute the number two different ways.
 */
export interface CeilingMeterResult {
  year: number;
  currency: string;
  limitMinor: number;
  turnoverMinor: number;
  openRequestsMinor: number;
  /** turnoverMinor + openRequestsMinor, the figure the 70/85/95/100 percent alerts watch. */
  currentMinor: number;
  legalMode: 'patur' | 'murshe';
}

/** Null when the year has no ceiling row yet (Settings, not seeded automatically). */
export async function ceilingMeter(db: D1Database, date: string): Promise<CeilingMeterResult | null> {
  const year = Number(date.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [ceiling, legalMode, demands] = await Promise.all([ceilingFor(db, date), legalModeOn(db, date), openDemands(db)]);
  if (!ceiling) return null;

  const [issuedTurnoverMinor, externalMinor, openRequestsMinor] = await Promise.all([
    turnoverIls(db, yearStart, yearEnd),
    uploadService.externalTurnoverIls(db, yearStart, yearEnd),
    openRequestsIls(db, demands, yearStart, yearEnd, date),
  ]);
  // R17 task 7: a document uploaded from another system already counts toward the year's
  // turnover, the same as one Open Ledger IL itself issued.
  const turnoverMinor = issuedTurnoverMinor + externalMinor;

  return {
    year,
    currency: ceiling.currency,
    limitMinor: ceiling.amount_minor,
    turnoverMinor,
    openRequestsMinor,
    currentMinor: turnoverMinor + openRequestsMinor,
    legalMode: legalMode.mode,
  };
}

/** Percent of the ceiling the meter reads, as a plain number (not rounded). 0 when the ceiling is 0. */
export function meterPercent(meter: Pick<CeilingMeterResult, 'currentMinor' | 'limitMinor'>): number {
  if (meter.limitMinor <= 0) return 0;
  return (meter.currentMinor / meter.limitMinor) * 100;
}
