import { zipSync } from 'fflate';
import { all } from '../../../core/db';
import { convert } from '../../../core/money';
import type { Env } from '../../../env';
import { encodeWindows1255 } from '../encoding';
import { padNumeric } from '../fixed-width';
import { customerVatFor } from '../../ita/documents';
import { loadDocTypeCodes, resolveDocTypeCode } from '../codes';
import { type ItaEnv, itaIdentity } from '../../ita/config';
import type { ValidationReport } from '../types';
import { pendingAllocationCount, seriesSummaryForPeriod } from '../validation';
import {
  type DocumentHeaderInput,
  type DocumentLineInput,
  type FileHeaderInput,
  type PurchaseInput,
  STUB_NOTICE,
  buildA000,
  buildA100,
  buildB110,
  buildC100,
  buildD110,
  buildZ900,
} from './records';

interface SaleDocRow {
  id: number;
  type: string;
  number: number;
  date: string;
  currency: string;
  fx_rate: string | null;
  subtotal_minor: number;
  vat_amount_minor: number;
  total_minor: number;
  total_ils_minor: number | null;
  client_vat_number: string | null;
  client_company_id: string | null;
  short_number: string | null;
}

interface LineRow {
  document_id: number;
  position: number;
  description_en: string;
  line_total_minor: number;
}

interface ExpenseRow {
  id: number;
  document_date: string;
  currency: string;
  fx_rate: string | null;
  amount_minor: number;
  vat_amount_minor: number;
  amount_ils_minor: number | null;
  supplier_vat_number: string | null;
  allocation_number: string | null;
}

/**
 * Every final, numbered bookkeeping document, both legal modes at once: 300/400/405 (פטור) and,
 * since R11 (migrations/1100_murshe.sql), 305/320/330/332 (מורשה) the moment they finalize and
 * carry a real number, with no change needed here since the filter is `document_types.bookkeeping`
 * rather than a type list. A credit's own `subtotal_minor`/`vat_amount_minor`/`total_minor` (405,
 * 330) already come out of `documents/service.ts`'s `compute()` as negative (confirmed against a
 * real 330 through the API, not assumed) and net correctly against the sale they reverse with no
 * extra sign flip here, the same raw value `documents/balances.ts` already sums as-is.
 */
async function loadSaleDocs(db: D1Database, from: string, to: string): Promise<SaleDocRow[]> {
  return all<SaleDocRow>(
    db,
    `SELECT d.id, d.type, d.number, d.date, d.currency, d.fx_rate, d.subtotal_minor, d.vat_amount_minor,
            d.total_minor, d.total_ils_minor,
            c.vat_number AS client_vat_number, c.company_id AS client_company_id,
            a.short_number AS short_number
     FROM documents d
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN ita_allocations a ON a.document_id = d.id AND a.status = 'approved'
     WHERE dt.bookkeeping = 1 AND d.status = 'final' AND d.number IS NOT NULL AND d.date BETWEEN ? AND ?
     ORDER BY d.series_id, d.number`,
    from,
    to,
  );
}

async function loadLines(db: D1Database, documentIds: number[]): Promise<LineRow[]> {
  if (documentIds.length === 0) return [];
  const placeholders = documentIds.map(() => '?').join(',');
  return all<LineRow>(
    db,
    `SELECT document_id, position, description_en, line_total_minor FROM document_lines
     WHERE document_id IN (${placeholders}) ORDER BY document_id, position`,
    ...documentIds,
  );
}

async function loadExpenses(db: D1Database, from: string, to: string): Promise<ExpenseRow[]> {
  return all<ExpenseRow>(
    db,
    `SELECT e.id, e.document_date, e.currency, e.fx_rate, e.amount_minor, e.vat_amount_minor, e.amount_ils_minor,
            s.tax_id AS supplier_vat_number, e.allocation_number
     FROM expenses e
     LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.status = 'filed' AND e.document_date BETWEEN ? AND ?
     ORDER BY e.document_date, e.id`,
    from,
    to,
  );
}

function toIls(amountMinor: number, currency: string, fxRate: string | null): number {
  return currency === 'ILS' || !fxRate ? amountMinor : convert(amountMinor, fxRate);
}

async function fileHeader(env: Env, db: D1Database, from: string, to: string, createdOn: string): Promise<{ header: FileHeaderInput; warnings: string[] }> {
  const warnings: string[] = [];
  const profile = await db.prepare('SELECT name_en FROM business_profile WHERE id = 1').first<{ name_en: string }>();
  let vatNumber = '000000000';
  try {
    vatNumber = itaIdentity(env as ItaEnv).vatNumber;
  } catch {
    warnings.push('No ITA business VAT number is configured (ITA_VAT_NUMBER / OWNER_TAX_ID secret). Used a placeholder in A000/A100.');
  }
  return { header: { businessVatNumber: vatNumber, businessNameEn: profile?.name_en ?? '', fileCreatedOn: createdOn, periodFrom: from, periodTo: to }, warnings };
}

export interface UnifiedFileResult {
  iniText: string;
  bkmvdata: string;
  zip: Uint8Array;
  report: ValidationReport;
}

/** Builds INI.TXT and BKMVDATA.TXT for a period, zipped under OPENFRMT/ (runs/R13-exports.md). */
export async function buildUnifiedFile(env: Env, from: string, to: string, generatedOn: string): Promise<UnifiedFileResult> {
  const db = env.DB;
  const warnings: string[] = [STUB_NOTICE];
  const codes = await loadDocTypeCodes(db);

  const { header, warnings: headerWarnings } = await fileHeader(env, db, from, to, generatedOn);
  warnings.push(...headerWarnings);

  const docs = await loadSaleDocs(db, from, to);
  const lines = await loadLines(db, docs.map((d) => d.id));
  const linesByDoc = new Map<number, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.document_id) ?? [];
    arr.push(l);
    linesByDoc.set(l.document_id, arr);
  }
  const expenses = await loadExpenses(db, from, to);

  const unconfirmedTypes = new Set<string>();
  const records: string[] = [buildA000(header), buildA100(header)];
  let totalIlsMinor = 0;
  let seq = 0;
  let lineSeq = 0;

  for (const d of docs) {
    const resolved = resolveDocTypeCode(d.type, codes);
    if (!resolved.confirmed) unconfirmedTypes.add(d.type);
    const subtotalIls = toIls(d.subtotal_minor, d.currency, d.fx_rate);
    const vatIls = toIls(d.vat_amount_minor, d.currency, d.fx_rate);
    const totalIls = d.total_ils_minor ?? toIls(d.total_minor, d.currency, d.fx_rate);
    totalIlsMinor += totalIls;
    seq += 1;
    const docSeq = seq;
    const header100: DocumentHeaderInput = {
      seq: docSeq,
      specDocType: resolved.code,
      documentNumber: d.number,
      date: d.date,
      clientVatNumber: customerVatFor(d.client_vat_number, d.client_company_id),
      subtotalIlsMinor: subtotalIls,
      vatIlsMinor: vatIls,
      totalIlsMinor: totalIls,
      allocationShortNumber: d.short_number,
    };
    records.push(buildC100(header100));
    for (const l of linesByDoc.get(d.id) ?? []) {
      lineSeq += 1;
      const lineInput: DocumentLineInput = {
        seq: lineSeq,
        documentSeq: docSeq,
        position: l.position,
        description: l.description_en,
        lineTotalIlsMinor: toIls(l.line_total_minor, d.currency, d.fx_rate),
      };
      records.push(buildD110(lineInput));
    }
  }

  let purchaseSeq = 0;
  for (const e of expenses) {
    purchaseSeq += 1;
    const amountIls = e.amount_ils_minor ?? toIls(e.amount_minor, e.currency, e.fx_rate);
    const vatIls = toIls(e.vat_amount_minor, e.currency, e.fx_rate);
    const input: PurchaseInput = {
      seq: purchaseSeq,
      supplierVatNumber: e.supplier_vat_number ?? '000000000',
      date: e.document_date,
      amountIlsMinor: amountIls,
      vatIlsMinor: vatIls,
      allocationShortNumber: e.allocation_number && /^\d{9}$/.test(e.allocation_number) ? e.allocation_number : null,
    };
    records.push(buildB110(input));
  }

  records.push(buildZ900(records.length + 1));

  if (unconfirmedTypes.size > 0) {
    warnings.push(
      `Document type code not confirmed against the ITA spec for: ${[...unconfirmedTypes].sort().join(', ')}. Used the internal code as a placeholder in C100 (see unified_file_doc_type_codes).`,
    );
  }
  const pending = await pendingAllocationCount(db, from, to);
  if (pending > 0) {
    warnings.push(`${pending} tax-invoice-family document(s) dated in this period are still awaiting an ITA allocation decision and are not included until they finalize (CLAUDE.md rule 3).`);
  }

  const bkmvdata = records.join('\r\n') + '\r\n';
  const recordCounts: Record<string, number> = {};
  for (const line of records) {
    const code = line.slice(0, 4);
    recordCounts[code] = (recordCounts[code] ?? 0) + 1;
  }
  const iniLines = [
    `INI ${padNumeric(records.length, 9)}${header.businessVatNumber}${header.fileCreatedOn.replaceAll('-', '')}`,
    ...Object.entries(recordCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}${padNumeric(count, 9)}`),
  ];
  const iniText = iniLines.join('\r\n') + '\r\n';

  const series = await seriesSummaryForPeriod(db, from, to);
  const report: ValidationReport = {
    from,
    to,
    recordCounts,
    totalRecords: records.length,
    totalIlsMinor,
    series,
    warnings,
    layoutStatus: 'stub',
  };

  const zip = zipSync(
    {
      'OPENFRMT/INI.TXT': encodeWindows1255(iniText).bytes,
      'OPENFRMT/BKMVDATA.TXT': encodeWindows1255(bkmvdata).bytes,
    },
    { level: 6 },
  );

  return { iniText, bkmvdata, zip, report };
}
