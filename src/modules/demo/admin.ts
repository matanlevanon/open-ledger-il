import { type Context, Hono } from 'hono';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { auditAs, SYSTEM_ACTOR } from '../../core/audit';
import { all, first } from '../../core/db';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import type { AppEnv, Env } from '../../env';
import { slackNotifier } from '../ita/notify';
import { usage } from './caps';
import { demoCaps, demoDay, demoTexts, isDemo } from './config';
import { consentHistory, forwardLeadEvents, unsubscribeLead } from './leads';
import { lastReset, lastSweep, runReset } from './reset';
import { ensureMasterOwner } from './sample';
import { createSession, sessionCookie } from './session';

/**
 * R26 task 8, R29 task 8: the demo admin, at /admin (page) and /admin/api/* plus /api/admin/* (JSON). Every
 * request needs a Cloudflare Access JWT for an email in ADMIN_EMAILS, checked here, the same way
 * the ITA broker's admin checks it. The Access app covers /admin and /api/admin.
 */

export interface AdminOptions {
  /** Key lookup for the Access JWT. Tests pass a local JWKS. */
  keyResolver?: (env: Env) => JWTVerifyGetKey;
  fetchFn?: typeof fetch;
}

const remote = new Map<string, JWTVerifyGetKey>();

export async function adminEmail(env: Env, jwt: string | undefined, options: AdminOptions): Promise<string | null> {
  const team = (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '');
  const aud = (env.ACCESS_AUD ?? '').trim();
  const admins = (env.ADMIN_EMAILS ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!team || !aud || admins.length === 0 || !jwt) return null;
  try {
    let resolver = options.keyResolver?.(env);
    if (!resolver) {
      resolver = remote.get(team) ?? createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
      remote.set(team, resolver);
    }
    const { payload } = await jwtVerify(jwt, resolver, { issuer: team, audience: aud });
    const email = String(payload.email ?? '').toLowerCase();
    return admins.includes(email) ? email : null;
  } catch {
    return null;
  }
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface LeadView {
  id: number;
  name: string;
  email: string;
  first_visit_at: string;
  last_visit_at: string;
  visits: number;
  webhook_status: string;
  consent: number | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

async function leads(db: D1Database, q: string | undefined): Promise<LeadView[]> {
  const like = `%${(q ?? '').trim().toLowerCase()}%`;
  return all<LeadView>(
    db,
    `SELECT l.id, l.name, l.email, l.first_visit_at, l.last_visit_at, l.visits, l.webhook_status, c.consent, c.confirmed_at, c.unsubscribed_at
       FROM demo_leads l LEFT JOIN demo_consents c ON c.id = (SELECT MAX(id) FROM demo_consents WHERE lead_id = l.id)
      WHERE lower(l.name) LIKE ? OR lower(l.email) LIKE ? ORDER BY l.first_visit_at DESC LIMIT 500`,
    like,
    like,
  );
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function adminPageHtml(env: Env, email: string): string {
  const product = demoTexts(env).product;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Demo Admin</title>
<style>
:root{--canvas:#faf9f6;--surface:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#e3e1db;--brand:#1f5fd1;--ok:#1f8a4c;--okbg:#e6f4ec}

*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.55 system-ui,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 60px}.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:12px 0}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}@media(max-width:700px){.stats{grid-template-columns:1fr 1fr}}
.stat{border:1px solid var(--line);border-radius:12px;padding:12px}.stat b{display:block;font-size:22px}.muted{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:start;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:12px}
button,a.btn{font:inherit;font-size:14px;border-radius:10px;padding:7px 14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}
input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--canvas);color:var(--ink);max-width:280px;width:100%}
.chip{font-size:12px;font-weight:600;border-radius:999px;padding:2px 10px}.yes{background:var(--okbg);color:var(--ok)}.no{background:var(--line);color:var(--muted)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.wide{overflow-x:auto}
</style></head><body><main>
<div class="row" style="justify-content:space-between"><h1 style="margin:0;font-size:22px">${esc(product)} demo admin</h1><span class="muted">${esc(email)} · <a href="/cdn-cgi/access/logout">Sign out</a></span></div>
<div class="card"><div class="stats" id="stats"></div>
<div class="row"><input id="q" placeholder="Search name or email"><a class="btn" id="csv" href="/admin/api/leads.csv">Export CSV</a><button id="sample">Open the sample set as admin</button><button id="reset">Reset now</button></div>
<div class="wide"><table><thead><tr><th>Name</th><th>Email</th><th>First visit</th><th>Marketing</th><th>Webhook</th><th></th></tr></thead><tbody id="leads"></tbody></table></div>
<p class="muted" id="last"></p><pre class="muted" id="history"></pre></div>
<script>
(function(){
var $=function(i){return document.getElementById(i)};
function j(u,o){return fetch(u,Object.assign({headers:{'content-type':'application/json'}},o||{})).then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error((b.error&&b.error.message)||'Failed');return b})})}
function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function when(s){return s?new Date(s).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}
function chip(l){if(l.unsubscribed_at)return'<span class="chip no">Unsubscribed '+when(l.unsubscribed_at)+'</span>';if(l.consent===1&&l.confirmed_at)return'<span class="chip yes">Confirmed '+when(l.confirmed_at)+'</span>';if(l.consent===1)return'<span class="chip yes">Opted in, not confirmed</span>';return'<span class="chip no">Not opted in</span>'}
function load(){
j('/admin/api/summary').then(function(s){
$('stats').innerHTML='<div class="stat"><b>'+s.visitorsToday+'</b><span class="muted">Visitors today</span></div><div class="stat"><b>'+s.activeSessions+'</b><span class="muted">Active sessions</span></div><div class="stat"><b>'+s.draftsToday+'</b><span class="muted">Drafts created today</span></div><div class="stat"><b>'+s.pdfsToday+' / '+s.pdfCap+'</b><span class="muted">PDFs today / cap</span></div><div class="stat"><b>'+s.leads+'</b><span class="muted">Leads, total</span></div><div class="stat"><b>'+s.optInRate+'%</b><span class="muted">Opted in</span></div>';
$('last').textContent=(s.lastSweep?('Last sweep: '+when(s.lastSweep.started_at)+', '+s.lastSweep.message):'No sweep yet.')+' '+(s.lastReset?('Last reset: '+when(s.lastReset.started_at)+', '+s.lastReset.message):'No reset yet.');});
j('/admin/api/leads?q='+encodeURIComponent($('q').value)).then(function(b){
$('leads').innerHTML=b.leads.map(function(l){return'<tr><td>'+e(l.name)+'</td><td>'+e(l.email)+'</td><td>'+when(l.first_visit_at)+'</td><td>'+chip(l)+' <button data-h="'+l.id+'">History</button></td><td>'+e(l.webhook_status==='saved'?'Saved':l.webhook_status==='failed'?'Failed':l.webhook_status==='off'?'Off':'Pending')+(l.webhook_status==='failed'?' <button data-r="'+l.id+'">Retry</button>':'')+'</td><td>'+(l.consent===1&&!l.unsubscribed_at?'<button data-u="'+l.id+'">Unsubscribe</button>':'')+'</td></tr>'}).join('');});}
$('leads').onclick=function(ev){var t=ev.target;if(t.dataset.u)j('/admin/api/leads/'+t.dataset.u+'/unsubscribe',{method:'POST'}).then(load);if(t.dataset.r)j('/admin/api/leads/'+t.dataset.r+'/retry',{method:'POST'}).then(load);if(t.dataset.h)j('/admin/api/leads/'+t.dataset.h+'/consents').then(function(b){$('history').textContent=b.consents.map(function(c){return when(c.given_at)+' · '+(c.consent?'yes':'no')+' · version '+c.text_version+(c.confirmed_at?' · confirmed '+when(c.confirmed_at):'')+(c.unsubscribed_at?' · unsubscribed '+when(c.unsubscribed_at):'')+'\\n  '+c.consent_text}).join('\\n')})};
$('q').oninput=function(){$('csv').href='/admin/api/leads.csv?q='+encodeURIComponent($('q').value);load()};
$('sample').onclick=function(){j('/admin/api/sample-session',{method:'POST'}).then(function(){location.href='/'})};
$('reset').onclick=function(){if(!confirm('Remove every visitor draft and session now, and rebuild the sample data if it changed?'))return;$('reset').disabled=true;j('/admin/api/reset',{method:'POST'}).then(function(r){$('last').textContent='Reset: '+r.result.message}).catch(function(err){$('last').textContent=err.message}).then(function(){$('reset').disabled=false;load()})};
load();})();
</script></main></body></html>`;
}

/** Builds the admin routes. Mounted at /admin and /api/admin by src/index.ts, demo mode only. */
export function createDemoAdminRoutes(options: AdminOptions = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const fetchFn = options.fetchFn ?? ((i: RequestInfo | URL, init?: RequestInit) => fetch(i, init));

  r.use('*', async (c, next) => {
    if (!isDemo(c.env)) return c.text('Not found', 404);
    const email = await adminEmail(c.env, c.req.header('Cf-Access-Jwt-Assertion'), options);
    if (!email) throw new ForbiddenError('This page needs the admin sign-in.');
    c.set('demo', { sessionKey: null, admin: true, adminEmail: email });
    return next();
  });

  const adminActor = (c: Context<AppEnv>) => ({ ...SYSTEM_ACTOR, email: c.get('demo')?.adminEmail ?? 'admin', role: 'demo_admin', ip: c.req.header('CF-Connecting-IP') ?? null });

  r.get('/', (c) => c.html(adminPageHtml(c.env, c.get('demo')!.adminEmail ?? '')));

  const api = new Hono<AppEnv>();
  api.get('/summary', async (c) => {
    const db = c.env.DB;
    const day = demoDay();
    const total = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM demo_leads'))!.n;
    const optedIn = (await first<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM demo_leads l JOIN demo_consents c ON c.id = (SELECT MAX(id) FROM demo_consents WHERE lead_id = l.id) WHERE c.consent = 1 AND c.unsubscribed_at IS NULL',
    ))!.n;
    const caps = demoCaps(c.env);
    const active = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM demo_sessions WHERE admin = 0 AND expires_at > ?', new Date().toISOString()))!.n;
    return c.json({
      leads: total,
      optInRate: total ? Math.round((optedIn / total) * 100) : 0,
      visitorsToday: await usage(db, day, 'global', 'sandboxes'),
      visitorCap: caps.dailySandboxes,
      activeSessions: active,
      draftsToday: await usage(db, day, 'global', 'documents'),
      pdfsToday: await usage(db, day, 'global', 'pdfs'),
      pdfCap: caps.dailyPdfs,
      lastSweep: await lastSweep(db),
      lastReset: await lastReset(db),
    });
  });
  api.get('/leads', async (c) => c.json({ leads: await leads(c.env.DB, c.req.query('q')) }));
  api.get('/leads.csv', async (c) => {
    const rows = await leads(c.env.DB, c.req.query('q'));
    const head = 'name,email,first_visit_at,last_visit_at,visits,marketing_consent,confirmed_at,unsubscribed_at,webhook_status';
    const lines = rows.map((l) => [l.name, l.email, l.first_visit_at, l.last_visit_at, l.visits, l.consent === 1 && !l.unsubscribed_at ? 'yes' : 'no', l.confirmed_at, l.unsubscribed_at, l.webhook_status].map(csvCell).join(','));
    await auditAs(c.env.DB, adminActor(c), 'demo.leads_export', 'demo_leads', null, { rows: rows.length });
    return new Response(`${head}\n${lines.join('\n')}\n`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="demo-leads.csv"', 'cache-control': 'no-store' } });
  });
  api.get('/leads/:id/consents', async (c) => c.json({ consents: await consentHistory(c.env.DB, Number(c.req.param('id'))) }));
  api.post('/leads/:id/unsubscribe', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await first(c.env.DB, 'SELECT 1 FROM demo_leads WHERE id = ?', id))) throw new NotFoundError('Lead', id);
    await unsubscribeLead(c.env, id);
    await forwardLeadEvents(c.env, fetchFn, 5);
    await auditAs(c.env.DB, adminActor(c), 'demo.lead_unsubscribe', 'demo_lead', id);
    return c.json({ ok: true });
  });
  api.post('/leads/:id/retry', async (c) => {
    const id = Number(c.req.param('id'));
    await c.env.DB.prepare("UPDATE demo_lead_events SET status = 'pending', attempts = 0 WHERE lead_id = ? AND status = 'failed'").bind(id).run();
    return c.json(await forwardLeadEvents(c.env, fetchFn, 20));
  });
  api.post('/sample-session', async (c) => {
    const owner = await ensureMasterOwner(c.env.DB);
    const email = c.get('demo')!.adminEmail;
    const { token } = await createSession(c.env.DB, { userId: owner.userId, admin: true, adminEmail: email });
    await auditAs(c.env.DB, adminActor(c), 'demo.admin_sample_session', 'user', owner.userId);
    return c.json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
  });
  api.post('/reset', async (c) => {
    const url = (c.env.DEMO_RESET_URL ?? '').trim();
    let result: unknown;
    if (url) {
      const res = await fetchFn(`${url.replace(/\/+$/, '')}/run`, { method: 'POST', headers: { 'X-Reset-Secret': c.env.DEMO_RESET_SECRET ?? '' } });
      result = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
    } else {
      result = await runReset({ db: c.env.DB, files: c.env.FILES, trigger: 'admin', notifier: slackNotifier(c.env.SLACK_WEBHOOK_URL, fetchFn) });
    }
    await auditAs(c.env.DB, adminActor(c), 'demo.reset_now', 'demo_resets', null, result);
    return c.json({ result });
  });
  r.route('/api', api);
  // The same JSON at /api/admin/* : /api/admin/summary maps to /admin/api/summary.
  r.route('/', api);
  return r;
}
