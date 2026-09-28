import { describe, expect, it } from 'vitest';
import { renderDocument } from '../../src/modules/pdf/render';
import {
  referenceEnglishOnlyClient,
  referenceHebrewOnlyClient,
  referenceInvoiceReceipt,
  referenceProforma,
  referenceProformaHebrew,
} from '../fixtures/pdf/reference-samples';

/**
 * R17 task 6: renders the two reference-style samples (an invoice/receipt in USD with ILS shown,
 * and a USD proforma). Browser Rendering itself needs a live Cloudflare binding this test suite
 * cannot reach (R02's "no test calls the internet" rule), so these check the HTML.
 */
describe('reference design samples', () => {
  it('renders the invoice/receipt sample with the header, items, payment method table and signature', () => {
    const html = renderDocument(referenceInvoiceReceipt, 'client');
    expect(html).toContain('Sample Business Ltd');
    expect(html).toContain('Design &amp; Consulting');
    expect(html).toContain('Invoice/receipt 1042');
    expect(html).toContain('Digitally signed');
    expect(html).toContain('True copy of the original');
    expect(html).toContain('Created from: Price quotation / 101');
    expect(html).toContain('Example Client');
    expect(html).toContain('General');
    // R18 task 4: one line with a description, one without.
    expect(html).toContain('<div class="line-detail">Monthly retainer, September 2026</div>');
    expect(html).toContain('Design review');
    expect(html).toContain('$ 330.00');
    expect(html).toContain('1,000.89');
    expect(html).toContain('3.033');
    expect(html).toContain('class="payments-table"');
    expect(html).toContain('Bank transfer');
    expect(html).toContain('class="signature-image"');
  });

  it('prints no signature image when none is uploaded (R22)', () => {
    const html = renderDocument({ ...referenceInvoiceReceipt, business: { ...referenceInvoiceReceipt.business, signatureDataUri: null } }, 'client');
    expect(html).toContain('class="signature-block"');
    expect(html).not.toContain('class="signature-image"');
  });

  it('prints the uploaded logo, or the default wordmark without one (R22)', () => {
    const uploaded = renderDocument({ ...referenceInvoiceReceipt, business: { ...referenceInvoiceReceipt.business, logoDataUri: 'data:image/png;base64,AAAA' } }, 'client');
    expect(uploaded).toContain('<img class="logo-image" src="data:image/png;base64,AAAA"');
    const fallback = renderDocument(referenceInvoiceReceipt, 'client');
    expect(fallback).toContain('aria-label="Open Ledger IL"');
  });

  it('renders the proforma sample with the not-a-tax-invoice note and the payment transfer method', () => {
    const html = renderDocument(referenceProforma, 'client');
    expect(html).toContain('Pro Forma Invoice 1043');
    expect(html).toContain('Acme Ltd');
    expect(html).toContain('Consulting Services');
    // R18 task 4: one line with a description, one without.
    expect(html).toContain('<div class="line-detail">Consulting retainer, Q4 2026</div>');
    expect(html).toContain('Workshop day');
    expect(html).toContain('$ 1,600.00');
    expect(html).toContain('4,780.80');
    expect(html).toContain('This is not a tax invoice');
    expect(html).toContain('Payment transfer method');
    expect(html).toContain('Beneficiary: Sample Business Ltd');
    expect(html).toContain('Bank: 99 (Example Bank)');
    expect(html).not.toContain('class="payments-table"');
  });

  it('renders the filed copy as one bilingual document (R18 task 3)', () => {
    const html = renderDocument(referenceInvoiceReceipt, 'filed');
    expect(html).toContain('class="section en-block bilingual-block" dir="ltr" lang="en"');
    expect(html).not.toContain('class="section he-block"');
    expect(html).toContain('Invoice/receipt / <span dir="rtl" lang="he">חשבונית/קבלה</span> 1042');
  });

  /** R18 task 9: a Hebrew document (langVariant 'bilingual') keeps the Hebrew layout for both copies. */
  it('renders a Hebrew proforma the same way for the client and the filed copy', () => {
    const client = renderDocument(referenceProformaHebrew, 'client');
    const filed = renderDocument(referenceProformaHebrew, 'filed');
    expect(client).toBe(filed);
    expect(client).toContain('class="section he-block" dir="rtl" lang="he"');
    expect(client).toContain('אקמי בע&quot;מ');
    expect(client).toContain('שירותי ייעוץ');
    expect(client).toContain('ריטיינר ייעוץ, רבעון 4 2026');
    expect(client).toContain('class="header-top" dir="ltr"'); // the shared English header, R18 task 1
  });
});

/** R19 task 3: a client with only one of nameEn, nameHe still gets a real name on every copy. */
describe('reference design samples: client name fallback (R19)', () => {
  it('the Hebrew-only client shows their Hebrew name on the English client copy and alone on the bilingual filed copy', () => {
    const client = renderDocument(referenceHebrewOnlyClient, 'client');
    expect(client).toContain('דנה כהן');
    const filed = renderDocument(referenceHebrewOnlyClient, 'filed');
    expect(filed).toContain('<div class="client-name">דנה כהן</div>');
    expect(filed).not.toContain('/ <span dir="rtl" lang="he">דנה כהן');
  });

  it('the English-only client shows their English name on the Hebrew document', () => {
    const html = renderDocument(referenceEnglishOnlyClient, 'client');
    expect(html).toContain('Global Retail Co');
  });
});
