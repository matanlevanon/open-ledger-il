import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { all, first } from '../../core/db';
import { requireFeature } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv, Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { getDoc } from '../documents/repo';
import { allocationGate } from '../ita';
import { r2Key } from '../pdf';
import { acceptConsent, consentHistory, consentState, requestConsent, revokeConsent } from './consent';
import { declareManualAuth } from '../access/route-guard';
import type { Mailer } from './mailer';
import { MAX_CC, ccListText } from './cc';
import { businessDisplayName, ccSetting, paymentLinkSettings, reminderSettings, setCcSetting, setPaymentLinkSettings, setReminderSettings } from './settings';
import { sendDefaults, sendDocumentEmail } from './send';
import { shareDoc, sharePageHtml, verifyShareCode } from './share-page';
import { verifySendToken } from './tokens';
import { createWhatsAppLink } from './whatsapp';

function idParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Expected a positive integer id.');
  return id;
}

function ip(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? null;
}

function userAgent(c: Context<AppEnv>): string | null {
  return c.req.header('User-Agent')?.slice(0, 300) ?? null;
}

function baseUrl(c: Context<AppEnv>): string {
  return c.env.PUBLIC_APP_URL || new URL(c.req.url).origin;
}

const sendEmailInput = z.object({
  to: z.string().trim().email().nullish(),
  cc: z.array(z.string().trim().email()).max(MAX_CC).nullish(),
  bcc: z.array(z.string().trim().email()).max(MAX_CC).nullish(),
  message: z.string().trim().max(2000).nullish(),
});
const ccSettingInput = z.object({ cc: ccListText });
const reminderSettingsInput = z.object({
  enabled: z.boolean().optional(),
  beforeDays: z.array(z.number().int().min(0)).optional(),
  afterDays: z.array(z.number().int().min(0)).optional(),
});
const paymentLinksInput = z.object({ stripe: z.string().trim().url().or(z.literal('')).nullish(), paypal: z.string().trim().url().or(z.literal('')).nullish() });

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function consentAcceptPage(clientName: string, token: string, businessName: string): string {
  const name = escapeHtml(clientName);
  const safeToken = escapeHtml(token);
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
<h1>Receive documents by email</h1>
<p>${name} can allow ${escapeHtml(businessName)} to send invoices, receipts and other documents by email instead of by post.</p>
<form method="post" action="/api/sending/public/consent/${safeToken}/accept">
<button type="submit" style="padding:10px 16px;font-size:16px">Allow digital documents</button>
</form>
</body></html>`;
}

function consentAcceptedPage(businessName: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
<h1>Thank you</h1>
<p>You can now receive documents by email from ${escapeHtml(businessName)}.</p>
</body></html>`;
}

/** Builds the /sending router. `resolveMailer` reads env at request time (MAIL_API_KEY is a secret). */
export function createSendingRoutes(resolveMailer: (env: Env) => Mailer): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ---------------------------------------------------------------------------
  // Owner routes. Reads use income_documents (accountants can see the log); writes are
  // issue_documents, owner only, matching documents' own /:id/sent and /:id/finalize.
  // ---------------------------------------------------------------------------

  app.post('/documents/:id/send', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    const input = sendEmailInput.parse(await body(c));
    const user = c.get('user');
    const result = await sendDocumentEmail(
      { db: c.env.DB, files: c.env.FILES, env: c.env, mailer: resolveMailer(c.env), baseUrl: baseUrl(c) },
      { documentId: id, actor: { userId: user.id, email: user.email }, to: input.to, cc: input.cc, bcc: input.bcc, message: input.message },
    );
    return c.json(result);
  });

  app.get('/documents/:id/send-defaults', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    return c.json(await sendDefaults(c.env.DB, id));
  });

  app.post('/documents/:id/whatsapp-link', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    const user = c.get('user');
    const result = await createWhatsAppLink(
      { db: c.env.DB, files: c.env.FILES, env: c.env, mailer: resolveMailer(c.env), baseUrl: baseUrl(c) },
      id,
      { userId: user.id, email: user.email },
    );
    return c.json(result);
  });

  app.get('/documents/:id/log', requireFeature('income_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    await getDoc(c.env.DB, id);
    const rows = await all(c.env.DB, 'SELECT * FROM send_log WHERE document_id = ? ORDER BY id DESC', id);
    return c.json({ log: rows });
  });

  app.get('/clients/:id/log', requireFeature('income_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    const rows = await all(c.env.DB, 'SELECT * FROM send_log WHERE client_id = ? ORDER BY id DESC', id);
    return c.json({ log: rows });
  });

  app.get('/clients/:id/consent', requireFeature('income_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    const [state, history] = await Promise.all([consentState(c.env.DB, id), consentHistory(c.env.DB, id)]);
    return c.json({ ...state, history });
  });

  app.post('/clients/:id/consent/request', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    const result = await requestConsent(c.env.DB, c.env, resolveMailer(c.env), id, baseUrl(c));
    return c.json(result);
  });

  app.post('/clients/:id/consent/revoke', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c.req.param('id'));
    await revokeConsent(c.env.DB, id);
    return c.json({ ok: true });
  });

  app.get('/settings', requireFeature('settings'), async (c) => {
    const [reminders, links, cc] = await Promise.all([reminderSettings(c.env.DB), paymentLinkSettings(c.env.DB), ccSetting(c.env.DB)]);
    return c.json({ reminders, paymentLinks: links, cc });
  });

  app.put('/settings/cc', requireFeature('settings'), async (c) => {
    const input = ccSettingInput.parse(await body(c));
    await setCcSetting(c.env.DB, input.cc ?? null);
    return c.json({ cc: await ccSetting(c.env.DB) });
  });

  app.put('/settings/reminders', requireFeature('settings'), async (c) => {
    const input = reminderSettingsInput.parse(await body(c));
    await setReminderSettings(c.env.DB, input);
    return c.json(await reminderSettings(c.env.DB));
  });

  app.put('/settings/payment-links', requireFeature('settings'), async (c) => {
    const input = paymentLinksInput.parse(await body(c));
    await setPaymentLinkSettings(c.env.DB, { stripe: input.stripe ?? undefined, paypal: input.paypal ?? undefined });
    return c.json(await paymentLinkSettings(c.env.DB));
  });

  // ---------------------------------------------------------------------------
  // Public routes. Opened by the client, never by a signed-in app user, so src/index.ts routes
  // requests under /api/sending/public/* around the Cloudflare Access check entirely. The token
  // carries its own signature and expiry (tokens.ts); that is the authorization.
  // ---------------------------------------------------------------------------

  app.get('/public/consent/:token', declareManualAuth('public link, token carries its own signature and expiry'), async (c) => {
    const payload = await verifySendToken(c.env, c.req.param('token'));
    if (payload.kind !== 'consent') throw new NotFoundError('Link');
    const client = await first<{ name_en: string | null; name_he: string | null }>(
      c.env.DB,
      'SELECT name_en, name_he FROM clients WHERE id = ?',
      payload.clientId,
    );
    if (!client) throw new NotFoundError('Client', payload.clientId);
    return c.html(consentAcceptPage(clientDisplayName(client, 'en'), c.req.param('token'), await businessDisplayName(c.env.DB)));
  });

  app.post(
    '/public/consent/:token/accept',
    declareManualAuth('public link, token carries its own signature and expiry'),
    async (c) => {
      const payload = await verifySendToken(c.env, c.req.param('token'));
      if (payload.kind !== 'consent') throw new NotFoundError('Link');
      await acceptConsent(c.env.DB, { clientId: payload.clientId, ip: ip(c), userAgent: userAgent(c) });
      return c.html(consentAcceptedPage(await businessDisplayName(c.env.DB)));
    },
  );

  // The short WhatsApp link: a page with Open Graph tags for the chat preview, the PDF behind it,
  // and the business logo the preview shows.
  app.get('/public/d/:code', declareManualAuth('public link, code carries its own signature and expiry'), async (c) => {
    const documentId = await verifyShareCode(c.env, c.req.param('code'));
    const doc = await shareDoc(c.env.DB, documentId);
    const origin = new URL(c.req.url).origin;
    return c.html(sharePageHtml(doc, `${origin}/api/sending/public/d/${c.req.param('code')}`, origin));
  });

  app.get('/public/d/:code/pdf', declareManualAuth('public link, code carries its own signature and expiry'), async (c) => {
    const documentId = await verifyShareCode(c.env, c.req.param('code'));
    const doc = await shareDoc(c.env.DB, documentId);
    const object = await c.env.FILES.get(doc.pdfKey);
    if (!object) throw new NotFoundError('file', doc.pdfKey);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const name = `${doc.title.replace(/[^\w.-]+/g, '-')}.pdf`;
    headers.set('content-disposition', `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${name}"`);
    return new Response(object.body, { headers });
  });

  app.get('/public/logo', declareManualAuth('public business logo for share link previews'), async (c) => {
    const row = await first<{ logo_r2_key: string | null }>(c.env.DB, 'SELECT logo_r2_key FROM business_profile WHERE id = 1');
    const object = row?.logo_r2_key ? await c.env.FILES.get(row.logo_r2_key) : null;
    if (!object) throw new NotFoundError('logo');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('cache-control', 'public, max-age=3600');
    return new Response(object.body, { headers });
  });

  app.get('/public/share/:token', declareManualAuth('public link, token carries its own signature and expiry'), async (c) => {
    const payload = await verifySendToken(c.env, c.req.param('token'));
    if (payload.kind !== 'share') throw new NotFoundError('Link');
    const doc = await getDoc(c.env.DB, payload.documentId);
    // Defense in depth: re-check CLAUDE.md rule 3 at delivery time, not only when the link was made.
    const gate = await allocationGate(c.env.DB, doc.id);
    if (!gate.allowed || doc.number === null) throw new NotFoundError('Document');
    const key = r2Key(doc.date, doc.series_id, doc.number, payload.variant);
    const object = await c.env.FILES.get(key);
    if (!object) throw new NotFoundError('file', key);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('content-disposition', `inline; filename="${key.split('/').pop()}"`);
    return new Response(object.body, { headers });
  });

  return app;
}
