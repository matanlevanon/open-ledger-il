import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom, audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { all, first, run } from '../../core/db';
import { thresholdOn } from '../../core/config';
import type { AppEnv } from '../../env';
import { supplierConfirmationNumber, supplierInvoiceDetails } from './buyer';
import { type ItaEnv, ITA_SERVICE_PAGE_URL, ITA_WEB_APP_URL } from './config';
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

  // Every ITA route is owner only: 'ita' is an owner-only feature (src/core/auth.ts).
  app.use('*', requireFeature('ita'));

  app.get('/status', async (c) => {
    const status = await service(c).tokens.status();
    return c.json({ connection: { ...status, banner: status.connected && (status.days_since_login ?? 0) >= RELOGIN_BANNER_DAY } });
  });

  /** Renews the login now, the same way the daily check does, so a fix can be tested at once. */
  app.post('/refresh', async (c) => {
    const s = service(c);
    try {
      await s.tokens.refresh();
      await audit(c, 'ita.refresh.manual', 'ita', s.tokens.environment);
      return c.json({ ok: true });
    } catch (err) {
      const row = await first<{ status_reason: string | null }>(
        c.env.DB,
        'SELECT status_reason FROM ita_tokens WHERE environment = ?',
        s.tokens.environment,
      );
      const reason = row?.status_reason ?? (err instanceof Error ? err.message : 'The renewal failed.');
      await audit(c, 'ita.refresh.failed', 'ita', s.tokens.environment, { reason });
      return c.json({ ok: false, reason });
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
      await audit(c, 'ita.connect.failed', 'ita', s.tokens.environment, { reason: 'exchange' });
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
          payment_amount_minor: d.paymentAmountMinor,
          vat_amount_minor: d.vatAmountMinor,
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
