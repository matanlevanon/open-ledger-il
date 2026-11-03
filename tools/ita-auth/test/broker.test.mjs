// The broker against an in-memory SQLite stand-in for D1. Run from this folder: node test/broker.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import broker, { scopesFor } from '../src/index.js';
const sq = new DatabaseSync(':memory:'); for (const f of ['0001_clients.sql', '0002_licences.sql']) sq.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => sq.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sq.prepare(sql).all(...args) }),
  run: async () => { const r = sq.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((x) => x.run())) };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const b64u = (b) => Buffer.from(b).toString('base64url');
const jwt = (email, aud = 'AUD') => { const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })); const p = b64u(JSON.stringify({ aud: [aud], email, exp: Date.now() / 1000 + 600 })); return `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), privateKey))}`; };
let itaCalls = 0;
let lastItaBody = null;
globalThis.fetch = async (u, init) => { u = String(u); if (u.endsWith('/cdn-cgi/access/certs')) return new Response(JSON.stringify({ keys: [jwk] })); itaCalls++; lastItaBody = new URLSearchParams(String(init?.body ?? '')); return new Response('{"access_token":"x"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
const env = { DB, PUBLIC_URL: 'https://ita-auth.example.com', STATE_SECRET: 'x'.repeat(40), REGISTER_SECRET: 's'.repeat(44), ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'AUD', ADMIN_EMAILS: 'boss@example.com', ITA_CLIENT_ID_PRODUCTION: 'id', ITA_CLIENT_SECRET_PRODUCTION: 'sec' };
const call = (path, init = {}) => broker.fetch(new Request(`https://ita-auth.example.com${path}`, init), env);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const reg = (body, secret = env.REGISTER_SECRET) => call('/register', { method: 'POST', headers: { 'X-Ita-Broker-Admin': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const tok = (name, key) => call('/token', { method: 'POST', headers: { 'X-Ita-Broker-Client': name, 'X-Ita-Broker-Key': key }, body: 'grant_type=refresh_token&refresh_token=r&environment=production' });

let r = await reg({ origin: 'https://ledger.acme.co.il', business: 'Acme' }, 'wrong'); ok(r.status === 401, 'register refuses a wrong admin secret');
r = await reg({ origin: 'http://ledger.acme.co.il' }); ok(r.status === 400, 'register refuses http');
r = await reg({ origin: 'https://ledger.acme.co.il/x', business: 'Acme' }); const a = await r.json(); ok(r.status === 201 && a.name === 'ledger-acme-co-il' && a.key.length > 40, `register adds a client (${a.name})`);
const row = sq.prepare('SELECT * FROM clients').get(); ok(row.origin === 'https://ledger.acme.co.il' && row.key_sha256 !== a.key && row.key_sha256 === createHash('sha256').update(a.key).digest('hex'), 'only the key hash is stored, origin trimmed');
r = await tok(a.name, a.key); ok(r.status === 200 && itaCalls === 1, 'token works with the key');
ok(sq.prepare('SELECT last_seen_at FROM clients').get().last_seen_at, 'last use recorded');
r = await tok(a.name, 'nope'); ok(r.status === 401, 'token refuses a wrong key');
r = await reg({ origin: 'https://ledger.acme.co.il', business: 'Acme Ltd' }); const a2 = await r.json(); ok(r.status === 200 && a2.renewed && a2.name === a.name, 'same address renews the key');
r = await tok(a.name, a.key); ok(r.status === 401, 'old key stops working after renewal');
r = await tok(a.name, a2.key); ok(r.status === 200, 'new key works');
r = await call('/admin'); ok(r.status === 403, 'admin refuses without Access');
r = await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': jwt('other@example.com') } }); ok(r.status === 403, 'admin refuses a non-admin email');
r = await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com', 'OTHER') } }); ok(r.status === 403, 'admin refuses a wrong audience');
r = await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com') } }); const html = await r.text(); ok(r.status === 200 && html.includes('Acme Ltd') && html.includes('Pause') && html.includes('/cdn-cgi/access/logout'), 'admin lists the client, with Sign out');
r = await call(`/admin/clients/${a.name}/pause`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com'), Origin: 'https://evil.example' } }); ok(r.status === 403, 'pause refuses a cross-site post');
r = await call(`/admin/clients/${a.name}/pause`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com'), Origin: 'https://ita-auth.example.com' } }); ok(r.status === 303, 'pause works');
r = await tok(a.name, a2.key); ok(r.status === 401, 'paused client is refused');
r = await call(`/authorize?client=${a.name}&environment=production&state=s`); ok(r.status === 403, 'paused client cannot start a sign-in');
r = await reg({ origin: 'https://ledger.acme.co.il' }); ok(r.status === 403, 'paused client cannot re-register');
r = await call(`/admin/clients/${a.name}/resume`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com'), Origin: 'https://ita-auth.example.com' } }); ok(r.status === 303, 'resume works');
r = await tok(a.name, a2.key); ok(r.status === 200, 'resumed client works with the same key');
r = await reg({ origin: 'https://ledger-acme.co.il' }); const b = await r.json(); ok(b.name === 'ledger-acme-co-il-2', `name clash gets a suffix (${b.name})`);
ok(sq.prepare('SELECT count(*) n FROM client_events').get().n === 5, 'every change logged in client_events');
r = await call(`/authorize?client=${a.name}&environment=production&state=s`); ok(r.status === 302 && r.headers.get('Location').includes('client_id=id'), 'authorize redirects an active client');

// SHAAM's scope change of 01.11.2026.
ok(r.headers.get('Location').includes('scope=invoices_scope'), 'authorize asks for invoices_scope');
ok(JSON.stringify(scopesFor(new Date('2026-10-25T10:00:00Z'))) === '["invoices_scope","scope"]', 'before 01.11.2026 the old scope is still allowed');
ok(JSON.stringify(scopesFor(new Date('2026-10-31T22:30:00Z'))) === '["invoices_scope"]', 'from 01.11.2026 Israel time only invoices_scope');
const tokScope = (scope) => call('/token', { method: 'POST', headers: { 'X-Ita-Broker-Client': a.name, 'X-Ita-Broker-Key': a2.key }, body: `grant_type=refresh_token&refresh_token=r&environment=production${scope === null ? '' : `&scope=${scope}`}` });
await tokScope(null); ok(lastItaBody.get('scope') === 'invoices_scope', 'no scope from the install: invoices_scope');
await tokScope('invoices_scope'); ok(lastItaBody.get('scope') === 'invoices_scope', 'invoices_scope passes through');
await tokScope('scope'); ok(lastItaBody.get('scope') === (scopesFor(new Date()).includes('scope') ? 'scope' : 'invoices_scope'), 'the old scope passes only before 01.11.2026');
await tokScope('anything'); ok(lastItaBody.get('scope') === 'invoices_scope', 'an unknown scope becomes invoices_scope');
