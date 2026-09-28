import { currencySymbol, formatAmount, formatDate, formatQuantity, formatVatRate } from './format';
import { ICONS } from './icons';
import { LABELS, PAYMENT_METHOD_LABELS, allocationLabel, computerizedLabel, copyLabel, printNoteText, type Lang } from './labels';
import { logoMarkup } from './logo';
import { paymentMethodDetailText } from './payment-method-text';
import { documentStyles } from './styles';
import type { RenderDocument, RenderVariant } from './types';

function esc(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A proforma invoice, in either of its two type codes (R18 task 10): 300, the one type new
 * proformas take from now on, and PF, disabled for new documents but still readable and still
 * carrying this same "not a tax invoice" disclaimer when an already-finalized one is reprinted.
 */
function isProforma(doc: RenderDocument): boolean {
  return doc.type === '300' || doc.type === 'PF';
}

/** R19: a client may have only one of nameEn, nameHe. Each language's copy prefers its own name, falling back to the other. */
function localizedName(nameEn: string, nameHe: string | null, lang: Lang): string {
  return esc(lang === 'he' ? nameHe || nameEn : nameEn || nameHe || '');
}

function localizedAddress(en: string | null, he: string | null, lang: Lang): string | null {
  const value = lang === 'he' ? (he ?? en) : en;
  return value ? esc(value) : null;
}

/**
 * "<English> / <Hebrew>", the Hebrew half in its own right-to-left span (R18 task 3): the filed
 * copy of an English document is one bilingual document where every label carries its Hebrew on
 * the same line. `en`/`he` are trusted static or already-escaped-elsewhere strings when they come
 * from `LABELS`; dynamic content (names, descriptions) is escaped by the caller before reaching
 * either `blText` or `bl`.
 */
function blText(en: string, he: string): string {
  return `${esc(en)} / <span dir="rtl" lang="he">${esc(he)}</span>`;
}

/** `blText` for one `LABELS` key. */
function bl(key: string): string {
  return blText(LABELS.en[key] ?? '', LABELS.he[key] ?? '');
}

/**
 * One header, identical in every document and every copy (R18 task 1): the English rendering,
 * left-to-right, left-aligned, business name bold, tagline, an icon row (ID, email, phone,
 * address, website) and the logo tile at top right. No header field is ever translated, so
 * this ignores the section's language; the `dir="ltr"` wrapper keeps it left-aligned even inside
 * a Hebrew (RTL) section, and being a plain physical layout (not flex) keeps the logo tile at the
 * same visual corner there too. There is no legal-mode line: R18 task 1 removes it everywhere.
 */
function headerHtml(doc: RenderDocument): string {
  const business = doc.business;
  const businessName = esc(business.nameEn);
  const tagline = business.taglineEn ?? business.taglineHe;
  const businessAddress = business.addressEn ? esc(business.addressEn) : null;
  const row1 = [
    business.taxId ? `<span class="icon-item">${ICONS.id}${esc(LABELS.en.businessId)}: ${esc(business.taxId)}</span>` : '',
    business.email ? `<span class="icon-item">${ICONS.email}${esc(business.email)}</span>` : '',
    business.phone ? `<span class="icon-item">${ICONS.phone}${esc(business.phone)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const row2 = [
    businessAddress ? `<span class="icon-item">${ICONS.pin}${businessAddress}</span>` : '',
    business.website ? `<span class="icon-item">${ICONS.website}${esc(business.website)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `
<div class="header-top" dir="ltr">
  <div>
    <div class="business-name">${businessName}</div>
    ${tagline ? `<div class="tagline">${esc(tagline)}</div>` : ''}
    ${row1 ? `<div class="icon-row">${row1}</div>` : ''}
    ${row2 ? `<div class="icon-row">${row2}</div>` : ''}
  </div>
  <div class="logo-tile">${logoMarkup(business.logoDataUri)}</div>
</div>
<hr class="rule" />`;
}

/**
 * Title line: "<Document type> <number>" with a "Digitally signed" badge on a signed final
 * document (`doc.signed`), and at right "Original" or "Copy" (the legal מקור/העתק נאמן למקור stamp) plus the
 * date. "Created from: <source> / <number>" follows when this document was converted from
 * another one, then a rule (R17 task 6).
 */
function titleLineHtml(doc: RenderDocument, lang: Lang, t: Record<string, string>): string {
  const typeName = lang === 'he' ? doc.typeNameHe : doc.typeNameEn;
  const numberLine = doc.number === null ? esc(t.draft) : `${typeName} ${doc.number}`;
  const badge = doc.status !== 'draft' && doc.signed === true ? `<span class="badge">${ICONS.badge}${esc(t.digitallySigned)}</span>` : '';
  const dateLine = doc.number === null ? '' : `<span class="copy-word">${esc(copyLabel(lang, doc.isOriginal))}</span><span class="rule-sep">|</span>${formatDate(doc.date)}`;
  const createdFrom = doc.source
    ? `<div class="created-from">${esc(t.createdFrom)}: ${esc(lang === 'he' ? doc.source.typeNameHe : doc.source.typeNameEn)} / ${doc.source.number ?? ''}</div>`
    : '';
  return `
<div class="title-line">
  <div class="doc-title">${esc(numberLine)} ${badge}</div>
  <div class="copy-date">${dateLine}</div>
</div>
${createdFrom}
<hr class="rule" />`;
}

function clientHtml(doc: RenderDocument, lang: Lang, t: Record<string, string>): string {
  if (!doc.client) return '';
  const name = localizedName(doc.client.nameEn, doc.client.nameHe, lang);
  const address = localizedAddress(doc.client.addressEn, doc.client.addressHe, lang);
  // City and zip on their own line under the street address, the city in the document's language.
  const city = localizedAddress(doc.client.cityEn ?? null, doc.client.cityHe ?? null, lang);
  const cityLine = [city, doc.client.postalCode ? esc(doc.client.postalCode) : null].filter(Boolean).join(' ');
  const idLine = doc.client.vatNumber
    ? `${esc(t.businessId)}: ${esc(doc.client.vatNumber)}`
    : doc.client.companyId
      ? `${esc(t.businessId)}: ${esc(doc.client.companyId)}`
      : '';
  return `
<div class="to-block">
  <div class="block-title">${esc(t.to)}:</div>
  <div class="client-name">${name}</div>
  ${address ? `<div class="muted">${address}</div>` : ''}
  ${cityLine ? `<div class="muted">${cityLine}</div>` : ''}
  ${idLine ? `<div class="muted">${idLine}</div>` : ''}
</div>`;
}

function itemsHtml(doc: RenderDocument, lang: Lang, t: Record<string, string>): string {
  const symbol = currencySymbol(doc.currency);
  const showIls = doc.totalIlsMinor !== null;
  const rows = doc.lines
    .map((line) => {
      const description = lang === 'he' ? esc(line.descriptionHe ?? line.descriptionEn) : esc(line.descriptionEn);
      const detail = lang === 'he' ? (line.detailHe ?? line.detailEn) : line.detailEn;
      const detailLine = detail ? `<div class="line-detail">${esc(detail)}</div>` : '';
      return `
<tr>
  <td>${description}${detailLine}</td>
  <td class="numeric">${formatQuantity(line.quantityMilli)}</td>
  <td class="numeric">${symbol} ${formatAmount(line.unitPriceMinor, doc.currency)}</td>
  <td class="numeric">${symbol} ${formatAmount(line.lineTotalMinor, doc.currency)}</td>
  ${showIls ? `<td class="numeric">₪ ${formatAmount(convertLineToIls(doc, line.lineTotalMinor), 'ILS')}</td>` : ''}
</tr>`;
    })
    .join('');
  return `
<table class="items">
  <thead>
    <tr>
      <th>${esc(t.description)}</th>
      <th class="numeric">${esc(t.qty)}</th>
      <th class="numeric">${esc(t.unitPrice)} (${symbol})</th>
      <th class="numeric">${esc(t.total)} (${symbol})</th>
      ${showIls ? `<th class="numeric">${esc(t.total)} (₪)</th>` : ''}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Approximates each line's ILS share from the document's own total ratio (display only, never bookkeeping). */
function convertLineToIls(doc: RenderDocument, lineTotalMinor: number): number {
  if (doc.totalIlsMinor === null || doc.totalMinor === 0) return 0;
  return Math.round((lineTotalMinor * doc.totalIlsMinor) / doc.totalMinor);
}

function totalsHtml(doc: RenderDocument, t: Record<string, string>): string {
  const symbol = currencySymbol(doc.currency);
  const vatRow =
    doc.vatRateBp !== null
      ? `<tr><td>${esc(t.vat)} (${formatVatRate(doc.vatRateBp)})</td><td class="numeric">${symbol} ${formatAmount(doc.vatAmountMinor, doc.currency)}</td></tr>`
      : '';
  const grandRow = `
<tr class="grand">
  <td>${esc(t.total)}</td>
  <td class="numeric"><span class="grand-amount">${formatAmount(doc.totalMinor, doc.currency)}</span> <span class="grand-ccy">${symbol}</span></td>
</tr>`;
  const ilsRow =
    doc.totalIlsMinor !== null
      ? `<tr class="grand"><td></td><td class="numeric"><span class="grand-amount">${formatAmount(doc.totalIlsMinor, 'ILS')}</span> <span class="grand-ccy">₪</span></td></tr>`
      : '';
  // docs/currency-and-fx.md: "The rate and the rate date print on every receipt and tax
  // invoice", so both stay even though the SUMIT reference only shows the rate.
  const rateRow =
    doc.totalIlsMinor !== null && doc.fxRate
      ? `<tr><td>${esc(t.documentExchangeRate)}</td><td class="numeric">$1&nbsp;&nbsp;=&nbsp;&nbsp;${doc.fxRate.replace(/0+$/, '').replace(/\.$/, '')}₪${doc.fxRateDate ? ` (${formatDate(doc.fxRateDate)})` : ''}</td></tr>`
      : '';
  return `
<table class="totals">
  <tr><td>${esc(t.subtotal)}</td><td class="numeric">${symbol} ${formatAmount(doc.subtotalMinor, doc.currency)}</td></tr>
  ${vatRow}
  ${grandRow}
  ${ilsRow}
  ${rateRow}
</table>`;
}

/** The document's payment note (R16 task 7's free-text field, task 2's rename to "note"). */
function paymentInstructionsHtml(doc: RenderDocument, t: Record<string, string>): string {
  if (doc.kind !== 'quote' && doc.kind !== 'demand') return '';
  if (!doc.paymentInstructions) return '';
  return `
<div class="block-title">${esc(t.paymentInstructions)}</div>
<div class="notes">${esc(doc.paymentInstructions)}</div>`;
}

/**
 * A quote, payment request, proforma or transaction invoice's "Payment transfer method" section
 * (R17 task 2's multi-select, R17 task 6's layout): the selected methods' printable details.
 */
function paymentTransferMethodHtml(doc: RenderDocument, lang: Lang, t: Record<string, string>): string {
  if (doc.kind !== 'quote' && doc.kind !== 'demand') return '';
  if (doc.paymentMethods.length === 0) return '';
  const lines = doc.paymentMethods.map((m) => `<div class="payment-method-line">${esc(paymentMethodDetailText(m, lang))}</div>`).join('');
  return `
<div class="block-title">${esc(t.paymentTransferMethod)}</div>
${lines}`;
}

/**
 * A receipt's payment method table: method, Total (<ccy>), Total (₪) (R17 task 6), one row per
 * distinct method actually used, amounts summed across every payment that used it.
 */
function paymentMethodTableHtml(doc: RenderDocument, lang: Lang, t: Record<string, string>): string {
  if (doc.payments.length === 0) return '';
  const symbol = currencySymbol(doc.currency);
  const showIls = doc.payments.some((p) => p.amountIlsMinor !== null);
  const groups = new Map<string, { amountMinor: number; amountIlsMinor: number }>();
  for (const p of doc.payments) {
    const key = p.methodDetail ? p.methodDetail.displayName : (PAYMENT_METHOD_LABELS[lang][p.method] ?? p.method);
    const g = groups.get(key) ?? { amountMinor: 0, amountIlsMinor: 0 };
    g.amountMinor += p.amountMinor;
    g.amountIlsMinor += p.amountIlsMinor ?? 0;
    groups.set(key, g);
  }
  const rows = [...groups.entries()]
    .map(
      ([name, sum]) => `
<tr>
  <td>${esc(name)}</td>
  <td class="numeric">${symbol}${formatAmount(sum.amountMinor, doc.currency)}</td>
  ${showIls ? `<td class="numeric">${formatAmount(sum.amountIlsMinor, 'ILS')}₪</td>` : ''}
</tr>`,
    )
    .join('');
  return `
<table class="payments-table">
  <thead><tr><th>${esc(t.paymentMethod)}</th><th class="numeric">${esc(t.total)} (${symbol})</th>${showIls ? `<th class="numeric">${esc(t.total)} (₪)</th>` : ''}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/**
 * The visible signature image at right, above a signer line (R16 task 8, right-aligned per the
 * SUMIT reference in R17 task 6). Printed on every finalized document, both copies; never on a
 * draft preview, which carries the diagonal DRAFT stamp instead (`draftStampHtml`).
 */
function signatureBlockHtml(doc: RenderDocument, t: Record<string, string>): string {
  if (doc.status === 'draft') return '';
  return `
<div class="signature-block">
  <div class="block-title">${esc(t.signature)}</div>
  ${doc.business.signatureDataUri ? `<img class="signature-image" src="${esc(doc.business.signatureDataUri)}" alt="" />` : ''}
  <div class="signer-line"></div>
</div>`;
}

function footerHtml(lang: Lang, doc: RenderDocument, page: { number: number; of: number }, t: Record<string, string>): string {
  const typeName = lang === 'he' ? doc.typeNameHe : doc.typeNameEn;
  const numberPart = doc.number === null ? t.draft : String(doc.number);
  return `
<div class="footer">
  <div>
    <div>${esc(doc.signed === true ? t.createdAndSignedUsing : t.createdUsing)}</div>
    <div class="muted">${esc(computerizedLabel(lang))}</div>
  </div>
  <div class="footer-right">${esc(typeName)} / ${esc(numberPart)} | ${esc(t.page)} ${page.number} ${esc(t.of)} ${page.of}</div>
</div>`;
}

/**
 * The bilingual filed copy of an English document (R18 task 3), replacing the old layout that
 * stitched a full Hebrew section and a full English section together. One left-to-right section,
 * the English layout and content, where every label carries its Hebrew alongside it via `bl`/
 * `blText`. Numbers and amounts stay left-to-right, same as the plain English section.
 */
function bilingualTitleLineHtml(doc: RenderDocument): string {
  const numberLine = doc.number === null ? bl('draft') : `${blText(doc.typeNameEn, doc.typeNameHe)} ${doc.number}`;
  const badge = doc.status !== 'draft' && doc.signed === true ? `<span class="badge">${ICONS.badge}${bl('digitallySigned')}</span>` : '';
  const copyWord = doc.isOriginal ? blText('Original', 'מקור') : blText('Copy', 'העתק');
  const dateLine = doc.number === null ? '' : `<span class="copy-word">${copyWord}</span><span class="rule-sep">|</span>${formatDate(doc.date)}`;
  const createdFrom = doc.source
    ? `<div class="created-from">${bl('createdFrom')}: ${blText(doc.source.typeNameEn, doc.source.typeNameHe)} / ${doc.source.number ?? ''}</div>`
    : '';
  return `
<div class="title-line">
  <div class="doc-title">${numberLine} ${badge}</div>
  <div class="copy-date">${dateLine}</div>
</div>
${createdFrom}
<hr class="rule" />`;
}

/**
 * R19: the bilingual filed copy shows both names when both exist ("English / Hebrew", matching
 * `blText`'s fixed-label layout), and just the one it has when a client carries only one name;
 * never a stray " / " with nothing on one side.
 */
function bilingualName(nameEn: string, nameHe: string | null): string {
  const en = nameEn.trim();
  const he = (nameHe ?? '').trim();
  if (en && he) return `${esc(en)} / <span dir="rtl" lang="he">${esc(he)}</span>`;
  return esc(en || he);
}

function bilingualClientHtml(doc: RenderDocument): string {
  if (!doc.client) return '';
  const name = bilingualName(doc.client.nameEn, doc.client.nameHe);
  const address = doc.client.addressEn ? esc(doc.client.addressEn) : null;
  const cityValue = doc.client.cityEn ?? doc.client.cityHe ?? null;
  const cityLine = [cityValue ? esc(cityValue) : null, doc.client.postalCode ? esc(doc.client.postalCode) : null].filter(Boolean).join(' ');
  const idLine = doc.client.vatNumber
    ? `${bl('businessId')}: ${esc(doc.client.vatNumber)}`
    : doc.client.companyId
      ? `${bl('businessId')}: ${esc(doc.client.companyId)}`
      : '';
  return `
<div class="to-block">
  <div class="block-title">${bl('to')}:</div>
  <div class="client-name">${name}</div>
  ${address ? `<div class="muted">${address}</div>` : ''}
  ${cityLine ? `<div class="muted">${cityLine}</div>` : ''}
  ${idLine ? `<div class="muted">${idLine}</div>` : ''}
</div>`;
}

function bilingualItemsHtml(doc: RenderDocument): string {
  const symbol = currencySymbol(doc.currency);
  const showIls = doc.totalIlsMinor !== null;
  const rows = doc.lines
    .map((line) => {
      const description = esc(line.descriptionEn);
      const detailLine = line.detailEn ? `<div class="line-detail">${esc(line.detailEn)}</div>` : '';
      return `
<tr>
  <td>${description}${detailLine}</td>
  <td class="numeric">${formatQuantity(line.quantityMilli)}</td>
  <td class="numeric">${symbol} ${formatAmount(line.unitPriceMinor, doc.currency)}</td>
  <td class="numeric">${symbol} ${formatAmount(line.lineTotalMinor, doc.currency)}</td>
  ${showIls ? `<td class="numeric">₪ ${formatAmount(convertLineToIls(doc, line.lineTotalMinor), 'ILS')}</td>` : ''}
</tr>`;
    })
    .join('');
  return `
<table class="items">
  <thead>
    <tr>
      <th>${bl('description')}</th>
      <th class="numeric">${bl('qty')}</th>
      <th class="numeric">${blText(`${LABELS.en.unitPrice} (${symbol})`, LABELS.he.unitPrice ?? '')}</th>
      <th class="numeric">${blText(`${LABELS.en.total} (${symbol})`, LABELS.he.total ?? '')}</th>
      ${showIls ? `<th class="numeric">${blText(`${LABELS.en.total} (₪)`, LABELS.he.total ?? '')}</th>` : ''}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function bilingualTotalsHtml(doc: RenderDocument): string {
  const symbol = currencySymbol(doc.currency);
  const vatRow =
    doc.vatRateBp !== null
      ? `<tr><td>${blText(`${LABELS.en.vat} (${formatVatRate(doc.vatRateBp)})`, LABELS.he.vat ?? '')}</td><td class="numeric">${symbol} ${formatAmount(doc.vatAmountMinor, doc.currency)}</td></tr>`
      : '';
  const grandRow = `
<tr class="grand">
  <td>${bl('total')}</td>
  <td class="numeric"><span class="grand-amount">${formatAmount(doc.totalMinor, doc.currency)}</span> <span class="grand-ccy">${symbol}</span></td>
</tr>`;
  const ilsRow =
    doc.totalIlsMinor !== null
      ? `<tr class="grand"><td></td><td class="numeric"><span class="grand-amount">${formatAmount(doc.totalIlsMinor, 'ILS')}</span> <span class="grand-ccy">₪</span></td></tr>`
      : '';
  // R18 task 3's own example pairs this label with the plain "שער חליפין", not the more specific
  // LABELS.he.documentExchangeRate ("שער חליפין למסמך") used in the single-language sections.
  const rateRow =
    doc.totalIlsMinor !== null && doc.fxRate
      ? `<tr><td>${blText(LABELS.en.documentExchangeRate ?? '', 'שער חליפין')}</td><td class="numeric">$1&nbsp;&nbsp;=&nbsp;&nbsp;${doc.fxRate.replace(/0+$/, '').replace(/\.$/, '')}₪${doc.fxRateDate ? ` (${formatDate(doc.fxRateDate)})` : ''}</td></tr>`
      : '';
  return `
<table class="totals">
  <tr><td>${bl('subtotal')}</td><td class="numeric">${symbol} ${formatAmount(doc.subtotalMinor, doc.currency)}</td></tr>
  ${vatRow}
  ${grandRow}
  ${ilsRow}
  ${rateRow}
</table>`;
}

function bilingualPaymentInstructionsHtml(doc: RenderDocument): string {
  if (doc.kind !== 'quote' && doc.kind !== 'demand') return '';
  if (!doc.paymentInstructions) return '';
  return `
<div class="block-title">${bl('paymentInstructions')}</div>
<div class="notes">${esc(doc.paymentInstructions)}</div>`;
}

function bilingualPaymentTransferMethodHtml(doc: RenderDocument): string {
  if (doc.kind !== 'quote' && doc.kind !== 'demand') return '';
  if (doc.paymentMethods.length === 0) return '';
  const lines = doc.paymentMethods.map((m) => `<div class="payment-method-line">${esc(paymentMethodDetailText(m, 'en'))}</div>`).join('');
  return `
<div class="block-title">${bl('paymentTransferMethod')}</div>
${lines}`;
}

function bilingualPaymentMethodTableHtml(doc: RenderDocument): string {
  if (doc.payments.length === 0) return '';
  const symbol = currencySymbol(doc.currency);
  const showIls = doc.payments.some((p) => p.amountIlsMinor !== null);
  const groups = new Map<string, { amountMinor: number; amountIlsMinor: number }>();
  for (const p of doc.payments) {
    const key = p.methodDetail ? p.methodDetail.displayName : (PAYMENT_METHOD_LABELS.en[p.method] ?? p.method);
    const g = groups.get(key) ?? { amountMinor: 0, amountIlsMinor: 0 };
    g.amountMinor += p.amountMinor;
    g.amountIlsMinor += p.amountIlsMinor ?? 0;
    groups.set(key, g);
  }
  const rows = [...groups.entries()]
    .map(
      ([name, sum]) => `
<tr>
  <td>${esc(name)}</td>
  <td class="numeric">${symbol}${formatAmount(sum.amountMinor, doc.currency)}</td>
  ${showIls ? `<td class="numeric">${formatAmount(sum.amountIlsMinor, 'ILS')}₪</td>` : ''}
</tr>`,
    )
    .join('');
  return `
<table class="payments-table">
  <thead><tr><th>${bl('paymentMethod')}</th><th class="numeric">${blText(`${LABELS.en.total} (${symbol})`, LABELS.he.total ?? '')}</th>${showIls ? `<th class="numeric">${blText(`${LABELS.en.total} (₪)`, LABELS.he.total ?? '')}</th>` : ''}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function bilingualSignatureBlockHtml(doc: RenderDocument): string {
  if (doc.status === 'draft') return '';
  return `
<div class="signature-block">
  <div class="block-title">${bl('signature')}</div>
  ${doc.business.signatureDataUri ? `<img class="signature-image" src="${esc(doc.business.signatureDataUri)}" alt="" />` : ''}
  <div class="signer-line"></div>
</div>`;
}

function bilingualFooterHtml(doc: RenderDocument, page: { number: number; of: number }): string {
  const numberPart = doc.number === null ? bl('draft') : String(doc.number);
  return `
<div class="footer">
  <div>
    <div>${bl(doc.signed === true ? 'createdAndSignedUsing' : 'createdUsing')}</div>
    <div class="muted">${esc(computerizedLabel('en'))}</div>
  </div>
  <div class="footer-right">${blText(doc.typeNameEn, doc.typeNameHe)} / ${numberPart} | ${bl('page')} ${page.number} ${bl('of')} ${page.of}</div>
</div>`;
}

function bilingualRenderSection(doc: RenderDocument): string {
  const allocation =
    doc.allocationNumber !== null
      ? `<div class="allocation" dir="rtl" lang="he">${esc(allocationLabel('en'))} ${esc(doc.allocationNumber)}</div>`
      : '';
  const printNote = doc.printNote
    ? `<div class="print-note" dir="rtl" lang="he"><strong>${esc(printNoteText(doc.printNote))}</strong></div>`
    : '';
  const notTaxInvoiceNote = isProforma(doc) ? `<div class="print-note">${bl('notTaxInvoice')}</div>` : '';
  const notes = doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : '';
  const isReceiptLike = doc.kind === 'receipt' || doc.kind === 'credit' || doc.kind === 'invoice_receipt';
  return `
<section class="section en-block bilingual-block" dir="ltr" lang="en">
  ${headerHtml(doc)}
  ${bilingualTitleLineHtml(doc)}
  ${bilingualClientHtml(doc)}
  ${bilingualItemsHtml(doc)}
  ${bilingualTotalsHtml(doc)}
  ${allocation}
  ${printNote}
  ${notTaxInvoiceNote}
  ${isReceiptLike ? bilingualPaymentMethodTableHtml(doc) : bilingualPaymentTransferMethodHtml(doc)}
  ${bilingualPaymentInstructionsHtml(doc)}
  ${notes}
  ${bilingualSignatureBlockHtml(doc)}
  ${bilingualFooterHtml(doc, { number: 1, of: 1 })}
</section>`;
}

function renderSection(doc: RenderDocument, lang: Lang): string {
  const t = LABELS[lang];
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const blockClass = lang === 'he' ? 'he-block' : 'en-block';
  const allocation =
    doc.allocationNumber !== null
      ? `<div class="allocation" dir="rtl" lang="he">${esc(allocationLabel(lang))} ${esc(doc.allocationNumber)}</div>`
      : '';
  const printNote = doc.printNote
    ? `<div class="print-note" dir="rtl" lang="he"><strong>${esc(printNoteText(doc.printNote))}</strong></div>`
    : '';
  // R17 task 4: a proforma invoice always carries this disclaimer, regardless of the allocation-
  // gate print note above (which never applies to a proforma: it never qualifies for an
  // allocation number, see allocation.ts's ALLOCATION_ELIGIBLE_TYPES). R18 task 10: 300 is the
  // one proforma type going forward; PF is disabled for new documents but an already-finalized PF
  // still carries the same disclaimer when reprinted.
  const notTaxInvoiceNote = isProforma(doc) ? `<div class="print-note">${esc(t.notTaxInvoice)}</div>` : '';
  const notes = doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : '';
  const isReceiptLike = doc.kind === 'receipt' || doc.kind === 'credit' || doc.kind === 'invoice_receipt';
  return `
<section class="section ${blockClass}" dir="${dir}" lang="${lang}">
  ${headerHtml(doc)}
  ${titleLineHtml(doc, lang, t)}
  ${clientHtml(doc, lang, t)}
  ${itemsHtml(doc, lang, t)}
  ${totalsHtml(doc, t)}
  ${allocation}
  ${printNote}
  ${notTaxInvoiceNote}
  ${isReceiptLike ? paymentMethodTableHtml(doc, lang, t) : paymentTransferMethodHtml(doc, lang, t)}
  ${paymentInstructionsHtml(doc, t)}
  ${notes}
  ${signatureBlockHtml(doc, t)}
  ${footerHtml(lang, doc, { number: 1, of: 1 }, t)}
</section>`;
}

/** A diagonal stamp across every page of a draft preview (R16 task 3), so it is never mistaken for the issued document. */
function draftStampHtml(): string {
  return `<div class="draft-stamp">DRAFT, NOT A VALID DOCUMENT<br /><span dir="rtl" lang="he">טיוטה, אינה מסמך תקף</span></div>`;
}

/**
 * Renders one document as a standalone HTML page. Both variants read the same `doc`, so both
 * hash the same underlying record. A draft (`doc.status === 'draft'`) carries a diagonal DRAFT
 * stamp and, since it has no `number` yet, prints a draft label in place of one; it never carries
 * a signature or the "Digitally signed" badge.
 *
 * `doc.langVariant === 'bilingual'` (R18 task 3): the document is a Hebrew document. Both the
 * client and the filed copy render the single Hebrew (RTL) layout, under the shared header.
 *
 * `doc.langVariant === 'en'`: the client copy is the English (LTR) layout alone. The filed copy
 * is one bilingual document, the same English layout with every label's Hebrew alongside it
 * (`bilingualRenderSection`) — replacing the old design that stacked a full Hebrew section above
 * a full English one.
 */
export function renderDocument(doc: RenderDocument, variant: RenderVariant): string {
  let sections: string[];
  let title: string;
  let htmlLang: string;
  if (doc.langVariant === 'bilingual') {
    sections = [renderSection(doc, 'he')];
    title = doc.typeNameHe;
    htmlLang = 'he';
  } else if (variant === 'filed') {
    sections = [bilingualRenderSection(doc)];
    title = `${doc.typeNameEn} / ${doc.typeNameHe}`;
    htmlLang = 'en';
  } else {
    sections = [renderSection(doc, 'en')];
    title = doc.typeNameEn;
    htmlLang = 'en';
  }
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8" />
<title>${esc(title)}${doc.number !== null ? ` ${doc.number}` : ''}</title>
<style>${documentStyles()}</style>
</head>
<body>
${doc.status === 'draft' ? draftStampHtml() : ''}
${sections.join('\n')}
</body>
</html>`;
}
