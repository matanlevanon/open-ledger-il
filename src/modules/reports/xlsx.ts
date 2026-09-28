import { zipSync } from 'fflate';

/**
 * A minimal .xlsx writer: no dependency exists in package.json (runs/_common.md: add one with
 * `npx npm@11 install <pkg>` only when a run's own build needs it; a hand-rolled writer over
 * the already-present `fflate` zip avoids a new dependency for a handful of report sheets).
 * OOXML SpreadsheetML, inline strings (no sharedStrings.xml), one worksheet part per sheet.
 * No styles or docProps parts: Excel, LibreOffice and Google Sheets all open a file with only
 * the required parts.
 */
export interface XlsxSheet {
  /** Sheet tab name. Excel caps this at 31 characters; longer names are truncated. */
  name: string;
  /** Row 0 is the header row. A number renders as a numeric cell, anything else as text. */
  rows: (string | number)[][];
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 0-based column index to a spreadsheet column letter: 0 -> A, 25 -> Z, 26 -> AA. */
function colRef(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(value: string | number, ref: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function sheetXml(rows: (string | number)[][]): string {
  const rowsXml = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(v, `${colRef(c)}${r + 1}`)).join('')}</row>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

function contentTypesXml(sheetCount: number): string {
  const overrides = Array.from(
    { length: sheetCount },
    (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `${overrides}</Types>`
  );
}

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

function workbookXml(sheets: XlsxSheet[]): string {
  const tags = sheets
    .map((s, i) => `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tags}</sheets></workbook>`
  );
}

function workbookRelsXml(sheets: XlsxSheet[]): string {
  const rels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new RangeError('buildXlsx needs at least one sheet.');
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc.encode(contentTypesXml(sheets.length)),
    '_rels/.rels': enc.encode(ROOT_RELS),
    'xl/workbook.xml': enc.encode(workbookXml(sheets)),
    'xl/_rels/workbook.xml.rels': enc.encode(workbookRelsXml(sheets)),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = enc.encode(sheetXml(s.rows));
  });
  return zipSync(files, { level: 6 });
}
