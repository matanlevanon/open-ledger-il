import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom, audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { all, first, run } from '../../core/db';
import { thresholdOn } from '../../core/config';
import type { AppEnv } from '../../env';
import { supplierConfirmationNumber, supplierInvoiceDetails } from './buyer';
import { type ItaEnv, ITA_SCOPE, ITA_SERVICE_PAGE_URL, ITA_URLS, ITA_WEB_APP_URL, itaCredentials, itaManualMode, relayedFetch } from './config';
import { randomToken } from './crypto';
import { allocationGate } from './gate';
import { RELOGIN_BANNER_DAY } from './jobs';
import { type ItaDeps, ItaAllocationService, REFUSAL_CHOICES, type RefusalChoice } from './service';

/** Tax invoice types that need an allocation number above the threshold (spec table 2.5). 332 only on request. */
export const ALLOCATION_DOC_TYPES = ['305', '310', '320', '340', '345'] as const;

const STATE_TTL_MS = 10 * 60_000;

const decisionSchema = z.object({ choice: z.enum(REFUSAL_CHOICES as [RefusalChoice, ...RefusalChoice[]]) });
const manualSchema = z.object({
  confirmation_number: z.string().min(9).max(40),
  source_note: z.string().max(500).optional().default(''),
});
const detailsSchema = z.object({ supplier_vat_number: z.string(), confirmation_number: z.string() });
const confirmationSchema = z.object({
  supplier_vat_number: z.string(),
  payment_amount_minor: z.number().int(),
  vat_amount_minor: z.number().int(),
  invoice_date: z.string(),
  invoice_reference_number: z.string().optional(),
});

function documentId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new z.ZodError([{ code: 'custom', path: ['documentId'], message: 'Not a document id.', input: raw }]);
  return id;
}

export function itaRoutes(deps: ItaDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const env = (c: { env: AppEnv['Bindings'] }) => c.env as ItaEnv;
  const service = (c: { env: AppEnv['Bindings'] }) => new ItaAllocationService(env(c), deps);
  // Where the Tax Authority calls leave from: the relay, or this Worker's data center.
  const origin = (e: ItaEnv, raw: Request) =>
    (e.ITA_RELAY_URL ?? '').trim() ? 'relay' : `worker ${(raw as { cf?: { colo?: string } }).cf?.colo ?? 'unknown'}`;

  // Every ITA route is owner only: 'ita' is an owner-only feature (src/core/auth.ts).
  app.use('*', requireFeature('ita'));

  app.get('/status', async (c) => {
    const status = await service(c).tokens.status();
    return c.json({ connection: { ...status, banner: status.connected && (status.days_since_login ?? 0) >= RELOGIN_BANNER_DAY } });
  });

  /**
   * Route check without spending a login. Sends a deliberately invalid refresh request to the
   * ITA token address directly from this Worker and, when ITA_RELAY_URL is set, through the relay.
   * A JSON OAuth error means the call reached the ITA. A bare 403 means it was turned
   * away before that, by where it came from. No real token is sent.
   */
  app.get('/route-check', async (c) => {
    const e = env(c);
    const s = service(c);
    const tokenUrl = ITA_URLS[s.tokens.environment].token;
    let auth = '';
    try {
      const { clientId, clientSecret } = itaCredentials(e);
      auth = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
    } catch {
      // No client credentials yet: the check still shows whether the address is reachable.
    }
    const probe = async (doFetch: typeof fetch) => {
      try {
        const res = await doFetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'route-check', scope: ITA_SCOPE }).toString(),
          signal: AbortSignal.timeout(20_000),
        });
        const text = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
        let reached = false;
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          reached = typeof j.error === 'string' || typeof j.httpCode === 'string' || typeof j.moreInformation === 'string';
        } catch {
          reached = false;
        }
        return { status: res.status, reached, reply: text };
      } catch (err) {
        return { status: 0, reached: false, reply: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'error' };
      }
    };
    const result = {
      environment: s.tokens.environment,
      direct: { from: (c.req.raw as { cf?: { colo?: string } }).cf?.colo ?? null, ...(await probe(deps.fetch)) },
      relay: (e.ITA_RELAY_URL ?? '').trim()
        ? {
            from: 'relay',
            ...(await (async () => {
              try {
                return await probe(relayedFetch(e, deps.fetch));
              } catch (err) {
                return { status: 0, reached: false, reply: err instanceof Error ? err.message : 'error' };
              }
            })()),
          }
        : null,
    };
    await audit(c, 'ita.route.check', 'ita', s.tokens.environment, result);
    return c.json(result);
  });

  /** Renews the short-lived access token now, the same renewal an allocation call triggers on its own. */
  app.post('/refresh', async (c) => {
    const s = service(c);
    const where = origin(env(c), c.req.raw);
    try {
      await s.tokens.refresh();
      await audit(c, 'ita.refresh.manual', 'ita', s.tokens.environment, { from: where });
      return c.json({ ok: true, from: where });
    } catch (err) {
      const row = await first<{ status_reason: string | null }>(
        c.env.DB,
        'SELECT status_reason FROM ita_tokens WHERE environment = ?',
        s.tokens.environment,
      );
      const reason = row?.status_reason ?? (err instanceof Error ? err.message : 'The renewal failed.');
      await audit(c, 'ita.refresh.failed', 'ita', s.tokens.environment, { reason, from: where });
      return c.json({ ok: false, reason, from: where });
    }
  });

  /** Starts the ITA login. The browser follows the redirect to the ITA. */
  app.get('/connect', async (c) => {
    const s = service(c);
    const state = randomToken();
    const redirectUri = `${new URL(c.req.url).origin}/api/ita/callback`;
    const url = s.tokens.authorizeUrl(state, redirectUri);
    await run(
      c.env.DB,
      'INSERT INTO ita_oauth_states (state, environment, redirect_uri, user_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      state,
      s.tokens.environment,
      redirectUri,
      c.get('user').id,
      new Date(deps.now().getTime() + STATE_TTL_MS).toISOString(),
    );
    await audit(c, 'ita.connect.start', 'ita', s.tokens.environment);
    return c.redirect(url, 302);
  });

  /** The ITA sends the browser back here with a one-time code. */
  app.get('/callback', async (c) => {
    const s = service(c);
    const state = c.req.query('state') ?? '';
    const code = c.req.query('code') ?? '';
    const back = (result: string) => c.redirect(`/ita?${result}`, 302);
    const saved = await first<{ environment: string; redirect_uri: string; expires_at: string }>(
      c.env.DB,
      'SELECT environment, redirect_uri, expires_at FROM ita_oauth_states WHERE state = ?',
      state,
    );
    if (saved) await run(c.env.DB, 'DELETE FROM ita_oauth_states WHERE state = ?', state);
    if (!saved || saved.expires_at < deps.now().toISOString() || saved.environment !== s.tokens.environment) {
      await audit(c, 'ita.connect.failed', 'ita', s.tokens.environment, { reason: 'state' });
      return back('error=state');
    }
    if (c.req.query('error') || !code) {
      await audit(c, 'ita.connect.failed', 'ita', s.tokens.environment, { reason: 'denied' });
      return back('error=denied');
    }
    try {
      await s.tokens.exchangeCode(code, saved.redirect_uri, c.get('user').id);
    } catch (err) {
      const from = origin(env(c), c.req.raw);
      await audit(c, 'ita.connect.failed', 'ita', s.tokens.environment, {
        reason: 'exchange',
        detail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        from,
      });
      if (err instanceof Error && 'code' in err && typeof err.code === 'string') return back(`error=${encodeURIComponent(err.code)}`);
      throw err;
    }
    await audit(c, 'ita.connect.done', 'ita', s.tokens.environment);
    return back('connected=1');
  });

  /** Everything the ITA screen shows. */
  app.get('/overview', async (c) => {
    const s = service(c);
    const status = await s.tokens.status();
    const rows = await all<Record<string, unknown> & { document_id: number; status: string }>(
      c.env.DB,
      `SELECT document_id, invoice_id, status, attempts, first_attempt_at, last_attempt_at, next_attempt_at, deadline_at,
              last_error_code, last_error_message, decision, decision_at, replacement_document_id, source
       FROM ita_allocations WHERE environment = ? AND status IN ('pending', 'stalled', 'failed', 'refused', 'decided')
       ORDER BY updated_at DESC LIMIT 200`,
      s.tokens.environment,
    );
    const withDoc = async (r: (typeof rows)[number]) => {
      const d = await s.docs.get(r.document_id);
      return {
        ...r,
        document: d && {
          id: d.id,
          type: d.type,
          number: d.number,
          status: d.status,
          date: d.date,
          customer_name: d.customerName,
          customer_vat_number: d.customerVatNumber || null,
          payment_amount_minor: d.paymentAmountMinor,
          vat_amount_minor: d.vatAmountMinor,
          total_minor: d.totalMinor,
        },
      };
    };
    const queue = await Promise.all(rows.filter((r) => ['pending', 'stalled', 'failed'].includes(r.status)).map(withDoc));
    const refused = await Promise.all(
      rows.filter((r) => r.status === 'refused' || (r.status === 'decided' && r.decision === 'further_objection')).map(withDoc),
    );

    // Tax invoices above the threshold with VAT to an Israeli client and still no number.
    const candidates = await all<{
      id: number;
      type: string;
      number: number | null;
      status: string;
      date: string;
      subtotal_minor: number;
      vat_amount_minor: number;
      client_name: string | null;
      decision: string | null;
      allocation_status: string | null;
    }>(
      c.env.DB,
      `SELECT d.id, d.type, d.number, d.status, d.date, d.subtotal_minor, d.vat_amount_minor,
              COALESCE(NULLIF(cl.name_he, ''), cl.name_en) AS client_name, a.decision, a.status AS allocation_status
       FROM documents d
       LEFT JOIN clients cl ON cl.id = d.client_id
       LEFT JOIN ita_allocations a ON a.document_id = d.id
       WHERE d.allocation_number IS NULL AND d.status NOT IN ('draft', 'cancelled') AND d.vat_amount_minor > 0
         AND COALESCE(cl.foreign_resident, 0) = 0
         AND (d.type IN (${ALLOCATION_DOC_TYPES.map(() => '?').join(', ')}) OR a.id IS NOT NULL)
       ORDER BY d.date DESC LIMIT 500`,
      ...ALLOCATION_DOC_TYPES,
    );
    const withoutNumbers = [];
    for (const d of candidates) {
      const threshold = await thresholdOn(c.env.DB, 'allocation', d.date);
      if (threshold && d.subtotal_minor > threshold.amount_minor) withoutNumbers.push(d);
    }

    return c.json({
      connection: { ...status, banner: status.connected && (status.days_since_login ?? 0) >= RELOGIN_BANNER_DAY },
      queue,
      refused,
      without_numbers: withoutNumbers,
      links: { web_app: ITA_WEB_APP_URL, hearing: ITA_SERVICE_PAGE_URL },
      mode: itaManualMode(env(c)) ? 'manual' : 'api',
      business_vat_number: ((env(c).ITA_VAT_NUMBER ?? env(c).OWNER_TAX_ID) || '').trim() || null,
    });
  });

  app.get('/allocations/:documentId', async (c) => {
    const id = documentId(c.req.param('documentId'));
    const s = service(c);
    const row = await s.row(id);
    const attempts = row
      ? await all(c.env.DB, 'SELECT at, endpoint, http_status, outcome, error_code, message FROM ita_allocation_attempts WHERE allocation_id = ? ORDER BY id', row.id)
      : [];
    return c.json({ allocation: row, attempts, gate: await allocationGate(c.env.DB, id) });
  });

  /** Request now, or retry after an outage, a fixed client VAT number or a won hearing. */
  app.post('/allocations/:documentId/request', async (c) => {
    const id = documentId(c.req.param('documentId'));
    const result = await service(c).request(id, actorFrom(c));
    return c.json({ result });
  });

  app.post('/allocations/:documentId/decision', async (c) => {
    const id = documentId(c.req.param('documentId'));
    const { choice } = decisionSchema.parse(await c.req.json());
    const result = await service(c).decide(id, choice, actorFrom(c));
    return c.json({ result });
  });

  /** A number from the ITA web app, typed in by hand. The source is recorded. */
  app.post('/allocations/:documentId/manual', async (c) => {
    const id = documentId(c.req.param('documentId'));
    const body = manualSchema.parse(await c.req.json());
    const result = await service(c).enterManual(id, body.confirmation_number, body.source_note, actorFrom(c));
    return c.json({ result });
  });

  app.post('/buyer/details', async (c) => {
    const body = detailsSchema.parse(await c.req.json());
    const result = await supplierInvoiceDetails(env(c), deps, body);
    await audit(c, 'ita.buyer.details', 'supplier', body.supplier_vat_number, { found: result.found });
    return c.json({ result });
  });

  app.post('/buyer/confirmation-number', async (c) => {
    const body = confirmationSchema.parse(await c.req.json());
    const result = await supplierConfirmationNumber(env(c), deps, body);
    await audit(c, 'ita.buyer.confirmation_number', 'supplier', body.supplier_vat_number, { found: result.found });
    return c.json({ result });
  });

  return app;
}
