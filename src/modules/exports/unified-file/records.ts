import { blank, padAlpha, padDate, padNumeric, padSignedMinor, renderLine } from '../fixed-width';

/**
 * Unified-file (מבנה אחיד) record builders: A000 (opening), A100 (business header), C100
 * (document header), D110 (document line), B110 (purchase transaction), Z900 (closing).
 *
 * STUB LAYOUT. specs/unified-file/ holds only a README placeholder (see its contents and
 * migrations/1300_exports.sql): the ITA's record-layout PDF was never dropped in before this
 * run. runs/R13-exports.md and CLAUDE.md rule 3 both say never guess a code or a layout, so the
 * field order and widths below are placeholders that make the record counts, padding and
 * encoding mechanics testable end to end. They are not the real ITA column positions. Before
 * filing anything built with this module, replace every width constant and field list in this
 * file from the spec PDF's record-layout tables.
 *
 * Record types this run does not emit, and why:
 * - D120 (ledger balances) and M100 (inventory items): Open Ledger IL keeps no general ledger or
 *   inventory; there is nothing to report in either record. Revisit if that changes.
 * - B100 (revenue transactions): the spec's invoicing-software path reports sales through C100
 *   (document header) plus D110 (document lines) instead. Confirm that reading against the real
 *   spec once it is available; wire up B100 if the spec expects it in addition.
 */
export const STUB_NOTICE =
  'STUB LAYOUT: field order and widths are placeholders for testing padding, encoding and record-count mechanics only, not the verified ITA column positions. specs/unified-file/ has no record-layout PDF yet.';

const CODE_WIDTH = 4;
const VAT_WIDTH = 9;
const DATE_WIDTH = 8;
const NAME_WIDTH = 30;
const SEQ_WIDTH = 9;
const DOC_TYPE_WIDTH = 4;
const DOC_NUMBER_WIDTH = 9;
const AMOUNT_WIDTH = 15;
const ALLOCATION_WIDTH = 9;
const DESCRIPTION_WIDTH = 50;

export interface FileHeaderInput {
  businessVatNumber: string;
  businessNameEn: string;
  fileCreatedOn: string;
  periodFrom: string;
  periodTo: string;
}

export function buildA000(input: FileHeaderInput): string {
  return renderLine([
    { value: 'A000', width: CODE_WIDTH },
    { value: padAlpha(input.businessVatNumber, VAT_WIDTH), width: VAT_WIDTH },
    { value: padDate(input.fileCreatedOn), width: DATE_WIDTH },
    { value: padDate(input.periodFrom), width: DATE_WIDTH },
    { value: padDate(input.periodTo), width: DATE_WIDTH },
  ]);
}

export function buildA100(input: FileHeaderInput): string {
  return renderLine([
    { value: 'A100', width: CODE_WIDTH },
    { value: padAlpha(input.businessVatNumber, VAT_WIDTH), width: VAT_WIDTH },
    { value: padAlpha(input.businessNameEn.slice(0, NAME_WIDTH), NAME_WIDTH), width: NAME_WIDTH },
  ]);
}

export interface DocumentHeaderInput {
  seq: number;
  specDocType: string;
  documentNumber: number;
  date: string;
  clientVatNumber: string;
  subtotalIlsMinor: number;
  vatIlsMinor: number;
  totalIlsMinor: number;
  allocationShortNumber: string | null;
}

export function buildC100(input: DocumentHeaderInput): string {
  return renderLine([
    { value: 'C100', width: CODE_WIDTH },
    { value: padNumeric(input.seq, SEQ_WIDTH), width: SEQ_WIDTH },
    { value: padAlpha(input.specDocType.slice(0, DOC_TYPE_WIDTH), DOC_TYPE_WIDTH), width: DOC_TYPE_WIDTH },
    { value: padNumeric(input.documentNumber, DOC_NUMBER_WIDTH), width: DOC_NUMBER_WIDTH },
    { value: padDate(input.date), width: DATE_WIDTH },
    { value: padAlpha(input.clientVatNumber.padStart(VAT_WIDTH, '0').slice(0, VAT_WIDTH), VAT_WIDTH), width: VAT_WIDTH },
    { value: padSignedMinor(input.subtotalIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    { value: padSignedMinor(input.vatIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    { value: padSignedMinor(input.totalIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    {
      value: input.allocationShortNumber ? padNumeric(Number(input.allocationShortNumber), ALLOCATION_WIDTH) : blank(ALLOCATION_WIDTH),
      width: ALLOCATION_WIDTH,
    },
  ]);
}

export interface DocumentLineInput {
  seq: number;
  documentSeq: number;
  position: number;
  description: string;
  lineTotalIlsMinor: number;
}

export function buildD110(input: DocumentLineInput): string {
  return renderLine([
    { value: 'D110', width: CODE_WIDTH },
    { value: padNumeric(input.seq, SEQ_WIDTH), width: SEQ_WIDTH },
    { value: padNumeric(input.documentSeq, SEQ_WIDTH), width: SEQ_WIDTH },
    { value: padNumeric(input.position, 3), width: 3 },
    { value: padAlpha(input.description.slice(0, DESCRIPTION_WIDTH), DESCRIPTION_WIDTH), width: DESCRIPTION_WIDTH },
    { value: padSignedMinor(input.lineTotalIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
  ]);
}

export interface PurchaseInput {
  seq: number;
  supplierVatNumber: string;
  date: string;
  amountIlsMinor: number;
  vatIlsMinor: number;
  allocationShortNumber: string | null;
}

export function buildB110(input: PurchaseInput): string {
  return renderLine([
    { value: 'B110', width: CODE_WIDTH },
    { value: padNumeric(input.seq, SEQ_WIDTH), width: SEQ_WIDTH },
    { value: padAlpha(input.supplierVatNumber.padStart(VAT_WIDTH, '0').slice(0, VAT_WIDTH), VAT_WIDTH), width: VAT_WIDTH },
    { value: padDate(input.date), width: DATE_WIDTH },
    { value: padSignedMinor(input.amountIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    { value: padSignedMinor(input.vatIlsMinor, AMOUNT_WIDTH), width: AMOUNT_WIDTH + 1 },
    {
      value: input.allocationShortNumber ? padNumeric(Number(input.allocationShortNumber), ALLOCATION_WIDTH) : blank(ALLOCATION_WIDTH),
      width: ALLOCATION_WIDTH,
    },
  ]);
}

export function buildZ900(totalRecords: number): string {
  return renderLine([
    { value: 'Z900', width: CODE_WIDTH },
    { value: padNumeric(totalRecords, SEQ_WIDTH), width: SEQ_WIDTH },
  ]);
}
