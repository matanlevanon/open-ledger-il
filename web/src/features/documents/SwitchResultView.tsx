import { Link } from 'react-router-dom';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { clientName } from './format';
import { label } from './ui';

/** src/modules/documents/service.ts's OpenPaymentRequestSummary. */
export interface OpenPaymentRequest {
  id: number;
  displayNumber: string | null;
  clientNameEn: string | null;
  clientNameHe: string | null;
  date: string;
  currency: string;
  totalMinor: number;
}

/** src/modules/legal-mode/service.ts's SwitchResult, plus the route's message. */
export interface SwitchResult {
  message: string;
  openPaymentRequests: OpenPaymentRequest[];
  repricedDrafts: number[];
  vatOfficeTaskDueAt?: string | null;
}

/**
 * The switch result: series closed and opened, the VAT office date, and every open payment request
 * to reissue or cancel by hand (CLAUDE.md rule 1). Shared by the ceiling-crossing dialog and the
 * Settings > Tax business type popup (R24).
 */
export function SwitchResultView({ result }: { result: SwitchResult }) {
  const t = useT();
  const { locale } = usePreferences();
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-line bg-surface p-3 text-ink">{result.message}</p>
      {result.openPaymentRequests.length > 0 && (
        <div className="rounded-md border border-line bg-surface p-3">
          <p className={label}>{t('ceilingCrossing.openPaymentRequestsLabel')}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.openPaymentRequests.map((pr) => (
              <li key={pr.id} className="flex items-center justify-between gap-3">
                <Link to={`/income/documents/${pr.id}`} className="text-brand underline">
                  {pr.displayNumber ?? `PR-${pr.id}`}
                </Link>
                <span className="text-ink">{clientName({ name_en: pr.clientNameEn, name_he: pr.clientNameHe }, locale) || t('documents.noClient')}</span>
                <span className="ltr-nums text-ink">{formatMoney(pr.totalMinor, pr.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
