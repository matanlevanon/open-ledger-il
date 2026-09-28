import { Hono } from 'hono';
import { requireFeature } from '../../core/auth';
import { all, todayIsrael } from '../../core/db';
import type { AppEnv } from '../../env';
import { ceilingMeter, meterPercent } from './meter';

interface CeilingAlertRow {
  year: number;
  threshold_pct: number;
  turnover_minor: number;
  limit_minor: number;
  fired_at: string;
}

/** Routes under /api/ceiling. Both roles read with the `reports` feature (per docs/accountant-access.md). */
export function ceilingRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/meter', requireFeature('reports'), async (c) => {
    const date = c.req.query('date') ?? todayIsrael();
    const meter = await ceilingMeter(c.env.DB, date);
    if (!meter) return c.json({ meter: null });
    return c.json({ meter: { ...meter, percent: meterPercent(meter) } });
  });

  r.get('/alerts', requireFeature('reports'), async (c) => {
    const year = Number(c.req.query('year') ?? todayIsrael().slice(0, 4));
    const alerts = await all<CeilingAlertRow>(
      c.env.DB,
      'SELECT year, threshold_pct, turnover_minor, limit_minor, fired_at FROM ceiling_alerts WHERE year = ? ORDER BY threshold_pct',
      year,
    );
    return c.json({ year, alerts });
  });

  return r;
}
