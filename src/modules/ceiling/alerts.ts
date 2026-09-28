import { SYSTEM_ACTOR, auditAs } from '../../core/audit';
import { all, run } from '../../core/db';
import { formatMinor, isCurrency } from '../../core/money';
import type { Notifier } from '../ita/notify';
import { type CeilingMeterResult, ceilingMeter, meterPercent } from './meter';

/** docs/legal-requirements.md, "Ceiling guard": alerts at 70, 85, 95 and projected 100 percent. */
export const CEILING_ALERT_THRESHOLDS = [70, 85, 95, 100] as const;
export type CeilingAlertThreshold = (typeof CEILING_ALERT_THRESHOLDS)[number];

export interface FiredCeilingAlert {
  thresholdPct: CeilingAlertThreshold;
  year: number;
  turnoverMinor: number;
  limitMinor: number;
}

function alertText(meter: CeilingMeterResult, thresholdPct: CeilingAlertThreshold): string {
  const currency = isCurrency(meter.currency) ? meter.currency : 'ILS';
  const current = formatMinor(meter.currentMinor, currency);
  const limit = formatMinor(meter.limitMinor, currency);
  if (thresholdPct >= 100) {
    return `:rotating_light: Open Ledger IL: turnover plus open requests (${current}) has passed the ${meter.year} עוסק פטור ceiling of ${limit}. The next crossing receipt will be blocked.`;
  }
  return `:warning: Open Ledger IL: turnover plus open requests has reached ${thresholdPct}% of the ${meter.year} עוסק פטור ceiling (${current} of ${limit}).`;
}

/**
 * Fires any newly-crossed threshold for the meter's year, once per (year, threshold) ever
 * (`ceiling_alerts` unique index guards a race between two concurrent calls). A no-op once the
 * legal mode has switched to מורשה, since the פטור ceiling no longer applies.
 */
export async function evaluateCeilingAlerts(db: D1Database, date: string, notifier: Notifier): Promise<FiredCeilingAlert[]> {
  const meter = await ceilingMeter(db, date);
  if (!meter || meter.legalMode !== 'patur') return [];
  const pct = meterPercent(meter);

  const already = await all<{ threshold_pct: number }>(db, 'SELECT threshold_pct FROM ceiling_alerts WHERE year = ?', meter.year);
  const firedAlready = new Set(already.map((r) => r.threshold_pct));

  const fired: FiredCeilingAlert[] = [];
  for (const thresholdPct of CEILING_ALERT_THRESHOLDS) {
    if (pct < thresholdPct || firedAlready.has(thresholdPct)) continue;
    const { changes } = await run(
      db,
      'INSERT OR IGNORE INTO ceiling_alerts (year, threshold_pct, turnover_minor, limit_minor) VALUES (?, ?, ?, ?)',
      meter.year,
      thresholdPct,
      meter.currentMinor,
      meter.limitMinor,
    );
    // changes === 0 means another concurrent call already recorded this exact threshold.
    if (changes === 0) continue;
    await notifier.send(alertText(meter, thresholdPct));
    // docs/legal-requirements.md, "Ceiling guard", point 5: "every alert, block and decision writes to audit_log".
    await auditAs(db, SYSTEM_ACTOR, 'ceiling.alert', 'ceiling_alert', `${meter.year}:${thresholdPct}`, {
      thresholdPct,
      year: meter.year,
      turnoverMinor: meter.currentMinor,
      limitMinor: meter.limitMinor,
    });
    fired.push({ thresholdPct, year: meter.year, turnoverMinor: meter.currentMinor, limitMinor: meter.limitMinor });
  }
  return fired;
}
