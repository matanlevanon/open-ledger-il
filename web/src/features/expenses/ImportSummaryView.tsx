import { Link } from 'react-router-dom';
import { type MessageKey, useT } from '../../i18n';
import type { ImportSkipReason, ImportSummary } from './api';

const SOURCE_KEYS: Record<ImportSummary['source'], MessageKey> = {
  sheet: 'expenses.import.sourceSheet',
  folder: 'expenses.import.sourceFolder',
  none: 'expenses.import.sourceNone',
  failed: 'expenses.import.sourceFailed',
};

const REASON_KEYS: Record<ImportSkipReason, MessageKey> = {
  drive_file: 'expenses.import.reasonDriveFile',
  file_hash: 'expenses.import.reasonFileHash',
  supplier_number: 'expenses.import.reasonSupplierNumber',
  supplier_date_total: 'expenses.import.reasonSupplierDateTotal',
  issued_by_self: 'expenses.import.reasonIssuedBySelf',
};

/** The counts line for one import run. No links, so it also renders outside the router. */
export function ImportCounts({ summary }: { summary: ImportSummary }) {
  const t = useT();
  return (
    <p className="text-sm text-ink">
      {t('expenses.import.counts', {
        month: summary.yearMonth,
        source: t(SOURCE_KEYS[summary.source]),
        seen: summary.filesSeen,
        created: summary.created,
        duplicate: summary.skippedDuplicate,
        notExpense: summary.skippedNotExpense,
        self: summary.skippedIssuedBySelf,
        errors: summary.errors,
      })}
    </p>
  );
}

/** The full result of one import: counts, sheet statuses, each skip linked to the expense it matched, and errors. */
export function ImportSummaryView({ summary }: { summary: ImportSummary }) {
  const t = useT();
  const statuses = Object.entries(summary.statusCounts);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-canvas p-4 text-sm" aria-live="polite">
      <ImportCounts summary={summary} />
      {statuses.length > 0 && (
        <p className="text-muted">
          {t('expenses.import.statusCounts')}{' '}
          {statuses.map(([status, count]) => (
            <span key={status} className="me-3 inline-block">
              <span dir="rtl">{status}</span> <span className="ltr-nums">{count}</span>
            </span>
          ))}
        </p>
      )}
      {summary.skips.length > 0 && (
        <ul className="flex flex-col gap-1">
          {summary.skips.map((s, i) => (
            <li key={i}>
              <span dir="auto">{s.ref}</span>: {t(REASON_KEYS[s.reason])}
              {s.expenseId !== null && (
                <>
                  {' '}
                  <Link to={`/expenses/${s.expenseId}`} className="text-brand hover:underline">
                    {t('expenses.import.matchedExpense', { id: s.expenseId })}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {summary.errorList.length > 0 && (
        <ul className="flex flex-col gap-1 text-danger">
          {summary.errorList.map((e, i) => (
            <li key={i}>
              <span dir="auto">{e.ref}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
