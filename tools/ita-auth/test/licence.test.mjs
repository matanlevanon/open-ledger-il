// Licence keys and the Tax Authority proxy, against an in-memory SQLite stand-in for D1, a fake
// licence service and a fake Tax Authority. Run from this folder: node test/licence.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import broker from '../src/index.js';

const sq = new DatabaseSync(':memory:');
for (const f of ['0001_clients.sql', '0002_licences.sql']) sq.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
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
const jwt = (email) => { const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })); const p = b64u(JSON.stringify({ aud: ['AUD'], email, exp: Date.now() / 1000 + 600 })); return `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), privateKey))}`; };

// A fake licence service with the shop's rules: bind on first use, reinstall on the same pair, refuse others.
const SHOP = 'https://shop.example.test';
const SHOP_SECRET = 'shop-secret-shop-secret-shop-secret';
const licences = new Map([
  ['OL-AAAA-BBBB-CCCC-DDDD', { id: 1, status: 'new' }],
  ['OL-EEEE-FFFF-GGGG-HHHH', { id: 2, status: 'new' }],
]);
let checkCalls = 0;
let shopDown = false;
function shop(path, body, headers) {
  if (headers.get('X-Shop-Secret') !== SHOP_SECRET) return Response.json({ ok: false, error: 'unauthorized', message: 'Wrong secret.' }, { status: 401 });
  if (path === '/licence/activate') {
    const l = licences.get(String(body.key).toUpperCase());
    if (!l || l.status === 'revoked') return Response.json({ ok: false, error: 'licence_invalid', message: 'This licence key is not valid.' }, { status: 403 });
    if (l.status === 'new') Object.assign(l, { status: 'bound', accountId: body.accountId, taxId: body.taxId });
    else if (l.accountId !== body.accountId || l.taxId !== body.taxId) return Response.json({ ok: false, error: 'licence_in_use', message: 'This key is already used by another install. Contact the seller to move it.' }, { status: 409 });
    return Response.json({ ok: true, licenceId: l.id, status: 'bound' });
  }
  if (path === '/licence/check') {
    checkCalls++;
    const l = [...licences.values()].find((x) => x.id === body.licenceId);
    return Response.json({ ok: !!l && l.status === 'bound' && l.accountId === body.accountId && l.taxId === body.taxId, status: l?.status ?? 'unknown' });
  }
  return new Response('not found', { status: 404 });
}

const itaCalls = [];
globalThis.fetch = async (input, init = {}) => {
  const u = String(input);
  if (u.endsWith('/cdn-cgi/access/certs')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (u.startsWith(SHOP)) {
    if (shopDown) throw new TypeError('fetch failed');
    return shop(new URL(u).pathname, JSON.parse(init.body), new Headers(init.headers));
  }
  itaCalls.push({ url: u, method: init.method, headers: new Headers(init.headers), body: init.body ? Buffer.from(init.body).toString() : null, redirect: init.redirect });
  return new Response('{"status":0,"confirmation_number":"123"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const logs = [];
const realLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

const base = { DB, PUBLIC_URL: 'https://ita-auth.example.com', STATE_SECRET: 'x'.repeat(40), REGISTER_SECRET: 's'.repeat(44), ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'AUD', ADMIN_EMAILS: 'boss@example.com', ITA_CLIENT_ID_PRODUCTION: 'id', ITA_CLIENT_SECRET_PRODUCTION: 'sec' };
const withShop = { ...base, LICENCE_URL: `${SHOP}/`, LICENCE_SECRET: SHOP_SECRET };
const call = (env, path, init = {}) => broker.fetch(new Request(`https://ita-auth.example.com${path}`, init), env);
const ok = (c, m) => { realLog(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const regLicence = (env, body) => call(env, '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ACCT_A = 'a'.repeat(32);
const ACCT_B = 'b'.repeat(32);
const ita = (env, name, key, path = '/ita/ita-api/shaam/tsandbox/Invoices/v2/Approval', init = {}) =>
  call(env, path, { method: 'POST', body: '{"invoice_id":"secret-body-123"}', ...init, headers: { 'X-Ita-Client': name, 'X-Ita-Client-Key': key, Authorization: 'Bearer user-access-token', 'Content-Type': 'application/json', Accept: 'application/json', 'X-Other': 'drop me', ...(init.headers ?? {}) } });

// No licence service set.
let r = await regLicence(base, { origin: 'https://ledger.one.co.il', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: ACCT_A, taxId: '123456782' });
ok(r.status === 503, 'no licence service: a licence key cannot register');
r = await call(base, '/register', { method: 'POST', headers: { 'X-Ita-Broker-Admin': base.REGISTER_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: 'https://ledger.old.co.il', business: 'Old' }) });
const old = await r.json();
ok(r.status === 201 && old.key, 'no licence service: the admin secret still registers');
r = await ita(base, old.name, old.key);
ok(r.status === 200 && itaCalls.length === 1, 'no licence service: an install with no licence is forwarded');
const fwd = itaCalls[0];
ok(fwd.url === 'https://ita-api.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval' && fwd.redirect === 'manual', 'same path on the Tax Authority host, no redirects');
ok(fwd.headers.get('authorization') === 'Bearer user-access-token' && fwd.headers.get('x-other') === null && fwd.headers.get('x-ita-client-key') === null, 'only Authorization, Content-Type and Accept pass');
ok(fwd.body === '{"invoice_id":"secret-body-123"}', 'the body passes unchanged');

// Valid key.
r = await regLicence(withShop, { origin: 'https://ledger.one.co.il', business: 'One', licence: 'ol-aaaa-bbbb-cccc-dddd', accountId: ACCT_A, taxId: '123456782' });
const one = await r.json();
ok(r.status === 201 && one.key, 'valid key: registers');
const row = sq.prepare('SELECT licence_id, licence_last4, account_id, tax_id FROM clients WHERE name = ?').get(one.name);
ok(row.licence_id === 1 && row.licence_last4 === 'DDDD' && row.account_id === ACCT_A && row.tax_id === '123456782', 'valid key: licence id, last 4, account and tax number stored');
r = await ita(withShop, one.name, one.key);
ok(r.status === 200 && checkCalls === 1, 'valid key: forwarded after one licence check');
r = await ita(withShop, one.name, one.key, '/ita/openapi/shaam/production/x/y', { method: 'GET', body: undefined });
ok(r.status === 200 && checkCalls === 1, 'valid key: the check is cached');
r = await regLicence(withShop, { origin: 'https://ledger.one.co.il', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: ACCT_A, taxId: '123456782' });
const renewed = await r.json();
ok(r.status === 200 && renewed.renewed && renewed.name === one.name, 'valid key: a reinstall on the same account renews the key');
r = await ita(withShop, one.name, one.key);
ok(r.status === 401, 'valid key: the old key stops working after the reinstall');
one.key = renewed.key;
r = await ita(withShop, one.name, one.key);
ok(r.status === 200, 'valid key: the new key works');

// Key in use.
r = await regLicence(withShop, { origin: 'https://ledger.two.co.il', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: ACCT_B, taxId: '123456782' });
const inUse = await r.json();
ok(r.status === 409 && inUse.broker_error === 'This key is already used by another install. Contact the seller to move it.' && inUse.error === 'licence_in_use', 'key in use: refused with the shop message');
ok(!sq.prepare("SELECT 1 FROM clients WHERE origin = 'https://ledger.two.co.il'").get(), 'key in use: nothing registered');
r = await regLicence(withShop, { origin: 'https://ledger.three.co.il', licence: 'OL-ZZZZ-ZZZZ-ZZZZ-ZZZZ', accountId: ACCT_B, taxId: '123456782' });
ok(r.status === 403, 'unknown key: refused');

// Revoked key mid-session, refused after the cache expires.
r = await regLicence(withShop, { origin: 'https://ledger.four.co.il', licence: 'OL-EEEE-FFFF-GGGG-HHHH', accountId: ACCT_B, taxId: '000000018' });
const four = await r.json();
r = await ita(withShop, four.name, four.key);
ok(r.status === 200, 'revoked mid-session: works before the revoke');
licences.get('OL-EEEE-FFFF-GGGG-HHHH').status = 'revoked';
r = await ita(withShop, four.name, four.key);
ok(r.status === 200, 'revoked mid-session: still served from the 10-minute cache');
const realNow = Date.now;
Date.now = () => realNow() + 11 * 60_000;
r = await ita(withShop, four.name, four.key);
ok(r.status === 403, 'revoked mid-session: refused after the cache expires');
licences.set('OL-JJJJ-KKKK-MMMM-NNNN', { id: 3, status: 'new' });
r = await regLicence(withShop, { origin: 'https://ledger.five.co.il', licence: 'OL-JJJJ-KKKK-MMMM-NNNN', accountId: ACCT_A, taxId: '000000026' });
const five = await r.json();
shopDown = true;
r = await ita(withShop, one.name, one.key);
ok(r.status === 200, 'licence service down: the last answer stands, so invoices keep going');
r = await ita(withShop, five.name, five.key);
ok(r.status === 503, 'licence service down and no answer yet: 503');
shopDown = false;
Date.now = realNow;

// Paused client.
sq.prepare("UPDATE clients SET status = 'paused' WHERE name = ?").run(one.name);
r = await ita(withShop, one.name, one.key);
ok(r.status === 401, 'paused client: refused on /ita/* at once');
sq.prepare("UPDATE clients SET status = 'active' WHERE name = ?").run(one.name);

// Path and method rules.
r = await ita(withShop, one.name, one.key, '/ita/ita-api/other/x');
ok(r.status === 404, 'a path outside /shaam/<env>/ is refused');
r = await ita(withShop, one.name, one.key, '/ita/ita-api/shaam/tsandbox/a%00b');
ok(r.status === 404, 'a path with characters outside the relay rule is refused');
r = await ita(withShop, one.name, one.key, '/ita/ita-api/shaam/tsandbox/x', { method: 'PUT' });
ok(r.status === 405, 'PUT is refused');
r = await ita(withShop, one.name, 'wrong-key');
ok(r.status === 401, 'a wrong key is refused');

// Through the relay when one is set.
const before = itaCalls.length;
r = await ita({ ...withShop, ITA_RELAY_URL: 'https://relay.example.test', ITA_RELAY_CLIENT_ID: 'rid', ITA_RELAY_CLIENT_SECRET: 'rsec' }, one.name, one.key);
const viaRelay = itaCalls[before];
ok(r.status === 200 && viaRelay.url === 'https://relay.example.test/ita-api/shaam/tsandbox/Invoices/v2/Approval' && viaRelay.headers.get('CF-Access-Client-Id') === 'rid', 'forwarded through the relay with the broker token');

// Admin page.
r = await call(withShop, '/admin', { headers: { 'Cf-Access-Jwt-Assertion': jwt('boss@example.com') } });
const html = await r.text();
ok(html.includes('…DDDD') && html.includes('no licence') && html.includes('<th>Licence</th>'), 'admin page shows the licence last 4 or no licence');

// Logs.
const joined = logs.join('\n');
ok(!joined.includes('secret-body-123') && !joined.includes('user-access-token') && !joined.includes(one.key) && !joined.includes('OL-AAAA'), 'no body, token, key or licence key in the logs');
