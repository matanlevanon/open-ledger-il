import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { type SwitchResult, SwitchResultView } from '../documents/SwitchResultView';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';
import { todayIsrael } from '../reports/period';

/** The word the owner types to confirm. Confirm stays disabled until it matches exactly. */
export const CONFIRM_WORD = 'מורשה';

/** Confirm needs the exact word, after trimming spaces at the ends. */
export function confirmMatches(typed: string): boolean {
  return typed.trim() === CONFIRM_WORD;
}

export function TypedConfirm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="block">
      <span className={label}>{t('settings.businessType.typeToConfirm', { word: CONFIRM_WORD })}</span>
      <input dir="rtl" className={`${input} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={CONFIRM_WORD} />
    </label>
  );
}

interface Props {
  /** "Already registered" shows only on a fresh Ledger, before the first final document. */
  fresh: boolean;
  onClose: () => void;
  /** Runs after a confirmed switch, to reload the card. */
  onSwitched: () => void;
}

/** R24 Screen B: switch to עוסק מורשה from Settings > Tax. One way, with a typed confirmation. */
export function BusinessTypeSwitchDialog({ fresh, onClose, onSwitched }: Props) {
  const t = useT();
  const today = todayIsrael();
  const [kind, setKind] = useState<'registered' | 'becoming'>(fresh ? 'registered' : 'becoming');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwitchResult | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const body = kind === 'registered' ? { kind } : { kind, effectiveDate };
      setResult(await apiSend<SwitchResult>('POST', '/legal-mode/switch', body));
      onSwitched();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.businessType.switchError'));
    } finally {
      setBusy(false);
    }
  }

  const choice = (value: 'registered' | 'becoming', title: string, text: string) => (
    <label className={`flex gap-3 rounded-md border p-3 ${kind === value ? 'border-brand bg-surface' : 'border-line'}`}>
      <input type="radio" name="switch-kind" checked={kind === value} onChange={() => setKind(value)} />
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open
      title={t('settings.businessType.switchTitle')}
      onClose={onClose}
      footer={
        result ? (
          <button type="button" className={btnPrimary} onClick={onClose}>
            {t('settings.businessType.done')}
          </button>
        ) : (
          <>
            <button type="button" className={btnSecondary} onClick={onClose}>
              {t('ceilingCrossing.cancel')}
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !confirmMatches(typed)} onClick={() => void confirm()}>
              {t('settings.businessType.confirmSwitch')}
            </button>
          </>
        )
      }
    >
      {result ? (
        <SwitchResultView result={result} />
      ) : (
        <div className="space-y-3 text-sm">
          {fresh && choice('registered', t('settings.businessType.registeredTitle'), t('settings.businessType.registeredText'))}
          {choice('becoming', t('settings.businessType.becomingTitle'), t('settings.businessType.becomingText'))}
          {kind === 'becoming' && (
            <label className="block">
              <span className={label}>{t('settings.businessType.startDate')}</span>
              <input type="date" dir="ltr" min={today} className={`${input} mt-1`} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </label>
          )}
          <p className="rounded-md bg-surface p-3 text-ink">{t('settings.businessType.whatChanges')}</p>
          <TypedConfirm value={typed} onChange={setTyped} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
