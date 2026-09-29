import { env } from 'cloudflare:workers';
import { it, vi } from 'vitest';
import { createApp } from '../src/index';
import { createClientsModule } from '../src/modules/clients';
import type { AllocationRequester } from '../src/modules/documents';
import { createDocumentsModule } from '../src/modules/documents';
import type { CeilingGuard } from '../src/modules/documents/ceiling';
import { buildUnifiedFile } from '../src/modules/exports/unified-file/build';
import { FakeFxHistory, FxRates } from '../src/modules/fx';
import { createLegalModeModule } from '../src/modules/legal-mode';
import type { Env } from '../src/env';

/**
 * Demo data for the Tax Authority's unified file checker (simulator).
 *
 * The registration guide asks for a file with at least 10 complete documents of every type the
 * software issues and about 2,000 records. This fills the test database (never a live one) with
 * a demo year: pro formas, receipts and credit receipts as עוסק פטור, then a switch to עוסק
 * מורשה and tax invoices, invoice receipts, credit invoices and receipts. Every document goes
 * through the real API, so numbering, VAT and links are what the Ledger really produces.
 *
 * Run with scripts/demo-unified-file.mjs, which prints nothing to the screen but writes the zip
 * and the two printouts to demo/output/.
 */

// The demo runs through 2025 on a fake clock, so each document's issue time (field 1205) matches
// its date and the legal-mode switch accepts its effective date.
const clock = { today: '2025-01-01' };
const passThroughCeiling: CeilingGuard = { async check() {} };
// Invoices stay under ₪2,500 before VAT, below the allocation threshold, so no allocation number is needed.
const noAllocation: AllocationRequester = { async request(id) { return { status: 'pending', message: `demo ${id}` }; } };

const fx = new FxRates(env.DB, new FakeFxHistory({}));
const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => clock.today, allocation: () => noAllocation };
const app = createApp({
  modules: [createClientsModule({ today: () => clock.today }), createDocumentsModule(documentsOptions), createLegalModeModule({ documentsOptions })],
});

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** Small seeded generator, so every run makes the same demo year. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20250101);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)]!;

function nextDay(): string {
  const d = new Date(`${clock.today}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 5 || d.getUTCDay() === 6);
  clock.today = d.toISOString().slice(0, 10);
  vi.setSystemTime(new Date(`${clock.today}T08:00:00Z`));
  return clock.today;
}

const SERVICES = [
  ['Strategy workshop', 'סדנת אסטרטגיה'],
  ['Campaign setup', 'הקמת קמפיין'],
  ['Monthly retainer', 'ריטיינר חודשי'],
  ['Landing page review', 'בדיקת דף נחיתה'],
  ['Analytics audit', 'בדיקת אנליטיקס'],
  ['Ad creative set', 'סט מודעות'],
  ['Reporting pack', 'חבילת דוחות'],
  ['Consulting hour', 'שעת ייעוץ'],
] as const;

const CLIENTS = [
  ['Harbor Studio Ltd', 'הרבור סטודיו בע"מ', '514713288'],
  ['Northwind Labs', 'נורתווינד לאבס', '515234565'],
  ['Cedar Foods', 'ארזים מזון', '514998871'],
  ['Blue Pier Travel', 'המזח הכחול', '516112232'],
  ['Olive Tech', 'זית טכנולוגיות', '515667780'],
  ['Galil Wines', 'יקבי גליל', '514334457'],
] as const;

function lines(min: number, max: number) {
  return Array.from({ length: int(min, max) }, () => {
    const [en, he] = pick([...SERVICES]);
    return { description: en, descriptionHe: he, quantityMilli: pick([1000, 1000, 2000, 1500]), unitPriceMinor: int(5, 15) * 1000 };
  });
}

/** Splits an amount into 1 to `max` payments, the way a client pays in instalments. */
function payments(total: number, max: number) {
  const n = int(1, max);
  const out = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? left : Math.floor(total / n);
    left -= amount;
    const method = pick(['bank_transfer', 'card', 'cheque'] as const);
    out.push({
      method,
      paidOn: clock.today,
      amountMinor: amount,
      ...(method === 'cheque'
        ? {
            chequeCrossed: true,
            reference: String(int(100000, 999999)),
            bankNumber: String(pick([10, 11, 12, 20, 31])),
            branchNumber: String(int(100, 999)),
            accountNumber: String(int(100000, 9999999)),
          }
        : {}),
    });
  }
  return out;
}

async function issue(type: string, input: Record<string, unknown>) {
  const draft = await api('POST', '/documents', { type, ...input });
  return (await api('POST', `/documents/${draft.document.id}/finalize`, {})).document;
}

it('builds the demo year and the unified file', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${clock.today}T08:00:00Z`));
  const vat = (env as unknown as Record<string, string>).DEMO_VAT || '123456782';
  const nameHe = (env as unknown as Record<string, string>).DEMO_NAME_HE || 'עסק לדוגמה';
  await env.DB.prepare('INSERT OR IGNORE INTO business_profile (id) VALUES (1)').run();
  await env.DB.prepare(
    "UPDATE business_profile SET tax_id = ?, name_he = ?, name_en = 'Demo business', address_he = 'הרצל 1, תל אביב', address_en = '1 Herzl St, Tel Aviv' WHERE id = 1",
  )
    .bind(vat, nameHe)
    .run();

  const clients: number[] = [];
  for (const [en, he, cvat] of CLIENTS) {
    clients.push((await api('POST', '/clients', { nameEn: en, nameHe: he, country: 'IL', vatNumber: cvat, city: 'תל אביב', postalCode: '6100000' })).client.id);
  }

  // עוסק פטור, January to May: pro formas, receipts that pay them, and credit receipts.
  const receipts: number[] = [];
  for (let i = 0; i < 80; i++) {
    nextDay();
    const pf = await issue('300', { clientId: pick(clients), lines: lines(4, 8) });
    const paid = await api('POST', `/documents/${pf.id}/record-payment`, { payments: payments(pf.total_minor, 4) });
    receipts.push(paid.document.id);
  }
  for (let i = 0; i < 12; i++) {
    nextDay();
    await api('POST', `/documents/${receipts[i * 6]}/credit`, { mode: 'full', reason: 'Refund', refundMethod: 'bank_transfer' });
  }

  // The switch to עוסק מורשה, then tax invoices, invoice receipts, receipts and credit invoices.
  nextDay();
  await api('POST', '/legal-mode/switch', { effectiveDate: clock.today, reason: 'Demo year' });
  const invoices: any[] = [];
  for (let i = 0; i < 100; i++) {
    nextDay();
    invoices.push(await issue('305', { clientId: pick(clients), lines: lines(4, 8) }));
    if (i % 2 === 1) {
      // An invoice receipt carries its payments, which must add up to its total with 18% VAT.
      const ls = lines(3, 6);
      const subtotal = ls.reduce((sum, l) => sum + (l.unitPriceMinor * l.quantityMilli) / 1000, 0);
      const total = subtotal + Math.round((subtotal * 1800) / 10000);
      await issue('320', { clientId: pick(clients), lines: ls, payments: payments(total, 3) });
      // A receipt for the invoice issued the day before.
      const inv = invoices[i - 1]!;
      await api('POST', `/documents/${inv.id}/record-payment`, { payments: payments(inv.total_minor, 5) });
    }
  }
  for (let i = 0; i < 15; i++) {
    nextDay();
    await api('POST', `/documents/${invoices[i * 6 + 1]!.id}/credit`, { mode: 'full', reason: 'Credit' });
  }

  const last = clock.today;
  vi.useRealTimers();
  const result = await buildUnifiedFile(env as unknown as Env, '2025-01-01', last, { drive: 'C' });
  let b64 = '';
  for (let i = 0; i < result.zip.length; i += 0x8000) b64 += String.fromCharCode(...result.zip.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  console.log(`@@SUMMARY@@${JSON.stringify({ summary: result.summary, report: result.report })}`);
  for (let i = 0; i < b64.length; i += 4000) console.log(`@@ZIP@@${b64.slice(i, i + 4000)}`);
}, 600_000);
