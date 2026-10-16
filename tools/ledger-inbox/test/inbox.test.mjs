// The email gateway against an in-memory SQLite stand-in for D1, a fake licence service and a
// fake Ledger. Run from this folder: node test/inbox.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import gateway, { handleEmail, hmacHex, MAX_BYTES, newInboxId, sha256Hex } from '../src/index.js';

const sq = new DatabaseSync(':memory:');
sq.exec(readFileSync(new URL('../migrations/0001_inboxes.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => sq.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sq.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(sq.prepare(sql).run(...args).changes) } }),
});
const DB = { prepare: (sql) => stmt(sql) };

const SHOP = 'https://shop.example.test';
const SHOP_SECRET = 'shop-secret-shop-secret-shop-secret';
const env = { DB, INBOX_DOMAIN: 'in.example.test', LICENCE_URL: SHOP, LICENCE_SECRET: SHOP_SECRET };
const licences = new Map([
  ['OL-AAAA-BBBB-CCCC-DDDD', { id: 1, status: 'new' }],
  ['OL-EEEE-FFFF-GGGG-HHHH', { id: 2, status: 'new' }],
]);
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  const body = JSON.parse(init.body);
  if (u.pathname === '/licence/activate') {
    const l = licences.get(body.key);
    if (!l || l.status === 'revoked') return Response.json({ ok: false, message: 'This licence key is not valid.' }, { status: 403 });
    Object.assign(l, { status: 'bound', accountId: body.accountId, taxId: body.taxId });
    return Response.json({ ok: true, licenceId: l.id });
  }
  if (u.pathname === '/licence/check') {
    const l = [...licences.values()].find((x) => x.id === body.licenceId);
    return Response.json({ ok: !!l && l.status === 'bound' });
  }
  return new Response('not found', { status: 404 });
};

const logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(' '));

const call = (path, body, headers = {}) =>
  gateway.fetch(new Request(`https://gw.example.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env);

const SUBJECT = 'Invoice 4471 from Secret Supplier';
const RAW = `From: Billing <billing@supplier.test>\r\nTo: x@in.example.test\r\nSubject: ${SUBJECT}\r\n\r\nTotal 118.00 for the private matter.\r\n`;
function fakeMessage(to, { raw = RAW, from = 'owner@biz.test', rawSize } = {}) {
  const bytes = new TextEncoder().encode(raw);
  const m = { to, from, rawSize: rawSize ?? bytes.byteLength, raw: new Blob([bytes]).stream(), rejected: null };
  m.setReject = (reason) => {
    m.rejected = reason;
  };
  return m;
}
function fakeLedger(status) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers), body: Buffer.from(init.body) });
    if (status === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    return new Response('{}', { status });
  };
  return { fn, calls };
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    realLog(`ok - ${name}`);
  } catch (err) {
    failures++;
    realLog(`not ok - ${name}\n  ${err?.stack ?? err}`);
  }
}

let inbox;

await test('inbox ids are 10 characters of lowercase Crockford base32', async () => {
  for (let i = 0; i < 200; i++) assert.match(newInboxId(), /^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);
});

await test('register checks the licence and returns the address and a secret', async () => {
  const r = await call('/register', { origin: 'https://ledger.biz.test', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: 'acc1', taxId: '123' });
  assert.equal(r.status, 201);
  inbox = await r.json();
  assert.match(inbox.inboxId, /^[0-9a-z]{10}$/);
  assert.equal(inbox.address, `${inbox.inboxId}@in.example.test`);
  assert.ok(inbox.secret.length >= 43);
});

await test('a second register for the same licence keeps the inbox and makes a new secret', async () => {
  const r = await call('/register', { origin: 'https://ledger.biz.test', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: 'acc1', taxId: '123' });
  assert.equal(r.status, 200);
  const again = await r.json();
  assert.equal(again.inboxId, inbox.inboxId);
  assert.notEqual(again.secret, inbox.secret);
  inbox = again;
  assert.equal(sq.prepare('SELECT COUNT(*) AS n FROM inboxes').get().n, 1);
});

await test('register refuses a bad licence', async () => {
  const r = await call('/register', { origin: 'https://other.test', licence: 'OL-ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
  assert.equal(r.status, 403);
});

await test('a known address forwards the raw message with a valid signature', async () => {
  const ledger = fakeLedger(200);
  const m = fakeMessage(`${inbox.inboxId}@in.example.test`);
  await handleEmail(m, env, ledger.fn);
  assert.equal(m.rejected, null);
  assert.equal(ledger.calls.length, 1);
  const c = ledger.calls[0];
  assert.equal(c.url, 'https://ledger.biz.test/api/inbox');
  assert.equal(c.body.toString(), RAW);
  assert.equal(c.headers.get('X-Ledger-Envelope-From'), 'owner@biz.test');
  const ts = c.headers.get('X-Inbox-Timestamp');
  const want = await hmacHex(inbox.secret, `${ts}.owner@biz.test.${await sha256Hex(new Uint8Array(c.body).buffer)}`);
  assert.equal(c.headers.get('X-Inbox-Signature'), want);
});

await test('with INBOX_PREFIX the address is prefix+id, and both forms reach the same inbox', async () => {
  const penv = { ...env, INBOX_PREFIX: 'expenses' };
  const r = await gateway.fetch(new Request('https://gw.example.test/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: 'https://ledger.biz.test', licence: 'OL-AAAA-BBBB-CCCC-DDDD', accountId: 'acc1', taxId: '123' }) }), penv);
  const again = await r.json();
  inbox = { ...inbox, secret: again.secret };
  assert.equal(again.address, `expenses+${again.inboxId}@in.example.test`);
  for (const to of [`expenses+${again.inboxId}@in.example.test`, `${again.inboxId}@in.example.test`]) {
    const ledger = fakeLedger(200);
    const m = fakeMessage(to);
    await handleEmail(m, penv, ledger.fn);
    assert.equal(m.rejected, null, to);
    assert.equal(ledger.calls.length, 1, to);
  }
  for (const to of [`other+${again.inboxId}@in.example.test`, `expenses+nope@in.example.test`]) {
    const m = fakeMessage(to);
    await handleEmail(m, penv, fakeLedger(200).fn);
    assert.equal(m.rejected, 'Unknown address', to);
  }
});

await test('an unknown address is rejected and nothing is sent', async () => {
  const ledger = fakeLedger(200);
  const m = fakeMessage('nobody0000@in.example.test');
  await handleEmail(m, env, ledger.fn);
  assert.equal(m.rejected, 'Unknown address');
  assert.equal(ledger.calls.length, 0);
});

await test('over 20 MB is rejected as too large', async () => {
  const ledger = fakeLedger(200);
  const m = fakeMessage(`${inbox.inboxId}@in.example.test`, { rawSize: MAX_BYTES + 1 });
  await handleEmail(m, env, ledger.fn);
  assert.equal(m.rejected, 'Too large');
  assert.equal(ledger.calls.length, 0);
});

await test('a Ledger 500 or a timeout rejects with a temporary reason, a 4xx for good', async () => {
  for (const [status, reason] of [[500, 'Temporary problem, try again later'], ['timeout', 'Temporary problem, try again later'], [403, 'Refused by the Ledger']]) {
    const m = fakeMessage(`${inbox.inboxId}@in.example.test`);
    await handleEmail(m, env, fakeLedger(status).fn);
    assert.equal(m.rejected, reason, String(status));
  }
});

await test('rotate needs the current secret, then the old address stops at once', async () => {
  const old = inbox.inboxId;
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ inboxId: old, timestamp: ts });
  const bad = await call('/rotate', body, { 'X-Inbox-Signature': await hmacHex('wrong', `${ts}.${body}`) });
  assert.equal(bad.status, 401);
  const r = await call('/rotate', body, { 'X-Inbox-Signature': await hmacHex(inbox.secret, `${ts}.${body}`) });
  assert.equal(r.status, 200);
  const next = await r.json();
  assert.notEqual(next.inboxId, old);
  const m = fakeMessage(`${old}@in.example.test`);
  await handleEmail(m, env, fakeLedger(200).fn);
  assert.equal(m.rejected, 'Unknown address');
  const ok = fakeMessage(`${next.inboxId}@in.example.test`);
  await handleEmail(ok, env, fakeLedger(200).fn);
  assert.equal(ok.rejected, null);
  inbox = { ...inbox, inboxId: next.inboxId };
});

await test('a licence that is no longer active rejects as an unknown address', async () => {
  // A second install, so its licence answer is not cached from the tests above.
  const r = await call('/register', { origin: 'https://two.biz.test', licence: 'OL-EEEE-FFFF-GGGG-HHHH', accountId: 'acc2', taxId: '456' });
  const two = await r.json();
  licences.get('OL-EEEE-FFFF-GGGG-HHHH').status = 'revoked';
  const ledger = fakeLedger(200);
  const m = fakeMessage(`${two.inboxId}@in.example.test`);
  await handleEmail(m, env, ledger.fn);
  assert.equal(m.rejected, 'Unknown address');
  assert.equal(ledger.calls.length, 0);
});

await test('a paused inbox rejects as an unknown address', async () => {
  sq.prepare("UPDATE inboxes SET paused_at = 'now' WHERE inbox_id = ?").run(inbox.inboxId);
  const m = fakeMessage(`${inbox.inboxId}@in.example.test`);
  await handleEmail(m, env, fakeLedger(200).fn);
  assert.equal(m.rejected, 'Unknown address');
});

await test('the logs hold no message content, address, subject or secret', async () => {
  const all = logs.join('\n');
  for (const secret of [SUBJECT, 'Secret Supplier', 'private matter', 'billing@supplier.test', 'owner@biz.test', inbox.secret, 'OL-AAAA']) {
    assert.ok(!all.includes(secret), `log holds ${secret}`);
  }
  assert.ok(logs.some((l) => l.startsWith('email inbox=')));
});

console.log = realLog;
if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('all passed');
