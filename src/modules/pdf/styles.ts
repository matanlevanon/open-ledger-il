import { FONT_STACK, fontFaceCss } from './fonts';

/**
 * Page CSS (R17 task 6): a white A4 page, a business header with an icon row and the logo tile, a title line with a signed badge and an Original/Copy stamp, a light-ruled items
 * table, right-aligned totals, and a right-aligned signature block above a footer rule. Numbers
 * stay left-to-right even in the Hebrew section (`.ltr-nums`, matching the web app's own rule).
 */
export function documentStyles(): string {
  return `
${fontFaceCss()}
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ${FONT_STACK};
  font-size: 10.5pt;
  color: #1a1a1a;
  background: #ffffff;
}
.section { padding: 5mm 0; }
.section + .section { border-top: 1px solid #dde3eb; }
.he-block { direction: rtl; text-align: right; }
.en-block { direction: ltr; text-align: left; }
.ltr-nums { direction: ltr; unicode-bidi: isolate; }
.muted { color: #6b7280; }

/* R18 task 1: one header, always the English layout. text-align is a physical value here (not
   "start"), so it stays left even inside an .he-block section, whose own text-align: right would
   otherwise cascade in. position: absolute + a physical "right", not flex, keeps the logo tile at
   the same visual corner there too: flex mirrors direction, which pushed it off the page's other
   edge and reversed the icon row's own icon-before-label order. */
.header-top { position: relative; padding-right: 20mm; text-align: left; }
.header-top .icon-row { flex-direction: row; }
.header-top .icon-item { flex-direction: row; }
.business-name { font-size: 16pt; font-weight: 700; }
.tagline { margin-top: 1mm; font-size: 10pt; color: #4b5563; }
.icon-row { margin-top: 2.5mm; display: flex; flex-wrap: wrap; gap: 6mm; font-size: 9pt; color: #374151; }
.icon-item { display: inline-flex; align-items: center; gap: 1.5mm; white-space: nowrap; }
.icon { width: 3.4mm; height: 3.4mm; flex: none; color: #6b7280; }
.logo-tile { position: absolute; top: 0; right: 0; width: 44mm; height: 16mm; }
.logo-tile svg, .logo-tile .logo-image { width: 100%; height: 100%; object-fit: contain; object-position: right top; }
.rule { border: none; border-top: 1px solid #dde3eb; margin: 4mm 0; }

.title-line { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 2mm; }
.doc-title { font-size: 13.5pt; font-weight: 700; display: flex; align-items: center; gap: 2mm; }
.badge { display: inline-flex; align-items: center; gap: 1mm; font-size: 8.5pt; font-weight: 600; color: #2a6fdb; white-space: nowrap; }
.badge .icon { width: 3.2mm; height: 3.2mm; color: #2a6fdb; }
.copy-date { font-size: 9.5pt; color: #374151; display: flex; align-items: center; gap: 2mm; white-space: nowrap; }
.copy-word { font-weight: 600; }
.rule-sep { color: #c7ccd4; }
.created-from { margin-top: 2mm; font-size: 9.5pt; color: #374151; }

.to-block { margin-top: 4mm; font-size: 9.5pt; }
.block-title { font-weight: 700; margin: 0 0 1mm; font-size: 9.5pt; }
.client-name { font-weight: 700; font-size: 10.5pt; }

table.items { width: 100%; border-collapse: collapse; margin-top: 5mm; font-size: 9.5pt; }
table.items th, table.items td { padding: 2.5mm 2.5mm; border-bottom: 1px solid #eceff3; vertical-align: top; }
table.items th { text-align: inherit; font-weight: 700; color: #374151; }
/* R18 task 4: the line's optional description, below the item name inside the same cell. */
.line-detail { margin-top: 0.5mm; font-size: 8.5pt; color: #6b7280; font-weight: 400; }
.numeric { text-align: right; }
.he-block .numeric { text-align: left; direction: ltr; }

.totals { width: 60%; margin-inline-start: auto; margin-top: 3mm; font-size: 9.5pt; }
.totals td { padding: 1.2mm 2.5mm; }
.totals tr.grand td { padding-top: 2.5mm; }
.grand-amount { font-size: 13pt; font-weight: 700; }
.grand-ccy { font-size: 10pt; color: #6b7280; }

.allocation { margin-top: 4mm; font-size: 10pt; font-weight: 700; }
.print-note { margin-top: 3mm; font-size: 9.5pt; font-weight: 700; color: #8a1f11; }
.print-note + .block-title { margin-top: 3mm; }

.payments-table, .payment-method-line { margin-top: 4mm; }
table.payments-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
table.payments-table th, table.payments-table td { padding: 1.5mm 2.5mm; border-bottom: 1px solid #eceff3; }
.payment-method-line { font-size: 9.5pt; font-weight: 700; }

.notes { margin-top: 4mm; font-size: 9.5pt; white-space: pre-wrap; }

.signature-block { margin-top: 8mm; text-align: end; }
.signature-block .block-title { margin-bottom: 1mm; }
.signature-image { height: 20mm; width: auto; }
.signer-line { margin-top: -1mm; border-top: 1px solid #9aa1ac; width: 45mm; margin-inline-start: auto; }

.footer {
  margin-top: 8mm;
  padding-top: 3mm;
  border-top: 1px solid #dde3eb;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 4mm;
  font-size: 8pt;
  color: #6b7280;
}
.footer-right { white-space: nowrap; }

.draft-stamp {
  position: fixed;
  top: 45%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-30deg);
  font-size: 30pt;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
  color: rgba(178, 30, 24, 0.4);
  border: 3mm solid rgba(178, 30, 24, 0.4);
  padding: 4mm 10mm;
  white-space: nowrap;
  z-index: 999;
  pointer-events: none;
}
`.trim();
}
