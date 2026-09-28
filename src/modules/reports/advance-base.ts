import { all } from '../../core/db';

/**
 * Advance-payment base (מקדמות): cash received, by month, the figure Israeli advance tax
 * payments are computed from. Payments on a credit receipt already carry a negative amount
 * (R01 decision, docs/progress.md), so a credit lowers the base of the month it lands in rather
 * than needing its own sign handling here. Only payments on a `final` document count; a
 * `cancelled` document's payments never happened as far as the base is concerned.
 */
export interface AdvanceBaseMonth {
  month: string;
  totalIlsMinor: number;
}

export interface AdvanceBaseReport {
  from: string;
  to: string;
  months: AdvanceBaseMonth[];
  totalIlsMinor: number;
}

export async function advanceBaseReport(db: D1Database, from: string, to: string): Promise<AdvanceBaseReport> {
  const rows = await all<{ month: string; total_minor: number | null }>(
    db,
    `SELECT strftime('%Y-%m', p.paid_on) AS month,
       SUM(COALESCE(p.amount_ils_minor, CASE WHEN p.currency = 'ILS' THEN p.amount_minor ELSE NULL END)) AS total_minor
     FROM payments p JOIN documents d ON d.id = p.document_id
     WHERE d.status = 'final' AND p.paid_on BETWEEN ? AND ?
     GROUP BY month ORDER BY month`,
    from,
    to,
  );
  const months = rows.map((r) => ({ month: r.month, totalIlsMinor: r.total_minor ?? 0 }));
  return { from, to, months, totalIlsMinor: months.reduce((s, m) => s + m.totalIlsMinor, 0) };
}
