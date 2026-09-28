import { all } from '../../../core/db';
import { assertCurrency, convert } from '../../../core/money';
import { needsAllocation } from '../../documents/allocation';
import type { Env } from '../../../env';
import { customerVatFor } from '../../ita/documents';
import { loadDocTypeCodes, resolveDocTypeCode } from '../codes';
import { blank, padDate, padNumeric, padSignedMinor, renderLine } from '../fixed-width';
import type { ValidationReport } from '../types';
import { pendingAllocationCount, seriesSummaryForPeriod } from '../validation';

/**
 * PCN874 (the detailed VAT transaction report): one row per final מורשה tax-invoice-family
 * document in the period (305, 320, 330, 332: R11's `document_types.modes = 'murshe'` rows,
 * migrations/1100_murshe.sql), carrying the 9-digit allocation number in its own column
 * (docs/israel-invoices-api.md section 10: "each tax-invoice row carries the short allocation
 * number...in the new N(9) field"). 330 (credit tax invoice) reports with a negative amount: its
 * `subtotal_minor`/`vat_amount_minor`/`total_minor` already come out of
 * `documents/service.ts`'s `creditDocument`/`compute()` as negative (confirmed against a real
 * credit through the API, not assumed), the same raw value `documents/balances.ts` sums with no
 * extra sign flip, so this file applies none either. 330 never carries an allocation number
 * itself (docs/israel-invoices-api.md section 1, "Outside the rule"): its row's allocation column
 * is correctly blank, not missing.
 *
 * STUB LAYOUT beyond the allocation-number column. The rest of the row order and widths are
 * placeholders: docs/open-questions.md marks PCN874 filing itself as open (A7, turnover threshold
 * and filing frequency undecided), and the ITA's own detailed-report column layout lives in the
 * same missing spec PDF as the unified file (specs/unified-file/). Confirm both before filing.
 */
export const STUB_NOTICE =
  'STUB LAYOUT: only the allocation-number column (9 digits) is spec-confirmed (docs/israel-invoices-api.md section 10). Row order, widths and whether a business must file PCN874 at all remain open.';

const RECORD_CODE = 'R874';
const CODE_WIDTH = 4;
const SEQ_WIDTH = 9;
const DOC_TYPE_WIDTH = 4;
const DOC_NUMBER_WIDTH = 9;
const DATE_WIDTH = 8;
const VAT_WIDTH = 9;
const AMOUNT_WIDTH = 15;
const ALLOCATION_WIDTH = 9;

interface TaxInvoiceRow {
  id: number;
  type: string;
  number: number;
  date: string;
  currency: string;
  fx_rate: string | null;
  subtotal_minor: number;
  vat_amount_minor: number;
  total_ils_minor: number | null;
  total_minor: number;
  client_vat_number: string | null;
  client_company_id: string | null;
  client_foreign_resident: number;
  short_number: string | null;
}

/**
 * Every מורשה bookkeeping document (305, 320, 330, 332), not a hardcoded type list: R11 opens no
 * other type in that mode, so `modes = 'murshe'` is exactly that set and stays correct if R11 or a
 * later run adds one (310, 345: docs/israel-invoices-api.md section 1 names both as unused here).
 */
async function loadTaxInvoices(db: D1Database, from: string, to: string): Promise<TaxInvoiceRow[]> {
  return all<TaxInvoiceRow>(
    db,
    `SELECT d.id, d.type, d.number, d.date, d.currency, d.fx_rate, d.subtotal_minor, d.vat_amount_minor,
            d.total_minor, d.total_ils_minor,
            c.vat_number AS client_vat_number, c.company_id AS client_company_id, c.foreign_resident AS client_foreign_resident,
            a.short_number AS short_number
     FROM documents d
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN clients c ON c.id = d.client_id
     LEFT JOIN ita_allocations a ON a.document_id = d.id AND a.status = 'approved'
     WHERE dt.modes = 'murshe' AND dt.bookkeeping = 1 AND d.status = 'final' AND d.number IS NOT NULL
       AND d.date BETWEEN ? AND ?
     ORDER BY d.series_id, d.number`,
    from,
    to,
  );
}

function toIls(amountMinor: number, currency: string, fxRate: string | null): number {
  return currency === 'ILS' || !fxRate ? amountMinor : convert(amountMinor, fxRate);
}

export function buildPcn874Row(input: {
  seq: number;
  specDocType: string;
  documentNumber: number;
  date: string;
  customerVatNumber: string;
  subtotalIlsMinor: number;
  vatIlsMinor: number;
  allocationShortNumber: string | null;
}): string {
  return renderLine([
    { value: RECORD_CODE, width: CODE_WIDTH },
    { value: padNumeric(input.seq, SEQ_WIDTH), width: SEQ_WIDTH },
    { value: input.specDocType.padEnd(DOC_TYPE_WIDTH, ' ').slice(0, DOC_TYPE_WIDTH), width: DOC_TYPE_WIDTH },
    { value: padNumeric(input.documentNumber, DOC_NUMBER_WIDTH), width: DOC_NUMBER_WIDTH },
    { value: padDate(input.date), width: DATE_WIDTH },
    { value: input.customerVatNumber.padStart(VAT_WIDTH, '0').slice(0, VAT_WIDTH), width: VAT_WIDTH },
    { value: padSignedMinor(input.subtotalIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    { value: padSignedMinor(input.vatIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    {
      value: input.allocationShortNumber ? padNumeric(Number(input.allocationShortNumber), ALLOCATION_WIDTH) : blank(ALLOCATION_WIDTH),
      width: ALLOCATION_WIDTH,
    },
  ]);
}

export interface Pcn874Result {
  text: string;
  report: ValidationReport;
}

export async function buildPcn874(env: Env, from: string, to: string): Promise<Pcn874Result> {
  const db = env.DB;
  const warnings: string[] = [STUB_NOTICE];
  const codes = await loadDocTypeCodes(db);
  const invoices = await loadTaxInvoices(db, from, to);

  const unconfirmedTypes = new Set<string>();
  const rows: string[] = [];
  let totalIlsMinor = 0;
  let seq = 0;
  let missingAllocation = 0;

  for (const inv of invoices) {
    const resolved = resolveDocTypeCode(inv.type, codes);
    if (!resolved.confirmed) unconfirmedTypes.add(inv.type);
    const subtotalIls = toIls(inv.subtotal_minor, inv.currency, inv.fx_rate);
    const vatIls = toIls(inv.vat_amount_minor, inv.currency, inv.fx_rate);
    const totalIls = inv.total_ils_minor ?? toIls(inv.total_minor, inv.currency, inv.fx_rate);
    totalIlsMinor += totalIls;
    seq += 1;

    if (!inv.short_number) {
      const stillNeedsOne = await needsAllocation(
        db,
        {
          type: inv.type,
          date: inv.date,
          subtotalMinor: inv.subtotal_minor,
          vatAmountMinor: inv.vat_amount_minor,
          currency: assertCurrency(inv.currency),
          fxRate: inv.fx_rate,
        },
        { foreignResident: inv.client_foreign_resident === 1, vatNumber: inv.client_vat_number, companyId: inv.client_company_id },
      );
      if (stillNeedsOne) missingAllocation += 1;
    }

    rows.push(
      buildPcn874Row({
        seq,
        specDocType: resolved.code,
        documentNumber: inv.number,
        date: inv.date,
        customerVatNumber: customerVatFor(inv.client_vat_number, inv.client_company_id),
        subtotalIlsMinor: subtotalIls,
        vatIlsMinor: vatIls,
        allocationShortNumber: inv.short_number,
      }),
    );
  }

  if (unconfirmedTypes.size > 0) {
    warnings.push(`Document type code not confirmed against the ITA spec for: ${[...unconfirmedTypes].sort().join(', ')}.`);
  }
  if (missingAllocation > 0) {
    warnings.push(`${missingAllocation} row(s) qualify for an ITA allocation number (docs/israel-invoices-api.md section 1) but do not have one yet.`);
  }
  const pending = await pendingAllocationCount(db, from, to);
  if (pending > 0) {
    warnings.push(`${pending} tax-invoice-family document(s) dated in this period are still awaiting an ITA allocation decision (status awaiting_allocation, allocation_pending or allocation_refused) and are not included until they finalize (CLAUDE.md rule 3).`);
  }

  const series = await seriesSummaryForPeriod(db, from, to);
  const report: ValidationReport = {
    from,
    to,
    recordCounts: { [RECORD_CODE]: rows.length },
    totalRecords: rows.length,
    totalIlsMinor,
    series,
    warnings,
    layoutStatus: 'stub',
  };

  return { text: rows.length > 0 ? rows.join('\r\n') + '\r\n' : '', report };
}
