#!/usr/bin/env node
// Demo data for trying the app and for screenshots: an invented business, three clients, one
// document of each עוסק פטור type plus a draft, and a few expenses. Every name is invented.
//
// Usage: npm run seed:demo -- --local
//
// Local only. The script refuses to run without --local and refuses --remote outright. It applies
// the local migrations, starts `wrangler dev --local` on a spare port, creates documents through the
// real API (so numbering, the hash chain and the audit log are genuine), inserts expenses into the
// local D1, then stops the dev server.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--remote') || !args.includes('--local')) {
  console.error('seed:demo writes demo data and runs against the LOCAL database only. Run: npm run seed:demo -- --local');
  process.exit(1);
}

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = 'owner@example.com';
const isWindows = process.platform === 'win32';

function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: isWindows, env: { ...process.env, CI: '1' } });
  if (res.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed`);
}

/** Runs SQL against the local D1 through a temp file, so no shell quoting touches the SQL. */
function d1(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'open-ledger-il-seed-'));
  const file = join(dir, 'seed.sql');
  writeFileSync(file, sql);
  try {
    const res = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', `--file=${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: isWindows,
    });
    if (res.status !== 0) throw new Error(`d1 execute failed: ${res.stderr || res.stdout}`);
    return JSON.parse(res.stdout)[0]?.results ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function api(method, path, body) {
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function waitForHealth(child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('wrangler dev exited early.');
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev did not start within 2 minutes.');
}

const today = new Date().toISOString().slice(0, 10);
const line = (description, unitPriceMinor, quantityMilli = 1000, descriptionHe = null) => ({ description, descriptionHe, unitPriceMinor, quantityMilli });

/** A signature image drawn as a plain SVG squiggle. Invented, no real handwriting. */
const DEMO_SIGNATURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90"><path d="M10 60 C 40 10, 60 90, 90 40 S 140 20, 150 55 S 200 70, 230 30" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/></svg>`;

async function seedDocuments() {
  const existing = await api('GET', '/documents?tab=all');
  if ((existing.items ?? []).length > 0) {
    console.log('The local database already holds documents. Skipping the document seed.');
    return;
  }

  await api('PUT', '/ops/business', {
    nameEn: 'Sample Business Ltd',
    nameHe: 'עסק לדוגמה בע"מ',
    taxId: '123456782',
    taglineEn: 'Design & Consulting',
    taglineHe: 'עיצוב וייעוץ',
    addressEn: '1 Example Street, Tel Aviv',
    addressHe: 'רחוב הדוגמה 1, תל אביב',
    email: 'billing@example.com',
    phone: '+972-50-000-0000',
    website: 'example.com',
    bankDetails: 'Example Bank, branch 001, account 000000',
  });
  const form = new FormData();
  form.append('file', new File([DEMO_SIGNATURE_SVG], 'signature.svg', { type: 'image/svg+xml' }));
  await api('POST', '/ops/business/signature', form);

  const client = async (input) => (await api('POST', '/clients', input)).client.id;
  const acme = await client({ nameEn: 'Acme Ltd', nameHe: 'אקמי בע"מ', companyId: '515123456', email: 'accounts@acme.example', addressEn: '2 Example Street, Haifa' });
  const example = await client({ nameEn: 'Example Client', email: 'hello@client.example', country: 'US', foreignResident: true, addressEn: '10 Sample Avenue, Springfield' });
  const northwind = await client({ nameEn: 'Northwind Traders', nameHe: 'נורת\'ווינד', email: 'ap@northwind.example' });

  const create = async (input) => (await api('POST', '/documents', input)).document.id;
  const finalize = (id) => api('POST', `/documents/${id}/finalize`, {});

  const quote = await create({ type: 'QT', clientId: acme, lines: [line('Brand workshop', 450000, 1000, 'סדנת מיתוג'), line('Design review', 80000, 2000, 'סקירת עיצוב')] });
  await finalize(quote);

  const request = await create({ type: 'PR', clientId: northwind, dueDate: today, lines: [line('Monthly consulting retainer', 600000)] });
  await finalize(request);

  const proforma = await create({ type: '300', clientId: example, lines: [line('Website audit', 250000), line('Workshop day', 300000)] });
  await finalize(proforma);

  const receipt = await create({
    type: '400',
    clientId: acme,
    lines: [line('Brand workshop', 450000)],
    payments: [{ method: 'bank_transfer', paidOn: today, amountMinor: 450000, reference: 'TRX-0001' }],
  });
  await finalize(receipt);

  const second = await create({
    type: '400',
    clientId: northwind,
    lines: [line('Design review', 80000)],
    payments: [{ method: 'card', paidOn: today, amountMinor: 80000 }],
  });
  await finalize(second);
  await api('POST', `/documents/${second}/credit`, { mode: 'full', reason: 'Duplicate charge', refundMethod: 'card' });

  await create({ type: 'QT', clientId: example, lines: [line('Follow-up workshop', 300000)] });
  console.log('Seeded the business profile, 3 clients and 7 documents (quote, payment request, pro forma, 2 receipts, credit receipt, draft quote).');
}

function seedExpenses() {
  const count = d1('SELECT COUNT(*) AS n FROM expenses')[0]?.n ?? 0;
  if (count > 0) {
    console.log('The local database already holds expenses. Skipping the expense seed.');
    return;
  }
  const month = today.slice(0, 7);
  d1(`INSERT INTO suppliers (name, tax_id, country, default_currency) VALUES
    ('Cloud Hosting Co', NULL, 'US', 'USD'),
    ('Office Supplies Ltd', '514000000', 'IL', 'ILS'),
    ('Example Telecom', '520000000', 'IL', 'ILS')`);
  d1(`INSERT INTO expenses (supplier_id, category_id, status, document_number, document_date, document_type, currency, amount_minor, vat_amount_minor, amount_ils_minor, fx_rate, fx_rate_date, fx_source, notes)
    SELECT s.id, c.id, v.status, v.num, v.date, v.type, v.cur, v.amount, v.vat, v.ils, v.rate, v.rate_date, v.src, 'Demo data'
    FROM (
      SELECT 'Cloud Hosting Co' AS sup, 'software' AS cat, 'filed' AS status, 'INV-1001' AS num, '${month}-02' AS date, 'Invoice' AS type, 'USD' AS cur, 2000 AS amount, 0 AS vat, 7400 AS ils, '3.700000' AS rate, '${month}-02' AS rate_date, 'demo' AS src
      UNION ALL SELECT 'Office Supplies Ltd', 'equipment', 'filed', 'A-2201', '${month}-05', 'Tax invoice', 'ILS', 35400, 5400, 35400, NULL, NULL, NULL
      UNION ALL SELECT 'Example Telecom', 'communication', 'filed', 'T-77', '${month}-08', 'Tax invoice', 'ILS', 11800, 1800, 11800, NULL, NULL, NULL
      UNION ALL SELECT 'Office Supplies Ltd', 'other', 'new', 'A-2230', '${month}-12', 'Receipt', 'ILS', 4900, 0, 4900, NULL, NULL, NULL
    ) v
    JOIN suppliers s ON s.name = v.sup
    JOIN expense_categories c ON c.key = v.cat`);
  console.log('Seeded 3 suppliers and 4 expenses.');
}

async function main() {
  if (!existsSync(join(ROOT, 'web', 'dist', 'index.html'))) run('npm', ['run', 'build:web']);
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);

  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--local', '--port', String(PORT), '--var', 'ENVIRONMENT:development', '--var', `DEV_AUTH_EMAIL:${OWNER}`, '--var', `OWNER_EMAIL:${OWNER}`],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    await waitForHealth(child);
    await seedDocuments();
    seedExpenses();
    console.log(`Done. Start the app with "npm run dev" and sign in as ${OWNER} (dev bypass in .dev.vars).`);
  } catch (err) {
    console.error(log.slice(-4000));
    throw err;
  } finally {
    if (isWindows && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
