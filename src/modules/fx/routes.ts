import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { todayIsrael } from '../../core/db';
import { type Currency, isCurrency } from '../../core/money';
import type { AppEnv } from '../../env';
import type { FxHistoryProvider, FxProvider } from './provider';
import { backfillRates, fetchAndCache, rateOn, recentRates } from './rates';

const currencySchema = z.custom<Currency>((v) => isCurrency(v), { message: 'Unsupported currency.' });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export interface FxRouteDeps {
  /** Latest published rate, for the manual refresh. */
  current: () => FxProvider;
  /** Bank of Israel series, for backfill of past dates. */
  history: () => FxHistoryProvider;
}

export function createFxRoutes(deps: FxRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Owner only: exchange rates are settings-level, not a day-to-day accountant task.
  routes.use('*', requireFeature('settings'));

  routes.get('/rate', async (c) => {
    const currency = currencySchema.parse(c.req.query('currency'));
    const date = dateSchema.optional().parse(c.req.query('date')) ?? todayIsrael();
    const rate = await rateOn(c.env.DB, currency, date, { history: deps.history() });
    return c.json({ rate });
  });

  routes.get('/rates', async (c) => {
    const currency = currencySchema.parse(c.req.query('currency'));
    const rates = await recentRates(c.env.DB, currency);
    return c.json({ rates });
  });

  const fetchBodySchema = z.object({ currency: currencySchema });

  routes.post('/rates/fetch', async (c) => {
    const body = fetchBodySchema.parse(await c.req.json().catch(() => ({})));
    const date = todayIsrael();
    const rate = await fetchAndCache(c.env.DB, deps.current(), body.currency, date);
    await audit(c, 'fx.fetch', 'fx_rate', body.currency, { rateDate: rate.rateDate, rate: rate.rate });
    return c.json({ rate });
  });

  const backfillBodySchema = z.object({ currency: currencySchema, from: dateSchema, to: dateSchema.optional() });

  /** Loads Bank of Israel rates for any past range into the cache. */
  routes.post('/rates/backfill', async (c) => {
    const body = backfillBodySchema.parse(await c.req.json().catch(() => ({})));
    const today = todayIsrael();
    const to = body.to && body.to < today ? body.to : today;
    const cached = await backfillRates(c.env.DB, deps.history(), body.currency, body.from, to);
    await audit(c, 'fx.backfill', 'fx_rate', body.currency, { from: body.from, to, cached });
    return c.json({ currency: body.currency, from: body.from, to, cached });
  });

  return routes;
}
