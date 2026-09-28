import { describe, expect, it } from 'vitest';
import { renderDocument } from '../../src/modules/pdf/render';
import { sampleRenderDocument } from '../fixtures/pdf/sample';

/**
 * R18 task 3: the filed copy of an English document (langVariant 'en') is one bilingual
 * document, the English layout with every label's Hebrew alongside it, replacing the old design
 * that stacked a full Hebrew section above a full English one.
 */
describe('renderDocument: filed variant, English document', () => {
  it('is one left-to-right bilingual section, not a stacked Hebrew section plus an English one', () => {
    const html = renderDocument(sampleRenderDocument(), 'filed');
    expect(html).toContain('class="section en-block bilingual-block" dir="ltr" lang="en"');
    expect(html).not.toContain('class="section he-block"');
    expect((html.match(/class="header-top" dir="ltr"/g) ?? []).length).toBe(1);
    expect(html).toContain('Transaction invoice / <span dir="rtl" lang="he">חשבון עסקה</span> 42');
    expect(html).toContain('To / <span dir="rtl" lang="he">לכבוד</span>');
    expect(html).toContain('Description / <span dir="rtl" lang="he">תיאור</span>');
    expect(html).toContain('Qty / <span dir="rtl" lang="he">כמות</span>');
    expect(html).toContain('Signature / <span dir="rtl" lang="he">חתימה</span>');
  });

  it('keeps numbers and amounts left-to-right in the bilingual layout', () => {
    const html = renderDocument(sampleRenderDocument({ totalIlsMinor: 371200 }), 'filed');
    expect(html).toContain('$');
    expect(html).toContain('₪');
    expect(html).toContain('3.712₪');
    expect(html).toContain('Document exchange rate / <span dir="rtl" lang="he">שער חליפין</span>');
    expect(html).toContain('05/10/2026'); // rate date
  });

  it('hides the ILS line and rate when totalIlsMinor is null (quote default)', () => {
    const html = renderDocument(sampleRenderDocument({ totalIlsMinor: null }), 'filed');
    expect(html).not.toContain('₪');
    expect(html).not.toContain('3.712₪');
  });

  it('stamps "Original / מקור" on the first render and "Copy / העתק" on a reprint', () => {
    const original = renderDocument(sampleRenderDocument({ isOriginal: true }), 'filed');
    expect(original).toContain('Original / <span dir="rtl" lang="he">מקור</span>');
    const copy = renderDocument(sampleRenderDocument({ isOriginal: false }), 'filed');
    expect(copy).toContain('Copy / <span dir="rtl" lang="he">העתק</span>');
  });
});

/** R18 task 3: a Hebrew document (langVariant 'bilingual') keeps its Hebrew layout for the body, under the shared header, on both copies. */
describe('renderDocument: Hebrew document (langVariant bilingual)', () => {
  it('renders one Hebrew (RTL) section for both the client and the filed copy', () => {
    const doc = sampleRenderDocument({ langVariant: 'bilingual' });
    const client = renderDocument(doc, 'client');
    expect(client).toContain('class="section he-block" dir="rtl" lang="he"');
    expect(client).not.toContain('bilingual-block');
    const filed = renderDocument(doc, 'filed');
    expect(filed).toContain('class="section he-block" dir="rtl" lang="he"');
    expect(filed).not.toContain('bilingual-block');
    expect(filed).toBe(client);
  });

  it('still gets the shared, English, left-to-right header', () => {
    const html = renderDocument(sampleRenderDocument({ langVariant: 'bilingual' }), 'client');
    expect(html).toContain('class="header-top" dir="ltr"');
    expect(html).toContain('Sample Business Ltd');
  });
});

describe('renderDocument: client variant, English document', () => {
  it('is English only, with the same number and data as the filed copy would carry', () => {
    const doc = sampleRenderDocument();
    const html = renderDocument(doc, 'client');
    expect(html).not.toContain('class="section he-block"');
    expect(html).toContain('class="section en-block" dir="ltr" lang="en"');
    expect(html).not.toContain('bilingual-block');
    expect(html).toContain('Transaction invoice 42');
    expect(html).toContain('Example Client Ltd');
  });
});

/** R19 task 3: a client may have only one of nameEn, nameHe; each copy falls back to the other. */
describe('renderDocument: client name fallback (R19)', () => {
  it('shows the Hebrew name on the English client copy for a Hebrew-only client', () => {
    const doc = sampleRenderDocument({ client: { ...sampleRenderDocument().client!, nameEn: '', nameHe: 'לקוח עברי' } });
    const html = renderDocument(doc, 'client');
    expect(html).toContain('לקוח עברי');
  });

  it('shows the English name on the Hebrew document for an English-only client', () => {
    const doc = sampleRenderDocument({ langVariant: 'bilingual', client: { ...sampleRenderDocument().client!, nameEn: 'English Only Co', nameHe: null } });
    const html = renderDocument(doc, 'client');
    expect(html).toContain('English Only Co');
  });

  it('the bilingual filed copy shows both names, separated, when both exist', () => {
    const doc = sampleRenderDocument({ client: { ...sampleRenderDocument().client!, nameEn: 'Both Names Co', nameHe: 'שני שמות' } });
    const html = renderDocument(doc, 'filed');
    expect(html).toContain('Both Names Co / <span dir="rtl" lang="he">שני שמות</span>');
  });

  it('the bilingual filed copy shows just the Hebrew name, with no stray separator, for a Hebrew-only client', () => {
    const doc = sampleRenderDocument({ client: { ...sampleRenderDocument().client!, nameEn: '', nameHe: 'לקוח עברי' } });
    const html = renderDocument(doc, 'filed');
    expect(html).toContain('<div class="client-name">לקוח עברי</div>');
    expect(html).not.toContain('/ <span dir="rtl" lang="he">לקוח עברי');
  });
});

/** R17 task 4: a proforma invoice always carries the "not a tax invoice" disclaimer. */
describe('renderDocument: proforma invoice', () => {
  it('shows the disclaimer in English on the client copy and both languages on the filed copy', () => {
    const doc = sampleRenderDocument({ type: 'PF', typeNameEn: 'Pro Forma Invoice', typeNameHe: 'חשבון עסקה' });
    const client = renderDocument(doc, 'client');
    expect(client).toContain('This is not a tax invoice');
    const filed = renderDocument(doc, 'filed');
    expect(filed).toContain('This is not a tax invoice');
    expect(filed).toContain('אינו חשבונית מס');
  });

  it('never shows the disclaimer on a document that is not a proforma', () => {
    // R18 task 10: 300 merged into the proforma; '400' (a receipt) is a type that is not one.
    const html = renderDocument(sampleRenderDocument({ type: '400' }), 'client');
    expect(html).not.toContain('This is not a tax invoice');
  });
});

/**
 * R11 makes R02 print R12's allocationGate print_note (CLAUDE.md rule 3,
 * docs/israel-invoices-api.md §2.2.2, choices 2 and 3), in bold, on every section it renders.
 */
describe('renderDocument: the allocation gate print_note', () => {
  it('prints nothing when there is no print_note', () => {
    // type '400' (a receipt): 300, the sample's default type, is now a proforma and always
    // carries its own print-note disclaimer (R18 task 10), independent of print_note.
    const html = renderDocument(sampleRenderDocument({ type: '400', printNote: null }), 'client');
    expect(html).not.toContain('class="print-note"');
  });

  it('prints the no-input-VAT note in bold, on both the filed and the client copy', () => {
    const filed = renderDocument(sampleRenderDocument({ printNote: 'no_input_vat' }), 'filed');
    expect(filed).toContain('class="print-note"');
    expect(filed).toContain('<strong>');
    expect(filed).toContain('אין לנכות מס תשומות בגין חשבונית זו');
    const client = renderDocument(sampleRenderDocument({ printNote: 'no_input_vat' }), 'client');
    expect(client).toContain('אין לנכות מס תשומות בגין חשבונית זו');
  });

  it('prints the reverse-charge note', () => {
    const html = renderDocument(sampleRenderDocument({ printNote: 'reverse_charge' }), 'client');
    expect(html).toContain('class="print-note"');
    expect(html).toContain('בגין חשבונית זו לקוח חייב לדווח חשבונית עצמית');
  });
});

describe('renderDocument: copy marking', () => {
  it('stamps "מקור" on the first render', () => {
    const html = renderDocument(sampleRenderDocument({ isOriginal: true }), 'client');
    expect(html).toContain('מקור');
    expect(html).not.toContain('העתק נאמן למקור');
  });

  it('stamps "העתק נאמן למקור" on a later reprint', () => {
    const html = renderDocument(sampleRenderDocument({ isOriginal: false }), 'client');
    expect(html).toContain('העתק נאמן למקור');
  });

  it('always marks the document as computerized', () => {
    const html = renderDocument(sampleRenderDocument(), 'client');
    expect(html).toContain('מסמך ממוחשב');
  });
});

describe('renderDocument: allocation number slot', () => {
  it('shows the label and the 9-digit number when present', () => {
    const html = renderDocument(sampleRenderDocument({ allocationNumber: '123456789' }), 'client');
    expect(html).toContain('מספר הקצאה:');
    expect(html).toContain('123456789');
  });

  it('shows nothing when the allocation number is absent', () => {
    const html = renderDocument(sampleRenderDocument({ allocationNumber: null }), 'client');
    expect(html).not.toContain('מספר הקצאה');
  });
});

/** R18 task 1: no legal-status line on any document, in either legal mode. */
describe('renderDocument: legal mode and business ID', () => {
  it('prints the business tax ID but never a legal-status line', () => {
    const html = renderDocument(sampleRenderDocument({ legalMode: 'patur' }), 'client');
    expect(html).toContain('123456782');
    expect(html).not.toContain('עוסק פטור');
    expect(html).not.toContain('class="legal-mode"');
  });

  it('never prints a legal-status line in מורשה mode either', () => {
    const html = renderDocument(sampleRenderDocument({ legalMode: 'murshe' }), 'client');
    expect(html).not.toContain('עוסק מורשה');
    expect(html).not.toContain('class="legal-mode"');
  });
});

describe('renderDocument: VAT and totals', () => {
  it('shows the VAT rate and amount only when set (מורשה mode)', () => {
    const withVat = renderDocument(
      sampleRenderDocument({ vatRateBp: 1800, vatAmountMinor: 18000, subtotalMinor: 100000, totalMinor: 118000, currency: 'ILS' }),
      'client',
    );
    expect(withVat).toContain('18%');

    const withoutVat = renderDocument(sampleRenderDocument({ vatRateBp: null }), 'client');
    expect(withoutVat).not.toContain('VAT');
  });

  it('formats amounts with grouping and two decimals', () => {
    const html = renderDocument(sampleRenderDocument({ subtotalMinor: 123456700, totalMinor: 123456700 }), 'client');
    expect(html).toContain('1,234,567.00');
  });
});

/** R17 task 6: a receipt's payment method table (method, Total <ccy>, Total ₪). */
describe('renderDocument: payment method table', () => {
  it('groups payments by method with summed totals, on a receipt-kind document only', () => {
    const doc = sampleRenderDocument({
      kind: 'receipt',
      payments: [
        { method: 'bank_transfer', methodDetail: null, paidOn: '2026-10-06', reference: 'REF-1', amountMinor: 30000, amountIlsMinor: null, currency: 'USD' },
        { method: 'bank_transfer', methodDetail: null, paidOn: '2026-10-07', reference: 'REF-2', amountMinor: 20000, amountIlsMinor: null, currency: 'USD' },
      ],
    });
    const html = renderDocument(doc, 'client');
    expect(html).toContain('class="payments-table"');
    expect(html).toContain('Bank transfer');
    expect(html).toContain('$500.00');
  });

  it("uses the catalog entry's display name when the payment named one", () => {
    const doc = sampleRenderDocument({
      kind: 'receipt',
      payments: [
        {
          method: 'bank_transfer',
          methodDetail: { displayName: 'Bank Leumi ILS', type: 'bank_transfer', details: {} },
          paidOn: '2026-10-06',
          reference: null,
          amountMinor: 50000,
          amountIlsMinor: 185000,
          currency: 'USD',
        },
      ],
    });
    const html = renderDocument(doc, 'client');
    expect(html).toContain('Bank Leumi ILS');
    expect(html).toContain('1,850.00₪');
  });

  it('never shows a payment method table on a non-receipt document', () => {
    const doc = sampleRenderDocument({
      kind: 'demand',
      payments: [{ method: 'bank_transfer', methodDetail: null, paidOn: '2026-10-06', reference: null, amountMinor: 50000, amountIlsMinor: null, currency: 'USD' }],
    });
    expect(renderDocument(doc, 'client')).not.toContain('class="payments-table"');
  });
});

/** R17 task 2 and task 6: a quote, payment request, proforma or transaction invoice's "Payment transfer method" section. */
describe('renderDocument: payment transfer method', () => {
  it("prints each selected method's details, on a demand document", () => {
    const doc = sampleRenderDocument({
      kind: 'demand',
      paymentMethods: [
        {
          displayName: 'Bank Leumi ILS',
          type: 'bank_transfer',
          details: { accountHolder: 'Sample Business Ltd', bankNumber: '99', bankName: 'Example Bank', branch: '001', accountNumber: '000000' },
        },
      ],
    });
    const html = renderDocument(doc, 'client');
    expect(html).toContain('Payment transfer method');
    expect(html).toContain('Beneficiary: Sample Business Ltd');
    expect(html).toContain('Account: 000000');
  });

  it('prints nothing when no payment method is selected', () => {
    const html = renderDocument(sampleRenderDocument({ kind: 'demand', paymentMethods: [] }), 'client');
    expect(html).not.toContain('Payment transfer method');
  });
});

/** R16 task 7: a quote or payment request's own payment instructions text. */
describe('renderDocument: payment instructions', () => {
  it('prints on a demand (payment request, transaction invoice), both copies', () => {
    const doc = sampleRenderDocument({ kind: 'demand', paymentInstructions: 'Pay by bank transfer to the account below within 14 days.' });
    const client = renderDocument(doc, 'client');
    expect(client).toContain('Payment instructions');
    expect(client).toContain('Pay by bank transfer to the account below within 14 days.');
    const filed = renderDocument(doc, 'filed');
    expect(filed).toContain('הוראות תשלום');
    expect(filed).toContain('Payment instructions');
  });

  it('prints on a quote', () => {
    const doc = sampleRenderDocument({ kind: 'quote', paymentInstructions: 'Half up front, half on delivery.' });
    expect(renderDocument(doc, 'client')).toContain('Half up front, half on delivery.');
  });

  it('never prints on a receipt or invoice, even if the field carries a value', () => {
    const doc = sampleRenderDocument({ kind: 'receipt', paymentInstructions: 'Should not appear.' });
    expect(renderDocument(doc, 'client')).not.toContain('Should not appear.');
  });

  it('prints nothing when there is no text', () => {
    const doc = sampleRenderDocument({ kind: 'demand', paymentInstructions: null });
    expect(renderDocument(doc, 'client')).not.toContain('Payment instructions');
  });
});

/** R16 task 8: the visible signature image, above a signer line, on every finalized document. R22: only when uploaded. */
describe('renderDocument: signature image', () => {
  const signed = (overrides: Parameters<typeof sampleRenderDocument>[0]) => {
    const doc = sampleRenderDocument(overrides);
    return { ...doc, business: { ...doc.business, signatureDataUri: 'data:image/png;base64,AAAA' } };
  };

  it('prints on a finalized document, both copies, never on a draft', () => {
    const client = renderDocument(signed({ status: 'final' }), 'client');
    expect(client).toContain('class="signature-image"');
    expect(client).toContain('src="data:image/png;base64,');
    expect(client).toContain('Signature');

    const filed = renderDocument(signed({ status: 'final' }), 'filed');
    expect(filed).toContain('class="signature-image"');
    expect(filed).toContain('חתימה');

    const draft = renderDocument(signed({ number: null, status: 'draft' }), 'client');
    expect(draft).not.toContain('class="signature-image"');
  });

  it('prints no image without an uploaded signature (R22)', () => {
    const html = renderDocument(sampleRenderDocument({ status: 'final' }), 'client');
    expect(html).toContain('class="signer-line"');
    expect(html).not.toContain('class="signature-image"');
  });
});

describe('renderDocument: HTML safety', () => {
  it('escapes untrusted line description and detail text', () => {
    const doc = sampleRenderDocument({
      lines: [
        {
          position: 1,
          descriptionEn: '<script>alert(1)</script>',
          descriptionHe: null,
          detailEn: '<img onerror=alert(1)>',
          detailHe: null,
          quantityMilli: 1000,
          unitPriceMinor: 1000,
          discountMinor: 0,
          lineTotalMinor: 1000,
        },
      ],
    });
    const html = renderDocument(doc, 'client');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/** R17 task 6: business header, icon row and the logo tile. R18 task 1: one header everywhere. */
describe('renderDocument: header', () => {
  it('prints the business name, tagline, icon row and the logo tile', () => {
    const html = renderDocument(sampleRenderDocument(), 'client');
    expect(html).toContain('class="business-name"');
    expect(html).toContain('Sample Business Ltd');
    expect(html).toContain('Design &amp; Consulting');
    expect(html).toContain('billing@example.com');
    expect(html).toContain('+972-50-0000000');
    expect(html).toContain('example.com');
    expect(html).toContain('class="logo-tile"');
    expect(html).toContain('<svg');
  });

  it('is the same LTR, left-to-right English header on the bilingual filed copy too', () => {
    const filed = renderDocument(sampleRenderDocument(), 'filed');
    expect((filed.match(/class="header-top" dir="ltr"/g) ?? []).length).toBe(1);
    expect(filed).not.toContain('class="legal-mode"');
    expect(filed).not.toContain('עוסק');
  });

  it('is also the same LTR header on a Hebrew document (langVariant bilingual)', () => {
    const html = renderDocument(sampleRenderDocument({ langVariant: 'bilingual' }), 'client');
    expect(html).toContain('class="header-top" dir="ltr"');
    expect(html).not.toContain('class="legal-mode"');
  });

  it('shows "Created from: <type> / <number>" when the document is linked, nothing otherwise', () => {
    const linked = renderDocument(sampleRenderDocument({ source: { typeNameEn: 'Price quotation', typeNameHe: 'הצעת מחיר', number: 1000 } }), 'client');
    expect(linked).toContain('Created from: Price quotation / 1000');
    const unlinked = renderDocument(sampleRenderDocument({ source: null }), 'client');
    expect(unlinked).not.toContain('Created from');
  });

  it('shows the "Digitally signed" badge only on a signed finalized document', () => {
    const signed = renderDocument(sampleRenderDocument({ status: 'final', signed: true }), 'client');
    expect(signed).toContain('Digitally signed');
    const unsigned = renderDocument(sampleRenderDocument({ status: 'final' }), 'client');
    expect(unsigned).not.toContain('Digitally signed');
    const draft = renderDocument(sampleRenderDocument({ number: null, status: 'draft', signed: true }), 'client');
    expect(draft).not.toContain('Digitally signed');
  });
});

/** R17 task 6: the footer credits Open Ledger IL and prints the type, number and page. */
describe('renderDocument: footer', () => {
  it('says "created using" on an unsigned document, never "digitally signed"', () => {
    const html = renderDocument(sampleRenderDocument(), 'client');
    expect(html).toContain('This document was created using Open Ledger IL');
    expect(html).not.toContain('digitally signed');
  });

  it('shows the created-and-signed line, the computerized-document note, and the type/number/page', () => {
    const html = renderDocument(sampleRenderDocument({ signed: true }), 'client');
    expect(html).toContain('This document was created and digitally signed using Open Ledger IL');
    expect(html).toContain('Transaction invoice / 42');
    expect(html).toContain('Page 1 of 1');
  });
});

describe('renderDocument: draft preview', () => {
  it('shows a draft label instead of a document number when unfinalized', () => {
    const html = renderDocument(sampleRenderDocument({ number: null, status: 'draft' }), 'client');
    expect(html).toContain('Draft, not yet issued');
  });

  it('carries a diagonal DRAFT stamp on both variants, and never on a finalized document', () => {
    const draftClient = renderDocument(sampleRenderDocument({ number: null, status: 'draft' }), 'client');
    expect(draftClient).toContain('class="draft-stamp"');
    expect(draftClient).toContain('DRAFT, NOT A VALID DOCUMENT');

    const draftFiled = renderDocument(sampleRenderDocument({ number: null, status: 'draft' }), 'filed');
    expect(draftFiled).toContain('class="draft-stamp"');

    const final = renderDocument(sampleRenderDocument({ status: 'final' }), 'client');
    expect(final).not.toContain('class="draft-stamp"');
  });
});
