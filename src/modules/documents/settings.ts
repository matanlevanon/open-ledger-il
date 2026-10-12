import { readBusinessSetting } from '../../core/business';

/** R24: a business's own value wins, else the shared one. */
const setting = (db: D1Database, businessId: number, key: string) => readBusinessSetting(db, businessId, key);

/** Days a document may be dated before today without the owner's override. Seeded in 0100. */
export async function backdateDays(db: D1Database, businessId: number): Promise<number> {
  const n = Number(await setting(db, businessId, 'documents.backdate_days'));
  return Number.isSafeInteger(n) && n >= 0 ? n : 3;
}

export async function quotesEditableUntilConverted(db: D1Database, businessId: number): Promise<boolean> {
  return (await setting(db, businessId, 'documents.qt_pr_editable_until_converted')) !== 'false';
}

export type SignatureMode = 'secured' | 'none';

/**
 * Signature mode, owned by R03 (key `signature_mode`). Documents are signed with a secured
 * signature by default (instruction 18ב), so a missing setting reads as `secured`.
 */
export async function signatureMode(db: D1Database, businessId: number): Promise<SignatureMode> {
  return (await setting(db, businessId, 'signature_mode')) === 'none' ? 'none' : 'secured';
}
