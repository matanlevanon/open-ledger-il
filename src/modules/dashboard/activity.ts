import { all } from '../../core/db';

/**
 * Recent activity for the phone Quick page: the latest documents and expenses, newest first.
 * A document counts from the moment it was issued (finalized_at), a draft from when it was
 * created. An expense counts from when it was uploaded or imported.
 */
export interface ActivityItem {
  kind: 'document' | 'expense';
  id: number;
  at: string;
  /** Document type code, for example 400 or PR. Null for an expense. */
  type: string | null;
  number: number | null;
  status: string;
  /** Client name for a document, supplier name for an expense. */
  name: string | null;
  nameHe: string | null;
  currency: string;
  amountMinor: number;
}

export const ACTIVITY_DEFAULT_LIMIT = 15;
export const ACTIVITY_MAX_LIMIT = 50;

export async function recentActivity(db: D1Database, limit = ACTIVITY_DEFAULT_LIMIT): Promise<ActivityItem[]> {
  const n = Math.min(Math.max(1, Math.trunc(limit) || ACTIVITY_DEFAULT_LIMIT), ACTIVITY_MAX_LIMIT);
  return all<ActivityItem>(
    db,
    `SELECT * FROM (
       SELECT 'document' AS kind, d.id AS id, COALESCE(d.finalized_at, d.created_at) AS at, d.type AS type,
              d.number AS number, d.status AS status, c.name_en AS name, c.name_he AS nameHe,
              d.currency AS currency, d.total_minor AS amountMinor
         FROM documents d LEFT JOIN clients c ON c.id = d.client_id
       UNION ALL
       SELECT 'expense', e.id, e.created_at, NULL, NULL, e.status, s.name, NULL, e.currency, e.amount_minor
         FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
     )
     ORDER BY at DESC, kind, id DESC
     LIMIT ?`,
    n,
  );
}
