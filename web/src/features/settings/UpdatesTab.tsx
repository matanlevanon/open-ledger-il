import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, type UpdateCheck, type UpdatesInfo, checkUpdatesNow, fetchUpdates } from './api';

/** Settings > Updates: the running version, the last check, and a Check for updates button. */
export function UpdatesTab() {
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    fetchUpdates()
      .then(setInfo)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.updates.loadErrorFallback'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!info) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const check = async () => {
    setChecking(true);
    try {
      setInfo(await checkUpdatesNow());
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.updates.checkErrorFallback'), 'danger');
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg text-ink">{t('settings.updates.title')}</h2>
      <p className="text-xs text-muted">{t('settings.updates.hint')}</p>
      <p className="text-sm text-ink">{t('settings.updates.current', { version: info.current })}</p>
      <button
        type="button"
        disabled={checking}
        onClick={check}
        className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface disabled:opacity-60"
      >
        {checking ? t('settings.updates.checkingButton') : t('settings.updates.checkButton')}
      </button>
      {info.last ? <Result last={info.last} /> : <p className="text-sm text-muted">{t('settings.updates.never')}</p>}
    </section>
  );
}

function Result({ last }: { last: UpdateCheck }) {
  const t = useT();
  const when = new Date(last.checkedAt).toLocaleString();
  return (
    <div className="flex flex-col gap-1">
      {last.status === 'update_available' && (
        <p className="text-sm font-semibold text-brand">
          {t('settings.updates.available', { version: last.latest ?? '' })}{' '}
          {last.releaseUrl && (
            <a href={last.releaseUrl} target="_blank" rel="noreferrer" className="underline">
              {t('settings.updates.releaseNotes')}
            </a>
          )}
        </p>
      )}
      {last.status === 'up_to_date' && <p className="text-sm text-success">{t('settings.updates.upToDate')}</p>}
      {last.status === 'off' && <p className="text-sm text-muted">{t('settings.updates.off')}</p>}
      {last.status === 'no_releases' && <p className="text-sm text-muted">{t('settings.updates.noReleases')}</p>}
      {last.status === 'error' && <p className="text-sm text-danger">{t('settings.updates.error', { message: last.message })}</p>}
      <p className="text-xs text-muted">{t('settings.updates.lastChecked', { date: when })}</p>
    </div>
  );
}
