import { zipSync } from 'fflate';
import { all } from '../../../core/db';
import { convert } from '../../../core/money';
import type { Env } from '../../../env';
import { type ItaEnv, itaIdentity } from '../../ita/config';
import { encodeIso88598 } from '../encoding';
import type { ValidationReport } from '../types';
import { pendingAllocationCount, seriesSummaryForPeriod } from '../validation';
import {
  A000_FIELDS,
  A100_FIELDS,
  B110_FIELDS,
  C100_FIELDS,
  D110_FIELDS,
  D120_FIELDS,
  RECORD_LENGTH,
  SUMMARY_FIELDS,
  SYSTEM_CONSTANT,
  Z900_FIELDS,
  renderRecord,
} from './records';

/**
 * Unified file (מבנה אחיד), version 1.31 (specs/unified-file/). Builds INI.TXT and BKMVDATA.TXT
 * for the documents dated in a period, the section 5.4 summary screen and the section 2.6
 * per-document-type report.
 *
 * Scope. This is document-issuing software, not a general ledger or an inventory system, so
 * INI field 1013 (bookkeeping type) is 0 and the file carries A100, B110, C100, D110, D120 and
 * Z900. B110 holds one customer account per client the documents name, keyed by the client id
 * that C100 field 1225 carries. B100 and M100 are never written.
 *
 * Document numbers. Field 1204 must be unique per document type. Several Ledger series share one
 * appendix 1 code (a pro forma and a transaction invoice are both 300, the receipts before and
 * after the switch to עוסק מורשה and the credit receipts are all 400), and each series counts
 * from 1. So a document from a secondary series carries its series letters before the number,
 * as section 2.4 ד allows (up to 5 letters, for example CR12).
 *
 * Which documents. Every numbered document of a type in appendix 1, final or cancelled (a
 * cancelled one carries 1 in field 1228), cut by document date (section 2.1). Quotes and payment
 * requests have no code in appendix 1 and stay out. Tax invoices still waiting on an ITA
 * allocation number stay out until they finalize, with a warning.
 */

/** Ledger document type to the appendix 1 code. A credit receipt is a receipt with negative amounts. */
export const SPEC_CODE: Record<string, number> = {
  '300': 300,
  PF: 300,
  '332': 300,
  '305': 305,
  '320': 320,
  '330': 330,
  '400': 400,
  '405': 400,
};

/**
 * Series letters for field 1204, per Ledger series (section 2.4 ד). The main series of each code
 * (300 and 400) has none. A series missing here that shares a code gets its id's letters.
 */
export const SERIES_PREFIX: Record<string, string> = {
  PF: 'PF',
  '332': 'AP',
  '400-M': 'M',
  '405': 'CR',
};

/** The number written in fields 1204, 1257 and 1304 for a document of this series. */
export function fileDocNumber(seriesId: string, specCode: number, number: number): string {
  if (seriesId === String(specCode)) return String(number);
  const prefix = SERIES_PREFIX[seriesId] ?? seriesId.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5);
  return `${prefix || 'S'}${number}`;
}

/** Israeli ID and company number check digit (9 digits, weights 1 and 2). */
export function validIsraeliId(digits: string): boolean {
  if (!/^\d{9}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const n = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    sum += n > 9 ? n - 9 : n;
  }
  return sum % 10 === 0;
}

/** Appendix 1, section 5.1, plus 406 as in the Tax Authority's section 2.6 sample. Every row shows in the 2.6 report. */
export const APPENDIX_1: { code: number; nameHe: string; nameEn: string }[] = [
  { code: 100, nameHe: 'הזמנה', nameEn: 'Order' },
  { code: 200, nameHe: 'תעודת משלוח', nameEn: 'Delivery note' },
  { code: 205, nameHe: 'תעודת משלוח סוכן', nameEn: 'Agent delivery note' },
  { code: 210, nameHe: 'תעודת החזרה', nameEn: 'Return note' },
  { code: 300, nameHe: 'חשבונית/חשבונית עסקה', nameEn: 'Invoice / transaction invoice' },
  { code: 305, nameHe: 'חשבונית מס', nameEn: 'Tax invoice' },
  { code: 310, nameHe: 'חשבונית ריכוז', nameEn: 'Summary invoice' },
  { code: 320, nameHe: 'חשבונית מס / קבלה', nameEn: 'Tax invoice / receipt' },
  { code: 330, nameHe: 'חשבונית מס זיכוי', nameEn: 'Credit tax invoice' },
  { code: 340, nameHe: 'חשבונית שריון', nameEn: 'Reservation invoice' },
  { code: 345, nameHe: 'חשבונית סוכן', nameEn: 'Agent invoice' },
  { code: 400, nameHe: 'קבלה', nameEn: 'Receipt' },
  { code: 405, nameHe: 'קבלה על תרומות', nameEn: 'Donation receipt' },
  { code: 406, nameHe: 'קבלה על פקדון', nameEn: 'Deposit receipt' },
  { code: 410, nameHe: 'יציאה מקופה', nameEn: 'Cash withdrawal' },
  { code: 420, nameHe: 'הפקדת בנק', nameEn: 'Bank deposit' },
  { code: 500, nameHe: 'הזמנת רכש', nameEn: 'Purchase order' },
  { code: 600, nameHe: 'תעודת משלוח רכש', nameEn: 'Purchase delivery note' },
  { code: 610, nameHe: 'החזרת רכש', nameEn: 'Purchase return' },
  { code: 700, nameHe: 'חשבונית מס רכש', nameEn: 'Purchase tax invoice' },
  { code: 710, nameHe: 'זיכוי רכש', nameEn: 'Purchase credit' },
  { code: 800, nameHe: 'יתרת פתיחה', nameEn: 'Opening balance' },
  { code: 810, nameHe: 'כניסה כללית למלאי', nameEn: 'General stock in' },
  { code: 820, nameHe: 'יציאה כללית מהמלאי', nameEn: 'General stock out' },
  { code: 830, nameHe: 'העברה בין מחסנים', nameEn: 'Warehouse transfer' },
  { code: 840, nameHe: 'עדכון בעקבות ספירה', nameEn: 'Stock count update' },
  { code: 900, nameHe: 'דוח ייצור-כניסה', nameEn: 'Production in' },
  { code: 910, nameHe: 'דוח ייצור-יציאה', nameEn: 'Production out' },
];

/**
 * Record types in BKMVDATA.TXT, in file order. INI.TXT carries one summary row (section 3.2) for
 * each type the file holds, A100 and Z900 included, and none for a type with no records: the Tax
 * Authority's checker reported "no summary records" for zero-count rows of absent types.
 */
export const SUMMARY_RECORD_TYPES = ['A100', 'B100', 'B110', 'C100', 'D110', 'D120', 'M100', 'Z900'] as const;

/** Record types in BKMVDATA.TXT, with the Hebrew descriptions of appendix 4, for the 5.4 screen. */
export const RECORD_DESCRIPTIONS: { code: string; nameHe: string; nameEn: string }[] = [
  { code: 'A100', nameHe: 'רשומת פתיחה', nameEn: 'Opening record' },
  { code: 'B100', nameHe: 'תנועות בהנהלת חשבונות', nameEn: 'Bookkeeping entries' },
  { code: 'B110', nameHe: 'חשבון בהנהלת חשבונות', nameEn: 'Bookkeeping accounts' },
  { code: 'C100', nameHe: 'כותרת מסמך', nameEn: 'Document headers' },
  { code: 'D110', nameHe: 'פרטי מסמך', nameEn: 'Document lines' },
  { code: 'D120', nameHe: 'פרטי קבלות', nameEn: 'Receipt payments' },
  { code: 'M100', nameHe: 'פריטים במלאי', nameEn: 'Stock items' },
  { code: 'Z900', nameHe: 'רשומת סיום', nameEn: 'Closing record' },
];

/** Types that carry item lines (D110). A receipt carries payment lines only. */
const LINE_TYPES = new Set([300, 305, 320, 330]);
/** Types that carry payment lines (D120). */
const PAYMENT_TYPES = new Set([320, 400]);

interface DocRow {
  id: number;
  type: string;
  series_id: string;
  number: number;
  status: string;
  date: string;
  finalized_at: string | null;
  issuance_date: string | null;
  currency: string;
  fx_rate: string | null;
  subtotal_minor: number;
  vat_rate_bp: number | null;
  vat_amount_minor: number;
  total_minor: number;
  total_ils_minor: number | null;
  client_id: number | null;
  client_name_en: string | null;
  client_name_he: string | null;
  client_vat_number: string | null;
  client_company_id: string | null;
  client_country: string | null;
  client_phone: string | null;
  client_address_en: string | null;
  client_address_he: string | null;
  client_city: string | null;
  client_postal_code: string | null;
  user_email: string | null;
}

interface LineRow {
  document_id: number;
  position: number;
  item_id: number | null;
  description_en: string;
  description_he: string | null;
  quantity_milli: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
}

interface PaymentRow {
  id: number;
  document_id: number;
  method: string;
  method_type: string | null;
  paid_on: string;
  reference: string | null;
  amount_minor: number;
  currency: string;
  fx_rate: string | null;
  amount_ils_minor: number | null;
  bank_number: string | null;
  branch_number: string | null;
  account_number: string | null;
}

interface BaseRow {
  target_id: number;
  source_type: string;
  source_series_id: string;
  source_number: number | null;
}

export interface SoftwareInfo {
  name: string;
  version: string;
  registrationNumber: string;
  producerVat: string;
  producerName: string;
}

export interface OpenFormatSummary {
  vatNumber: string;
  businessName: string;
  mainId: string;
  /** The folder the files go in, for example C:\OPENFRMT\12345678.26\09291430. */
  path: string;
  from: string;
  to: string;
  generatedDate: string;
  generatedTime: string;
  software: SoftwareInfo;
  /** Section 5.4: records written per type. Only types with records. */
  records: { code: string; nameHe: string; nameEn: string; count: number }[];
  totalRecords: number;
  /** Section 2.6: per appendix 1 document type, the count and the total of field 1223 in shekels. */
  documentTypes: { code: number; nameHe: string; nameEn: string; count: number; totalIlsMinor: number }[];
}

export interface UnifiedFileResult {
  iniText: string;
  bkmvdata: string;
  zip: Uint8Array;
  report: ValidationReport;
  summary: OpenFormatSummary;
}

export interface BuildOptions {
  /** Drive letter the user extracts the files to, section 2.2. Default C. */
  drive?: string;
  /** Moment of the export. Default now. */
  now?: Date;
  /** 15-digit main id. Default random. */
  mainId?: string;
}

const toIls = (minor: number, currency: string, rate: string | null): number => (currency === 'ILS' || !rate ? minor : convert(minor, rate));

/** Israel wall-clock parts of a moment. */
export function israelParts(d: Date): { yyyy: string; mm: string; dd: string; hh: string; mi: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { yyyy: parts.year!, mm: parts.month!, dd: parts.day!, hh: parts.hour!, mi: parts.minute! };
}

const ymd = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).replaceAll('-', '') : '');

/** A 15-digit number, unique per export (clarification 2). */
export function randomMainId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const digits = Array.from(bytes, (b) => String(b % 10));
  if (digits[0] === '0') digits[0] = '1';
  return digits.join('');
}

/** Payment method to field 1306: 1 cash, 2 cheque, 3 credit card, 4 bank transfer, 9 other. */
export function paymentMethodCode(method: string, methodType: string | null): number {
  const m = methodType ?? method;
  if (m === 'cash') return 1;
  if (m === 'cheque') return 2;
  if (m === 'card') return 3;
  if (m === 'bank_transfer') return 4;
  return 9;
}

/**
 * Field 1215: an Israeli customer's VAT or company number, 9 digits with a valid check digit.
 * `invalid` is set when the client has a number that fails the check, so the export can say so.
 */
function customerVat(country: string | null, vat: string | null, companyId: string | null): { value: string; invalid: string | null } {
  if (country && country !== 'IL') return { value: '', invalid: null };
  let invalid: string | null = null;
  for (const v of [vat, companyId]) {
    const digits = (v ?? '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 9) continue;
    const padded = digits.padStart(9, '0');
    if (validIsraeliId(padded)) return { value: padded, invalid: null };
    invalid ??= padded;
  }
  return { value: '', invalid };
}

function countryName(code: string | null): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function softwareInfo(env: Env): SoftwareInfo {
  return {
    name: env.SOFTWARE_NAME || 'Open Ledger IL',
    version: env.SOFTWARE_VERSION || '1.0.0',
    registrationNumber: (env.SOFTWARE_REGISTRATION_NUMBER ?? '').replace(/\D/g, ''),
    producerVat: (env.SOFTWARE_PRODUCER_VAT ?? '').replace(/\D/g, ''),
    producerName: env.SOFTWARE_PRODUCER_NAME || 'MTN',
  };
}

async function business(env: Env, warnings: string[]): Promise<{ vat: string; name: string; street: string }> {
  const p = await env.DB.prepare('SELECT name_en, name_he, address_en, address_he, tax_id FROM business_profile WHERE id = 1').first<{
    name_en: string;
    name_he: string;
    address_en: string | null;
    address_he: string | null;
    tax_id: string | null;
  }>();
  let vat = (p?.tax_id ?? '').replace(/\D/g, '');
  if (!vat) {
    try {
      vat = itaIdentity(env as ItaEnv).vatNumber.replace(/\D/g, '');
    } catch {
      // handled below
    }
  }
  if (!vat) warnings.push('The business tax ID is missing. Add it in Settings > Business, then export again.');
  return {
    vat: vat.padStart(9, '0').slice(-9),
    name: p?.name_he || p?.name_en || '',
    street: (p?.address_he || p?.address_en || '').replace(/\s*\n\s*/g, ', '),
  };
}

async function loadDocs(db: D1Database, from: string, to: string): Promise<DocRow[]> {
  const types = Object.keys(SPEC_CODE);
  return all<DocRow>(
    db,
    `SELECT d.id, d.type, d.series_id, d.number, d.status, d.date, d.finalized_at, d.issuance_date, d.currency, d.fx_rate,
            d.subtotal_minor, d.vat_rate_bp, d.vat_amount_minor, d.total_minor, d.total_ils_minor, d.client_id,
            c.name_en AS client_name_en, c.name_he AS client_name_he, c.vat_number AS client_vat_number,
            c.company_id AS client_company_id, c.country AS client_country, c.phone AS client_phone,
            c.address_en AS client_address_en, c.address_he AS client_address_he, c.city AS client_city,
            c.postal_code AS client_postal_code, u.email AS user_email
     FROM documents d
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.type IN (${types.map(() => '?').join(',')})
       AND d.number IS NOT NULL AND d.status IN ('final', 'cancelled') AND d.date BETWEEN ? AND ?
     ORDER BY d.date, d.series_id, d.number`,
    ...types,
    from,
    to,
  );
}

async function byDocument<T extends { document_id: number }>(db: D1Database, sql: string, ids: number[]): Promise<Map<number, T[]>> {
  const out = new Map<number, T[]>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const rows = await all<T>(db, sql.replace('(?)', `(${chunk.map(() => '?').join(',')})`), ...chunk);
    for (const r of rows) out.set(r.document_id, [...(out.get(r.document_id) ?? []), r]);
  }
  return out;
}

async function loadBases(db: D1Database, ids: number[]): Promise<Map<number, BaseRow>> {
  const out = new Map<number, BaseRow>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const rows = await all<BaseRow>(
      db,
      `SELECT l.target_id, s.type AS source_type, s.series_id AS source_series_id, s.number AS source_number
       FROM document_links l JOIN documents s ON s.id = l.source_id
       WHERE l.kind IN ('converted', 'credit') AND l.target_id IN (${chunk.map(() => '?').join(',')})
       ORDER BY l.id`,
      ...chunk,
    );
    for (const r of rows) if (!out.has(r.target_id) && SPEC_CODE[r.source_type] && r.source_number !== null) out.set(r.target_id, r);
  }
  return out;
}

/** Builds the unified file for documents dated in [from, to]. */
export async function buildUnifiedFile(env: Env, from: string, to: string, options: BuildOptions = {}): Promise<UnifiedFileResult> {
  const db = env.DB;
  const warnings: string[] = [];
  const now = options.now ?? new Date();
  const at = israelParts(now);
  const mainId = options.mainId ?? randomMainId();
  const drive = (options.drive ?? 'C').toUpperCase().slice(0, 1);
  const software = softwareInfo(env);
  if (!software.registrationNumber) warnings.push('No software registration number yet. The registration field in INI.TXT reads 00000000 until the Tax Authority issues one.');

  const biz = await business(env, warnings);
  // The producer is the business itself when no separate software house is configured.
  if (!software.producerVat) software.producerVat = biz.vat;
  const folder = `${biz.vat.slice(0, 8)}.${at.yyyy.slice(2)}`;
  const stamp = `${at.mm}${at.dd}${at.hh}${at.mi}`;
  const path = `${drive}:\\OPENFRMT\\${folder}\\${stamp}`;

  const docs = await loadDocs(db, from, to);
  const ids = docs.map((d) => d.id);
  const lines = await byDocument<LineRow>(
    db,
    `SELECT document_id, position, item_id, description_en, description_he, quantity_milli, unit_price_minor, discount_minor, line_total_minor
     FROM document_lines WHERE document_id IN (?) ORDER BY document_id, position`,
    ids,
  );
  const payments = await byDocument<PaymentRow>(
    db,
    `SELECT p.id, p.document_id, p.method, pm.type AS method_type, p.paid_on, p.reference, p.amount_minor, p.currency, p.fx_rate, p.amount_ils_minor,
            pd.bank_number, pd.branch_number, pd.account_number
     FROM payments p LEFT JOIN payment_methods pm ON pm.id = p.method_id LEFT JOIN payment_details pd ON pd.payment_id = p.id
     WHERE p.document_id IN (?) ORDER BY p.document_id, p.id`,
    ids,
  );
  const bases = await loadBases(db, ids);

  const records: string[] = [];
  const counts: Record<string, number> = {};
  const push = (code: string, line: string) => {
    records.push(line);
    counts[code] = (counts[code] ?? 0) + 1;
  };
  const seq = () => records.length + 1;

  push('A100', renderRecord(A100_FIELDS, { 1100: 'A100', 1101: seq(), 1102: biz.vat, 1103: mainId, 1104: SYSTEM_CONSTANT }, RECORD_LENGTH.A100));

  // A credit tax invoice (330) is a reduction by its type, so it is written positive
  // (section 2.4 יב). A Ledger credit receipt (405) has no code of its own and goes out as a
  // receipt with negative amounts (appendix 1: a negative document has the opposite effect).
  const flipOf = (d: DocRow) => (d.type === '330' ? -1 : 1);
  const totalOf = (d: DocRow) => flipOf(d) * (d.total_ils_minor ?? toIls(d.total_minor, d.currency, d.fx_rate));

  // B110: one customer account per client, with the period's charges (debit) and payments and
  // credits (credit). No opening balance: the software keeps no ledger before the period.
  const accounts = new Map<number, { doc: DocRow; debit: number; credit: number }>();
  for (const d of docs) {
    if (!d.client_id || d.status === 'cancelled') {
      if (d.client_id && !accounts.has(d.client_id)) accounts.set(d.client_id, { doc: d, debit: 0, credit: 0 });
      continue;
    }
    const a = accounts.get(d.client_id) ?? { doc: d, debit: 0, credit: 0 };
    const code = SPEC_CODE[d.type]!;
    const total = totalOf(d);
    // A pro forma is no charge. Transaction invoices, tax invoices and invoice receipts are.
    if (d.type !== 'PF' && (code === 300 || code === 305 || code === 320)) a.debit += total;
    if (code === 320 || code === 400 || code === 330) a.credit += total;
    accounts.set(d.client_id, a);
  }
  const invalidVat = new Set<string>();
  for (const [clientId, a] of [...accounts].sort((x, y) => x[0] - y[0])) {
    const d = a.doc;
    const vat = customerVat(d.client_country, d.client_vat_number, d.client_company_id);
    push(
      'B110',
      renderRecord(
        B110_FIELDS,
        {
          1400: 'B110',
          1401: seq(),
          1402: biz.vat,
          1403: String(clientId),
          1404: d.client_name_he || d.client_name_en || '',
          1405: 'לקוחות',
          1406: 'לקוחות',
          1407: (d.client_address_he || d.client_address_en || '').replace(/\s*\n\s*/g, ', '),
          1409: d.client_city ?? '',
          1410: d.client_postal_code ?? '',
          1411: countryName(d.client_country),
          1412: d.client_country ?? '',
          1414: 0,
          1415: a.debit,
          1416: a.credit,
          1417: 0,
          1419: vat.value,
          1422: 0,
        },
        RECORD_LENGTH.B110,
      ),
    );
  }

  const perType = new Map<number, { count: number; totalIlsMinor: number }>();
  let totalIlsMinor = 0;
  const seen = new Set<string>();

  for (const d of docs) {
    const code = SPEC_CODE[d.type]!;
    const flip = flipOf(d);
    const receiptOnly = code === 400;
    const total = totalOf(d);
    const subtotal = receiptOnly ? total : flip * toIls(d.subtotal_minor, d.currency, d.fx_rate);
    const vat = receiptOnly ? 0 : flip * toIls(d.vat_amount_minor, d.currency, d.fx_rate);
    const issued = d.finalized_at ? israelParts(new Date(d.finalized_at)) : null;
    const foreign = d.currency !== 'ILS';
    const docNumber = fileDocNumber(d.series_id, code, d.number);
    const key = `${code}/${docNumber}`;
    if (seen.has(key)) warnings.push(`Two documents of type ${code} carry number ${docNumber}. Field 1204 must be unique per type.`);
    seen.add(key);
    const customer = customerVat(d.client_country, d.client_vat_number, d.client_company_id);
    if (customer.invalid && !invalidVat.has(customer.invalid)) {
      invalidVat.add(customer.invalid);
      warnings.push(`Client "${d.client_name_he || d.client_name_en}" has VAT number ${customer.invalid}, which fails the check digit. It is left out of the file. Fix it in Clients.`);
    }
    const link = d.id % 10_000_000;

    push(
      'C100',
      renderRecord(
        C100_FIELDS,
        {
          1200: 'C100',
          1201: seq(),
          1202: biz.vat,
          1203: code,
          1204: docNumber,
          1205: issued ? `${issued.yyyy}${issued.mm}${issued.dd}` : ymd(d.issuance_date ?? d.date),
          1206: issued ? `${issued.hh}${issued.mi}` : '',
          1207: d.client_name_he || d.client_name_en || '',
          1208: (d.client_address_he || d.client_address_en || '').replace(/\s*\n\s*/g, ', '),
          1210: d.client_city ?? '',
          1211: d.client_postal_code ?? '',
          1212: countryName(d.client_country),
          1213: d.client_country ?? '',
          1214: d.client_phone ?? '',
          1215: customer.value,
          1216: ymd(d.date),
          1217: foreign ? flip * d.total_minor : 0,
          1218: foreign ? d.currency : '',
          1219: subtotal,
          1220: 0,
          1221: subtotal,
          1222: vat,
          1223: total,
          1224: 0,
          1225: d.client_id ? String(d.client_id) : '',
          1228: d.status === 'cancelled' ? '1' : '',
          1230: ymd(d.date),
          1233: (d.user_email ?? '').split('@')[0] ?? '',
          1234: link,
        },
        RECORD_LENGTH.C100,
      ),
    );
    const t = perType.get(code) ?? { count: 0, totalIlsMinor: 0 };
    t.count += 1;
    t.totalIlsMinor += total;
    perType.set(code, t);
    totalIlsMinor += total;

    if (LINE_TYPES.has(code)) {
      const base = bases.get(d.id);
      for (const l of lines.get(d.id) ?? []) {
        const unit = toIls(l.unit_price_minor, d.currency, d.fx_rate);
        const discount = toIls(l.discount_minor, d.currency, d.fx_rate);
        push(
          'D110',
          renderRecord(
            D110_FIELDS,
            {
              1250: 'D110',
              1251: seq(),
              1252: biz.vat,
              1253: code,
              1254: docNumber,
              1255: l.position,
              1256: base ? SPEC_CODE[base.source_type] : 0,
              1257: base ? fileDocNumber(base.source_series_id, SPEC_CODE[base.source_type]!, base.source_number!) : '',
              1258: 1,
              1259: l.item_id ? String(l.item_id) : '',
              1260: l.description_he || l.description_en,
              1263: 'יחידה',
              1264: l.quantity_milli * 10,
              1265: Math.abs(unit),
              1266: -Math.abs(discount),
              1267: flip * toIls(l.line_total_minor, d.currency, d.fx_rate),
              1268: d.vat_rate_bp ?? 0,
              1272: ymd(d.date),
              1273: link,
            },
            RECORD_LENGTH.D110,
          ),
        );
      }
    }

    if (PAYMENT_TYPES.has(code)) {
      const rows = payments.get(d.id) ?? [];
      const paymentLines =
        rows.length > 0
          ? rows.map((p) => ({
              method: paymentMethodCode(p.method, p.method_type),
              date: p.paid_on,
              reference: p.reference,
              bank: p.bank_number,
              branch: p.branch_number,
              account: p.account_number,
              // A payment follows its document's sign, so a credit receipt's lines are negative too.
              amount: (total < 0 ? -1 : 1) * Math.abs(p.amount_ils_minor ?? toIls(p.amount_minor, p.currency, p.fx_rate)),
            }))
          : [{ method: 9, date: d.date, reference: null as string | null, bank: null as string | null, branch: null as string | null, account: null as string | null, amount: total }];
      paymentLines.forEach((p, i) => {
        const cheque = p.method === 2;
        const chequeNo = cheque && p.reference && /^\d{1,10}$/.test(p.reference.trim()) ? p.reference.trim() : '';
        if (cheque && (!p.bank || !p.branch || !p.account)) {
          warnings.push(`A cheque on document ${code} ${docNumber} has no bank, branch or account number. The unified file requires all three.`);
        }
        push(
          'D120',
          renderRecord(
            D120_FIELDS,
            {
              1300: 'D120',
              1301: seq(),
              1302: biz.vat,
              1303: code,
              1304: docNumber,
              1305: i + 1,
              1306: p.method,
              1307: cheque ? (p.bank ?? '') : '',
              1308: cheque ? (p.branch ?? '') : '',
              1309: cheque ? (p.account ?? '') : '',
              1310: chequeNo,
              1311: p.method === 2 || p.method === 3 ? ymd(p.date) : '',
              1312: p.amount,
              1315: p.method === 3 ? 1 : 0,
              1322: ymd(d.date),
              1323: link,
            },
            RECORD_LENGTH.D120,
          ),
        );
      });
    }
  }

  const totalRecords = records.length + 1;
  push(
    'Z900',
    renderRecord(Z900_FIELDS, { 1150: 'Z900', 1151: seq(), 1152: biz.vat, 1153: mainId, 1154: SYSTEM_CONSTANT, 1155: totalRecords }, RECORD_LENGTH.Z900),
  );

  const iniLines = [
    renderRecord(
      A000_FIELDS,
      {
        1000: 'A000',
        1002: totalRecords,
        1003: biz.vat,
        1004: mainId,
        1005: SYSTEM_CONSTANT,
        [1000 + 6]: software.registrationNumber,
        [1000 + 7]: software.name,
        [1000 + 8]: software.version,
        1009: software.producerVat,
        1010: software.producerName,
        1011: 2,
        1012: path,
        1013: 0,
        1014: 0,
        1018: biz.name,
        1019: biz.street,
        1023: 0,
        1024: ymd(from),
        1025: ymd(to),
        1026: `${at.yyyy}${at.mm}${at.dd}`,
        1027: `${at.hh}${at.mi}`,
        1028: 0,
        1029: 1,
        1030: 'ZIP',
        1032: 'ILS',
        1034: 0,
      },
      RECORD_LENGTH.A000,
    ),
    ...SUMMARY_RECORD_TYPES.filter((code) => (counts[code] ?? 0) > 0).map((code) =>
      renderRecord(SUMMARY_FIELDS, { 1050: code, 1051: counts[code] }, RECORD_LENGTH.SUMMARY),
    ),
  ];

  const iniText = iniLines.join('\r\n') + '\r\n';
  const bkmvdata = records.join('\r\n') + '\r\n';

  const ini = encodeIso88598(iniText);
  const data = encodeIso88598(bkmvdata);
  if (ini.lossy || data.lossy) warnings.push('Some characters have no ISO-8859-8 form and were written as "?". Check names and descriptions in other scripts.');

  const innerZip = zipSync({ 'BKMVDATA.TXT': data.bytes }, { level: 6 });
  const dir = `OPENFRMT/${folder}/${stamp}`;
  const zip = zipSync({ [`${dir}/INI.TXT`]: ini.bytes, [`${dir}/BKMVDATA.zip`]: innerZip }, { level: 0 });

  const pending = await pendingAllocationCount(db, from, to);
  if (pending > 0) warnings.push(`${pending} tax invoice(s) dated in this period still wait for an ITA allocation number and are not in the file.`);

  const summary: OpenFormatSummary = {
    vatNumber: biz.vat,
    businessName: biz.name,
    mainId,
    path,
    from,
    to,
    generatedDate: `${at.dd}/${at.mm}/${at.yyyy.slice(2)}`,
    generatedTime: `${at.hh}:${at.mi}`,
    software,
    records: RECORD_DESCRIPTIONS.filter((r) => (counts[r.code] ?? 0) > 0).map((r) => ({ ...r, count: counts[r.code]! })),
    totalRecords,
    documentTypes: APPENDIX_1.map((t) => ({ ...t, count: perType.get(t.code)?.count ?? 0, totalIlsMinor: perType.get(t.code)?.totalIlsMinor ?? 0 })),
  };

  const report: ValidationReport = {
    from,
    to,
    recordCounts: counts,
    totalRecords,
    totalIlsMinor,
    series: await seriesSummaryForPeriod(db, from, to),
    warnings,
    layoutStatus: 'verified',
  };

  return { iniText, bkmvdata, zip, report, summary };
}

/** The business the file is for, shown in the export dialog before a run (appendix 4). */
export async function businessIdentity(env: Env): Promise<{ vatNumber: string; name: string; warnings: string[] }> {
  const warnings: string[] = [];
  const b = await business(env, warnings);
  return { vatNumber: b.vat, name: b.name, warnings };
}
