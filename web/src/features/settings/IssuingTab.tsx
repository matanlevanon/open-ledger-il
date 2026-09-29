import { useEffect, useState } from 'react';
import { useSetIssuing } from '../../app/issuing';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, fetchIssuing, setIssuing } from './api';

/**
 * Settings > Issuing. Owner only: the ops routes refuse anyone else. Off hides every control
 * that creates or changes a document and the server refuses those calls. Each change is audited.
 */
export function IssuingTab() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setAppIssuing = useSetIssuing();
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    fetchIssuing()
      .then((body) => setEnabled(body.enabled))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.issuing.loadError'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (enabled === null) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const toggle = async () => {
    const next = !enabled;
    if (!next && !window.confirm(t('settings.issuing.confirmOff'))) return;
    setBusy(true);
    try {
      await setIssuing(next);
      setEnabled(next);
      setAppIssuing(next);
      toast.push(next ? t('settings.issuing.turnedOn') : t('settings.issuing.turnedOff'));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.issuing.saveError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t('settings.issuing.title')}</h2>
          <p className="text-sm text-muted">{enabled ? t('settings.issuing.stateOn') : t('settings.issuing.stateOff')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('settings.issuing.title')}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-brand' : 'bg-line'}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-canvas shadow transition-all ${enabled ? 'end-1' : 'start-1'}`} />
        </button>
      </div>
      <p className="text-sm text-ink">{t('settings.issuing.explainOff')}</p>
      <p className="text-sm text-ink">{t('settings.issuing.explainKeeps')}</p>
      <p className="text-sm text-muted">{t('settings.issuing.explainRecurring')}</p>
      <p className="text-sm text-muted">{t('settings.issuing.explainWho')}</p>
    </div>
  );
}
