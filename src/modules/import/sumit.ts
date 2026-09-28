import type { HistorySourceKind } from './types';

/**
 * SUMIT unified-file (מבנה אחיד) record splitting.
 *
 * runs/R10-import.md: "parse C100 headers, D110 lines, D120 payments into history. Use the
 * unified-file spec in specs/unified-file/ when present, otherwise parse by the record layouts
 * documented in R13's output if merged, otherwise leave a clear stub." Neither exists yet
 * (specs/unified-file/README.md only asks for the PDF before R13; R13 has not shipped), so this
 * module only decodes what the format guarantees regardless of field layout: BKMVDATA.TXT is one
 * fixed-width record per line, and every record starts with a stable record-type code (its first
 * few characters). Field-by-field decoding of C100/D110/D120 is a clear, named stub below; the
 * raw line is kept in `history.raw_line` so a later run can decode it without re-importing.
 */

const RECORD_TYPE_PATTERN = /^([A-Z]\d{3})/;

export const HISTORY_RECORD_TYPES: Record<string, HistorySourceKind> = {
  C100: 'sumit_c100',
  D110: 'sumit_d110',
  D120: 'sumit_d120',
};

export const DECODE_STUB_NOTE =
  'Field layout not decoded: no unified-file spec in specs/unified-file/ and R13 has not shipped record layouts yet ' +
  '(runs/R10-import.md fallback). The raw fixed-width line is kept for a later decode.';

export interface UnifiedRecord {
  lineNumber: number;
  recordType: string | null;
  line: string;
}

/** Splits BKMVDATA.TXT into records. One record per line, per every real-world unified-file export. */
export function splitBkmvdataRecords(text: string): UnifiedRecord[] {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  return lines.map((line, i) => ({
    lineNumber: i + 1,
    recordType: RECORD_TYPE_PATTERN.exec(line)?.[1] ?? null,
    line,
  }));
}

export interface RecordTypeCounts {
  [recordType: string]: number;
}

export function countByRecordType(records: UnifiedRecord[]): RecordTypeCounts {
  const counts: RecordTypeCounts = {};
  for (const r of records) {
    const key = r.recordType ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** SHA-256 hex of a record line, used as the idempotency key so re-importing the same export
 * (or an overlapping later one) never duplicates a history row. */
export async function recordHash(line: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(line));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
