import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, type BackupRow, type GapCheckResult, fetchBackups, runBackupNow, runChecksNow } from './api';

export function BackupsTab() {
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<GapCheckResult | null>(null);
  const toast = useToast();
  const t = useT();

  const load = () =>
    fetchBackups()
      .then((body) => setBackups(body.backups))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.backups.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!backups) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const runBackup = async () => {
    setRunning(true);
    try {
      const result = await runBackupNow();
      toast.push(
        result.restoreOk
          ? t('settings.backups.backupSuccess')
          : t('settings.backups.backupFailure', { error: result.restoreError ?? '' }),
        result.restoreOk ? 'success' : 'danger',
      );
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.backups.runBackupErrorFallback'), 'danger');
    } finally {
      setRunning(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      const result = await runChecksNow();
      setLastCheck(result);
      toast.push(result.ok ? t('settings.backups.checkSuccess') : t('settings.backups.checkFailure'), result.ok ? 'success' : 'danger');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.backups.runCheckErrorFallback'), 'danger');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.backups.checkTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.backups.checkHint')}</p>
        <button
          type="button"
          disabled={checking}
          onClick={runCheck}
          className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface disabled:opacity-60"
        >
          {checking ? t('settings.backups.checkingButton') : t('settings.backups.runCheckButton')}
        </button>
        {lastCheck && (
          <p className={`text-sm ${lastCheck.ok ? 'text-success' : 'text-danger'}`}>
            {lastCheck.ok
              ? t('settings.backups.checkClean', { count: lastCheck.chain.checked })
              : t('settings.backups.checkProblem', {
                  chainOk: lastCheck.chain.ok ? t('settings.backups.chainOkYes') : t('settings.backups.chainOkNo'),
                  series:
                    lastCheck.series
                      .filter((s) => !s.ok)
                      .map((s) => s.docType)
                      .join(', ') || t('settings.backups.seriesNone'),
                })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.backups.backupsTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.backups.backupsHint')}</p>
        <button
          type="button"
          disabled={running}
          onClick={runBackup}
          className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
        >
          {running ? t('settings.backups.runningButton') : t('settings.backups.runBackupButton')}
        </button>
        <table className="mt-2 w-full text-start text-sm">
          <caption className="sr-only">{t('settings.backups.caption')}</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-2">{t('settings.backups.colWhen')}</th>
              <th>{t('settings.backups.colKind')}</th>
              <th>{t('settings.backups.colTables')}</th>
              <th>{t('settings.backups.colDocuments')}</th>
              <th>{t('settings.backups.colRestoreTest')}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="py-2 ltr-nums">{b.ran_at}</td>
                <td className="capitalize">{b.kind}</td>
                <td className="ltr-nums">{b.table_count}</td>
                <td className="ltr-nums">{b.document_count}</td>
                <td className={b.restore_ok ? 'text-success' : 'text-danger'}>
                  {b.restore_ok ? t('settings.backups.restorePassed') : t('settings.backups.restoreFailed', { error: b.restore_error ?? '' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
