import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import type { Env } from '../../env';
import type { Mailer } from '../sending/mailer';
import { signSendToken } from '../sending/tokens';
import { demoTexts } from './config';

/**
 * R26 task 5: leads and the consent record. A lead is a name and an email from the gate. A consent
 * row records the answer to the marketing box, the exact text shown and its version. Double opt-in:
 * a ticked box sends one confirmation email when email is set up. Every email carries an
 * unsubscribe link. Each lead and each consent change goes server to server to DEMO_LEAD_WEBHOOK_URL
 * when it and DEMO_LEAD_SECRET are set, and the daily cron retries what failed. Without both, lead
 * capture stays off. The reset never touches these tables.
 */

export interface LeadRow {
  id: number;
  name: string;
  email: string;
  first_visit_at: string;
  last_visit_at: string;
  visits: number;
  ip: string | null;
  user_agent: string | null;
  sandbox_id: number | null;
  webhook_status: 'pending' | 'saved' | 'failed' | 'off';
}

export interface ConsentRow {
  id: number;
  lead_id: number;
  consent: number;
  consent_text: string;
  text_version: string;
  ip: string | null;
  given_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

const YEAR_SECONDS = 365 * 24 * 3600;

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The same email updates the lead: last visit, visit count, the latest name. */
export async function upsertLead(db: D1Database, input: { name: string; email: string; ip: string | null; userAgent: string | null }): Promise<LeadRow> {
  const email = input.email.trim().toLowerCase();
  const at = nowIso();
  await run(
    db,
    `INSERT INTO demo_leads (name, email, ip, user_agent, first_visit_at, last_visit_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET name = excluded.name, last_visit_at = excluded.last_visit_at, visits = visits + 1, ip = excluded.ip, user_agent = excluded.user_agent`,
    input.name.trim().slice(0, 200),
    email,
    input.ip,
    input.userAgent?.slice(0, 300) ?? null,
    at,
    at,
  );
  return (await first<LeadRow>(db, 'SELECT * FROM demo_leads WHERE email = ?', email))!;
}

export async function latestConsent(db: D1Database, leadId: number): Promise<ConsentRow | null> {
  return first<ConsentRow>(db, 'SELECT * FROM demo_consents WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);
}

/** Records the answer to the marketing box. A repeat visit with the same answer adds no row. */
export async function recordConsent(env: Env, lead: LeadRow, consent: boolean, lang: 'en' | 'he', ip: string | null): Promise<{ consent: ConsentRow; changed: boolean }> {
  const texts = demoTexts(env);
  const text = lang === 'he' ? texts.consentHe : texts.consentEn;
  const last = await latestConsent(env.DB, lead.id);
  const lastYes = last ? last.consent === 1 && !last.unsubscribed_at : false;
  if (last && lastYes === consent) return { consent: last, changed: false };
  // An unticked box after a yes is not an unsubscribe: unsubscribing is its own link. Keep the yes.
  if (last && lastYes && !consent) return { consent: last, changed: false };
  await run(env.DB, 'INSERT INTO demo_consents (lead_id, consent, consent_text, text_version, ip) VALUES (?, ?, ?, ?, ?)', lead.id, consent ? 1 : 0, text, texts.consentVersion, ip);
  return { consent: (await latestConsent(env.DB, lead.id))!, changed: true };
}

export async function queueLeadEvent(db: D1Database, lead: LeadRow, event: 'lead' | 'consent' | 'unsubscribe', consent: ConsentRow | null, env: Env): Promise<void> {
  const payload = {
    event,
    name: lead.name,
    email: lead.email,
    consent: consent && consent.consent === 1 && !consent.unsubscribed_at ? 'yes' : 'no',
    consentDate: consent?.confirmed_at ?? consent?.given_at ?? null,
    consentSource: `${demoTexts(env).product} demo gate`,
    consentTextVersion: consent?.text_version ?? null,
    confirmed: Boolean(consent?.confirmed_at),
    unsubscribedAt: consent?.unsubscribed_at ?? null,
  };
  await run(db, 'INSERT INTO demo_lead_events (lead_id, event, payload) VALUES (?, ?, ?)', lead.id, event, JSON.stringify(payload));
}

/**
 * Sends pending and failed events to DEMO_LEAD_WEBHOOK_URL as JSON, with DEMO_LEAD_SECRET in the
 * X-Lead-Secret header. Without both the events mark "off". A
 * lead's webhook status follows its latest event.
 */
export async function forwardLeadEvents(env: Env, fetchFn: typeof fetch, limit = 50): Promise<{ sent: number; failed: number }> {
  const db = env.DB;
  const secret = (env.DEMO_LEAD_SECRET ?? '').trim();
  const url = secret ? (env.DEMO_LEAD_WEBHOOK_URL ?? '').trim() : '';
  const events = await all<{ id: number; lead_id: number; payload: string; attempts: number }>(
    db,
    "SELECT id, lead_id, payload, attempts FROM demo_lead_events WHERE status IN ('pending', 'failed') AND attempts < 10 ORDER BY id LIMIT ?",
    limit,
  );
  let sent = 0;
  let failed = 0;
  for (const e of events) {
    if (!url) {
      await transaction(db, [stmt(db, "UPDATE demo_lead_events SET status = 'off' WHERE id = ?", e.id), stmt(db, "UPDATE demo_leads SET webhook_status = 'off' WHERE id = ?", e.lead_id)]);
      continue;
    }
    let ok = false;
    let error: string | null = null;
    try {
      const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lead-Secret': secret }, body: e.payload });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : 'network error';
    }
    await transaction(db, [
      stmt(db, 'UPDATE demo_lead_events SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = ? WHERE id = ?', ok ? 'sent' : 'failed', error, ok ? nowIso() : null, e.id),
      stmt(db, 'UPDATE demo_leads SET webhook_status = ? WHERE id = ?', ok ? 'saved' : 'failed', e.lead_id),
    ]);
    if (ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

export async function unsubscribeUrl(env: Env, baseUrl: string, leadId: number): Promise<string> {
  const token = await signSendToken(env, { kind: 'demo_unsubscribe', leadId, exp: Math.floor(Date.now() / 1000) + 3 * YEAR_SECONDS });
  return `${baseUrl}/api/demo/unsubscribe/${token}`;
}

/** The footer every email from the demo carries. */
async function footer(env: Env, baseUrl: string, leadId: number): Promise<{ html: string; text: string }> {
  const url = await unsubscribeUrl(env, baseUrl, leadId);
  return {
    html: `<p style="color:#6b6a66;font-size:12px">You get this email because you entered the ${escapeHtml(demoTexts(env).product)} demo. <a href="${url}">Unsubscribe</a>.</p>`,
    text: `\n--\nYou get this email because you entered the ${demoTexts(env).product} demo. Unsubscribe: ${url}\n`,
  };
}

export async function sendConfirmation(env: Env, mailer: Mailer, baseUrl: string, lead: LeadRow, consent: ConsentRow): Promise<void> {
  const token = await signSendToken(env, { kind: 'demo_confirm', consentId: consent.id, exp: Math.floor(Date.now() / 1000) + 14 * 24 * 3600 });
  const url = `${baseUrl}/api/demo/confirm/${token}`;
  const texts = demoTexts(env);
  const foot = await footer(env, baseUrl, lead.id);
  await mailer.send({
    to: lead.email,
    fromName: texts.sender,
    subject: `Confirm updates from ${texts.sender}`,
    html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>Hi ${escapeHtml(lead.name)},</p><p>You asked for updates and offers from ${escapeHtml(texts.sender)} by email. Confirm with one click:</p><p><a href="${url}">Yes, send me updates</a></p><p>If you did not ask, ignore this email. Nothing more is sent.</p>${foot.html}</body></html>`,
    text: `Hi ${lead.name},\n\nYou asked for updates and offers from ${texts.sender} by email. Confirm: ${url}\n\nIf you did not ask, ignore this email. Nothing more is sent.\n${foot.text}`,
  });
}

export async function sendReopenCode(env: Env, mailer: Mailer, baseUrl: string, lead: LeadRow, code: string): Promise<void> {
  const texts = demoTexts(env);
  const foot = await footer(env, baseUrl, lead.id);
  await mailer.send({
    to: lead.email,
    fromName: texts.sender,
    subject: `Your code for the ${texts.product} demo`,
    html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>Your code to reopen your demo:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It works for 10 minutes.</p>${foot.html}</body></html>`,
    text: `Your code to reopen your demo: ${code}\nIt works for 10 minutes.\n${foot.text}`,
  });
}

/** Confirms the consent the link names. Returns false when it was unsubscribed or already confirmed. */
export async function confirmConsent(env: Env, consentId: number): Promise<boolean> {
  const row = await first<ConsentRow>(env.DB, 'SELECT * FROM demo_consents WHERE id = ?', consentId);
  if (!row || row.consent !== 1 || row.unsubscribed_at || row.confirmed_at) return Boolean(row?.confirmed_at);
  await run(env.DB, 'UPDATE demo_consents SET confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL', nowIso(), consentId);
  const lead = (await first<LeadRow>(env.DB, 'SELECT * FROM demo_leads WHERE id = ?', row.lead_id))!;
  await queueLeadEvent(env.DB, lead, 'consent', await latestConsent(env.DB, lead.id), env);
  return true;
}

/** Sets unsubscribed_at on every open consent of the lead and tells the lead webhook. Never deletes. */
export async function unsubscribeLead(env: Env, leadId: number): Promise<void> {
  const lead = await first<LeadRow>(env.DB, 'SELECT * FROM demo_leads WHERE id = ?', leadId);
  if (!lead) return;
  const open = await first(env.DB, 'SELECT 1 FROM demo_consents WHERE lead_id = ? AND unsubscribed_at IS NULL', leadId);
  if (!open) return;
  await run(env.DB, 'UPDATE demo_consents SET unsubscribed_at = ? WHERE lead_id = ? AND unsubscribed_at IS NULL', nowIso(), leadId);
  await queueLeadEvent(env.DB, lead, 'unsubscribe', await latestConsent(env.DB, leadId), env);
}

export async function consentHistory(db: D1Database, leadId: number): Promise<ConsentRow[]> {
  return all<ConsentRow>(db, 'SELECT * FROM demo_consents WHERE lead_id = ? ORDER BY id', leadId);
}
