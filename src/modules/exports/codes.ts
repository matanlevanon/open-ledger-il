import { all } from '../../core/db';

/**
 * Internal document type code to the ITA unified-file "document type" code.
 *
 * migrations/1300_exports.sql seeds one row per document type with `spec_code = NULL`: the
 * record-layout PDF was never dropped into specs/unified-file/ before this run, and CLAUDE.md
 * plus runs/R13-exports.md both say never guess a document code. `resolveDocTypeCode` falls back
 * to the internal code so the export still runs end to end (record counts, padding, encoding all
 * exercised), but flags every fallback in the caller's warnings so nobody mistakes the output for
 * an ITA-verified file.
 */

export interface DocTypeCodeRow {
  internal_code: string;
  spec_code: string | null;
  note: string | null;
}

export async function loadDocTypeCodes(db: D1Database): Promise<Map<string, DocTypeCodeRow>> {
  const rows = await all<DocTypeCodeRow>(db, 'SELECT internal_code, spec_code, note FROM unified_file_doc_type_codes');
  return new Map(rows.map((r) => [r.internal_code, r]));
}

export interface ResolvedDocTypeCode {
  code: string;
  confirmed: boolean;
}

/** The spec code for a document type, or the internal code as an explicitly-flagged placeholder. */
export function resolveDocTypeCode(internalCode: string, codes: Map<string, DocTypeCodeRow>): ResolvedDocTypeCode {
  const row = codes.get(internalCode);
  if (row?.spec_code) return { code: row.spec_code, confirmed: true };
  return { code: internalCode, confirmed: false };
}
