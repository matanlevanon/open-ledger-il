import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { apiSend } from './api';
import { type SwitchResult, SwitchResultView } from './SwitchResultView';
import { btn, btnPrimary, btnSecondary, input, label } from './ui';

/** Matches src/modules/ceiling/guard.ts's CeilingCrossingDetails, the CEILING_CROSSING error's `details`. */
export interface CeilingCrossingDetails {
  year: number;
  currency: string;
  turnoverMinor: number;
  amountMinor: number;
  limitMinor: number;
  gapMinor: number;
}

interface CeilingCrossingDialogProps {
  details: CeilingCrossingDetails;
  onClose: () => void;
  /** Re-attempts the same finalize call, for the "Issue as עוסק פטור" action. */
  onRetry: () => void;
}

/**
 * The three actions from docs/legal-requirements.md, "Ceiling guard", point 3: confirm the
 * switch to עוסק מורשה, retry the receipt as עוסק פטור (only actually issuable once the
 * underlying numbers allow it, which "Issue as פטור" simply re-checks by retrying), or cancel.
 *
 * CLAUDE.md rule 1: confirming the switch never touches a final document itself. Any open
 * payment request comes back in the result so the owner can reissue or cancel it from its own
 * document screen; "reprice drafts" is an explicit opt-in that only ever reaches open drafts.
 */
export function CeilingCrossingDialog({ details, onClose, onRetry }: CeilingCrossingDialogProps) {
  const t = useT();
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [repriceDrafts, setRepriceDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwitchResult | null>(null);

  async function confirmSwitch() {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiSend<SwitchResult>('POST', '/legal-mode/switch', { effectiveDate, repriceDrafts }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ceilingCrossing.switchError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={t('ceilingCrossing.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose}>
            {t('ceilingCrossing.cancel')}
          </button>
          <button type="button" className={btn} onClick={onRetry}>
            {t('ceilingCrossing.issueAsPatur')}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink">
          {t('ceilingCrossing.turnoverSoFar', { year: details.year })} <strong className="ltr-nums">{formatMoney(details.turnoverMinor, details.currency)}</strong>.
        </p>
        <p className="text-ink">
          {t('ceilingCrossing.thisReceipt')} <strong className="ltr-nums">{formatMoney(details.amountMinor, details.currency)}</strong>.
        </p>
        <p className="text-ink">
          {t('ceilingCrossing.ceiling')} <strong className="ltr-nums">{formatMoney(details.limitMinor, details.currency)}</strong>. {t('ceilingCrossing.roomLeft')}{' '}
          <strong className="ltr-nums">{formatMoney(details.gapMinor, details.currency)}</strong>.
        </p>

        {result ? (
          <SwitchResultView result={result} />
        ) : (
          <div className="rounded-md border border-line bg-surface p-3">
            <label className="block">
              <span className={label}>{t('ceilingCrossing.effectiveDateLabel')}</span>
              <input type="date" dir="ltr" className={`${input} mt-1`} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={repriceDrafts} onChange={(e) => setRepriceDrafts(e.target.checked)} />
              {t('ceilingCrossing.repriceDraftsLabel')}
            </label>
            <button type="button" disabled={busy} onClick={() => void confirmSwitch()} className={`${btnPrimary} mt-2`}>
              {t('ceilingCrossing.confirmSwitch')}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
