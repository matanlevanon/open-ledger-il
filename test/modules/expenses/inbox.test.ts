import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { createExpensesModule } from '../../../src/modules/expenses';
import { FakeDriveSource } from '../../../src/modules/expenses/fakes';
import type { Extractor, ExtractInput } from '../../../src/modules/expenses/extractor';
import { hmacHex, INBOX_KEYS, normaliseSender, processInboundEmail } from '../../../src/modules/expenses/inbox';
import { createInboxModule } from '../../../src/modules/expenses/inbox-routes';
import type { Deps } from '../../../src/modules/expenses/service';
import type { ExtractedExpense } from '../../../src/modules/expenses/types';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';

/** R35 task 2: POST /api/inbox. Signed by the gateway, the sender rule, one expense per attachment. */

const SECRET = 'inbox-test-secret';
const OWNER = 'owner@example.com';

/** Reads every file as a fixed receipt, and records what it was given. */
class RecordingExtractor implements Extractor {
  calls: ExtractInput[] = [];
  fail = false;
  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    this.calls.push(input);
    if (this.fail) throw new Error('no key');
    return { supplierName: 'Inbox Supplier', supplierId: null, documentNumber: null, date: '2026-10-01', currency: 'ILS', amount: '118.00', vatAmount: '18.00', documentType: 'Receipt' };
  }
}

const extractor = new RecordingExtractor();
const deps: Deps = { drive: new FakeDriveSource(), extractor, fx: new FxRates(env.DB, new FakeFxHistory({})) };
const app = createApp({ modules: [createInboxModule(() => deps), createExpensesModule(() => deps)] });
const testEnv = { ...env, INBOX_SECRET: SECRET, OWNER_EMAIL: OWNER };

let seq = 0;
const unique = () => `${Date.now()}-${++seq}`;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const pdfBytes = (tag: string) => new TextEncoder().encode(`%PDF-1.4\n% receipt ${tag}\n%%EOF\n`);

interface Part {
  filename: string;
  type: string;
  bytes: Uint8Array;
  inline?: boolean;
}

function mime(opts: { subject?: string; from?: string; text?: string; html?: string; parts?: Part[] }): string {
  const b = `b-${unique()}`;
  const lines = [`From: ${opts.from ?? 'Billing Team <billing@supplier.test>'}`, `To: inbox@in.example.test`, `Subject: ${opts.subject ?? 'Your receipt'}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b}"`, ''];
  if (opts.text !== undefined) lines.push(`--${b}`, 'Content-Type: text/plain; charset=utf-8', '', opts.text);
  if (opts.html !== undefined) lines.push(`--${b}`, 'Content-Type: text/html; charset=utf-8', '', opts.html);
  for (const p of opts.parts ?? []) {
    lines.push(
      `--${b}`,
      `Content-Type: ${p.type}; name="${p.filename}"`,
      `Content-Disposition: ${p.inline ? 'inline' : 'attachment'}; filename="${p.filename}"`,
      ...(p.inline ? [`Content-ID: <${p.filename}>`] : []),
      'Content-Transfer-Encoding: base64',
      '',
      b64(p.bytes),
    );
  }
  lines.push(`--${b}--`, '');
  return lines.join('\r\n');
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function signed(raw: string, opts: { from?: string; ts?: number; secret?: string } = {}) {
  const body = new TextEncoder().encode(raw);
  const from = opts.from ?? OWNER;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = await hmacHex(opts.secret ?? SECRET, `${ts}.${from}.${await sha256Hex(body.buffer as ArrayBuffer)}`);
  return { body, headers: { 'Content-Type': 'message/rfc822', 'X-Inbox-Timestamp': String(ts), 'X-Inbox-Signature': sig, 'X-Ledger-Envelope-From': from } };
}

async function post(req: { body: Uint8Array; headers: Record<string, string> }, e: Record<string, unknown> = testEnv) {
  return app.request('/api/inbox', { method: 'POST', headers: req.headers, body: req.body }, e);
}

const expensesWithNote = (text: string) => env.DB.prepare('SELECT * FROM expenses WHERE notes LIKE ?').bind(`%${text}%`).all<Record<string, unknown>>();
const lastEvent = () => env.DB.prepare('SELECT * FROM inbox_events ORDER BY id DESC LIMIT 1').first<Record<string, unknown>>();

beforeEach(async () => {
  extractor.calls = [];
  extractor.fail = false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM settings WHERE key LIKE ?').bind('expenses.inbox_%'),
    env.DB.prepare('DELETE FROM inbox_signatures'),
  ]);
});

describe('POST /api/inbox: the signature', () => {
  it('a valid signature creates one expense per attachment, read by AI, with the sender and subject as note', async () => {
    const tag = unique();
    const raw = mime({ subject: `Invoice ${tag}`, text: 'Attached.', parts: [{ filename: 'a.pdf', type: 'application/pdf', bytes: pdfBytes(`${tag}-a`) }, { filename: 'b.png', type: 'image/png', bytes: new Uint8Array(30_000).fill(7, 0, 30_000).map((v, i) => (i < tag.length ? tag.charCodeAt(i) : v)) }] });
    const res = await post(await signed(raw));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('expense');
    const rows = (await expensesWithNote(`Invoice ${tag}`)).results;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe('new');
    expect(rows[0]!.amount_minor).toBe(11800);
    expect(String(rows[0]!.notes)).toBe(`Email from Billing Team <billing@supplier.test>: Invoice ${tag}`);
    expect(extractor.calls.map((c) => c.contentType).sort()).toEqual(['application/pdf', 'image/png']);
  });

  it('refuses a bad signature, an old timestamp and a replay with 401 and the same body', async () => {
    const raw = mime({ subject: `Sig ${unique()}`, parts: [{ filename: 'x.pdf', type: 'application/pdf', bytes: pdfBytes(unique()) }] });
    const bad = await post(await signed(raw, { secret: 'wrong' }));
    const old = await post(await signed(raw, { ts: Math.floor(Date.now() / 1000) - 301 }));
    const good = await signed(raw);
    expect((await post(good)).status).toBe(200);
    const replay = await post(good);
    const noSecret = await post(await signed(raw), { ...testEnv, INBOX_SECRET: undefined });
    const bodies = [];
    for (const r of [bad, old, replay, noSecret]) {
      expect(r.status).toBe(401);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('refuses a body changed after signing', async () => {
    const req = await signed(mime({ parts: [{ filename: 'x.pdf', type: 'application/pdf', bytes: pdfBytes(unique()) }] }));
    const tampered = { ...req, body: new TextEncoder().encode(new TextDecoder().decode(req.body).replace('Your receipt', 'Changed')) };
    expect((await post(tampered)).status).toBe(401);
  });
});

describe('the sender rule', () => {
  it('a sender off the list creates nothing and logs one line', async () => {
    const tag = unique();
    const res = await post(await signed(mime({ subject: `Stranger ${tag}`, parts: [{ filename: 's.pdf', type: 'application/pdf', bytes: pdfBytes(tag) }] }), { from: 'stranger@else.test' }));
    expect(res.status).toBe(200);
    expect((await expensesWithNote(`Stranger ${tag}`)).results).toHaveLength(0);
    expect(await lastEvent()).toMatchObject({ sender: 'stranger@else.test', outcome: 'ignored' });
  });

  it('starts with the owner and the owners and assistants of the business, then follows the saved list', async () => {
    // As the app adds one: users.role says only accountant or not, user_businesses holds the role.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES ('noauto-inbox-assistant@example.com', 'owner')"),
      env.DB.prepare("INSERT OR IGNORE INTO user_businesses (user_id, business_id, role) SELECT id, 1, 'assistant' FROM users WHERE email = 'noauto-inbox-assistant@example.com'"),
    ]);
    const tag = unique();
    const one = await post(await signed(mime({ subject: `Asst ${tag}`, parts: [{ filename: 'a.pdf', type: 'application/pdf', bytes: pdfBytes(tag) }] }), { from: 'noauto-inbox-assistant@example.com' }));
    expect(((await one.json()) as { outcome: string }).outcome).toBe('expense');
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(INBOX_KEYS.senders, JSON.stringify(['other@example.com'])).run();
    const two = await post(await signed(mime({ parts: [{ filename: 'b.pdf', type: 'application/pdf', bytes: pdfBytes(unique()) }] }), { from: OWNER }));
    expect(((await two.json()) as { outcome: string }).outcome).toBe('ignored');
  });

  it('matches a Gmail forwarding envelope with its +caf_ tag', () => {
    expect(normaliseSender('Owner+caf_=r7k2m9x4qp=in.example.test@Example.com')).toBe('owner@example.com');
  });
});

describe('Gmail forwarding confirmation', () => {
  it('is accepted from Google once, stored with the code and link, and makes no expense', async () => {
    const tag = unique();
    const text = `Confirmation code: 987654321\n\nTo allow this, click:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ-abc%5D-xyz${tag}\n`;
    const res = await post(await signed(mime({ subject: `(#987654321) Gmail Forwarding Confirmation ${tag}`, text }), { from: 'forwarding-noreply@google.com' }));
    expect(((await res.json()) as { outcome: string }).outcome).toBe('confirmation');
    const stored = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(INBOX_KEYS.gmail).first<{ value: string }>();
    const gmail = JSON.parse(stored!.value) as { code: string; link: string };
    expect(gmail.code).toBe('987654321');
    expect(gmail.link).toBe(`https://mail-settings.google.com/mail/vf-%5BANGjdJ-abc%5D-xyz${tag}`);
    expect((await expensesWithNote(tag)).results).toHaveLength(0);
    expect(extractor.calls).toHaveLength(0);
  });
});

describe('what becomes an expense', () => {
  it('an email with no attachment makes one expense from its text, marked to check the amount', async () => {
    const tag = unique();
    const res = await post(await signed(mime({ subject: `Body ${tag}`, html: `<p>Total <b>118.00</b> ILS ${tag}</p><script>alert(1)</script>` })));
    expect(((await res.json()) as { outcome: string }).outcome).toBe('expense');
    const rows = (await expensesWithNote(`Body ${tag}`)).results;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.notes)).toMatch(/^From email text, check the amount\. Email from /);
    const file = await env.DB.prepare('SELECT * FROM expense_files WHERE id = ?').bind(rows[0]!.file_id).first<Record<string, unknown>>();
    expect(file).toMatchObject({ content_type: 'text/html' });
    expect(String(file!.filename)).toMatch(/\.html$/);
    expect(extractor.calls[0]!.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(extractor.calls[0]!.bytes)).toContain(`118.00 ILS ${tag}`);
  });

  it('serves a stored email body sandboxed', async () => {
    const tag = unique();
    await post(await signed(mime({ subject: `Sandbox ${tag}`, html: `<p>${tag}</p>` })));
    const row = (await expensesWithNote(`Sandbox ${tag}`)).results[0]!;
    const res = await app.request(`/api/expenses/files/${row.file_id}/download`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('skips inline images under 20 KB, keeps a large inline image', async () => {
    const tag = unique();
    const logo = new Uint8Array(2_000).fill(1);
    const big = new Uint8Array(25_000).map((_, i) => (i < tag.length ? tag.charCodeAt(i) : 9));
    await post(await signed(mime({ subject: `Logos ${tag}`, html: '<p>See attached</p>', parts: [{ filename: 'logo.png', type: 'image/png', bytes: logo, inline: true }, { filename: 'scan.jpg', type: 'image/jpeg', bytes: big, inline: true }] })));
    const rows = (await expensesWithNote(`Logos ${tag}`)).results;
    expect(rows).toHaveLength(1);
    expect(extractor.calls.map((c) => c.filename)).toEqual(['scan.jpg']);
  });

  it('the same file twice is one expense', async () => {
    const tag = unique();
    const part = { filename: 'same.pdf', type: 'application/pdf', bytes: pdfBytes(tag) };
    await post(await signed(mime({ subject: `Dup one ${tag}`, parts: [part] })));
    const res = await post(await signed(mime({ subject: `Dup two ${tag}`, parts: [part] })));
    expect(((await res.json()) as { outcome: string }).outcome).toBe('duplicate');
    expect((await expensesWithNote(`Dup one ${tag}`)).results).toHaveLength(1);
    expect((await expensesWithNote(`Dup two ${tag}`)).results).toHaveLength(0);
    expect(await lastEvent()).toMatchObject({ outcome: 'duplicate' });
  });

  it('a file the reader cannot read still becomes an expense waiting for review', async () => {
    extractor.fail = true;
    const tag = unique();
    await post(await signed(mime({ subject: `Unread ${tag}`, parts: [{ filename: 'u.heic', type: 'image/heic', bytes: pdfBytes(tag) }] })));
    const rows = (await expensesWithNote(`Unread ${tag}`)).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'new', amount_minor: 0, supplier_id: null });
    expect(String(rows[0]!.notes)).toMatch(/ \| Not read automatically: \S/);
  });

  it('the inbox switched off refuses with 403 and creates nothing', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('expenses.inbox_enabled', '0')").run();
    const tag = unique();
    const res = await post(await signed(mime({ subject: `Off ${tag}`, parts: [{ filename: 'o.pdf', type: 'application/pdf', bytes: pdfBytes(tag) }] })));
    expect(res.status).toBe(403);
    expect((await expensesWithNote(`Off ${tag}`)).results).toHaveLength(0);
  });

  it('is not there in the demo', async () => {
    const res = await post(await signed(mime({ parts: [] })), { ...testEnv, DEMO_MODE: '1' });
    expect([401, 404]).toContain(res.status);
  });

  it('the parser runs without the HTTP layer too', async () => {
    const tag = unique();
    const raw = new TextEncoder().encode(mime({ subject: `Direct ${tag}`, parts: [{ filename: 'd.pdf', type: 'application/pdf', bytes: pdfBytes(tag) }] }));
    const result = await processInboundEmail(testEnv as never, deps, raw.buffer as ArrayBuffer, OWNER);
    expect(result.outcome).toBe('expense');
  });
});
