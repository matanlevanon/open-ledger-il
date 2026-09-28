/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes ("") and commas or newlines inside
 * quotes. No dependency, since Wave and generic spreadsheet exports need nothing more exotic.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a UTF-8 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < body.length) {
    const ch = body[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();

  const [headers, ...dataRows] = rows;
  return { headers: (headers ?? []).map((h) => h.trim()), rows: dataRows };
}

/** Row array -> record keyed by header, for a mapping step that reads by header name. */
export function toRecords(csv: ParsedCsv): Record<string, string>[] {
  return csv.rows.map((row) => {
    const rec: Record<string, string> = {};
    csv.headers.forEach((h, idx) => {
      rec[h] = (row[idx] ?? '').trim();
    });
    return rec;
  });
}
