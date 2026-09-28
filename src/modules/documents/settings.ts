import { first } from '../../core/db';

async function setting(db: D1Database, key: string): Promise<string | null> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

/** Days a document may be dated before today without the owner's override. Seeded in 0100. */
export async function backdateDays(db: D1Database): Promise<number> {
  const n = Number(await setting(db, 'documents.backdate_days'));
  return Number.isSafeInteger(n) && n >= 0 ? n : 3;
}

export async function quotesEditableUntilConverted(db: D1Database): Promise<boolean> {
  return (await setting(db, 'documents.qt_pr_editable_until_converted')) !== 'false';
}

export type SignatureMode = 'secured' | 'none';

/**
 * Signature mode, owned by R03 (key `signature_mode`). Documents are signed with a secured
 * signature by default (instruction 18ב), so a missing setting reads as `secured`.
 */
export async function signatureMode(db: D1Database): Promise<SignatureMode> {
  return (await setting(db, 'signature_mode')) === 'none' ? 'none' : 'secured';
}
