import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { type DriveSettings, fetchDriveSettings, saveDailySync, saveDriveRootFolder, saveIndexTitlePattern } from '../expenses/api';
import { ImportCounts } from '../expenses/ImportSummaryView';
import { ApiError } from './api';

/** R20: the Drive root folder, the daily sync switch, and the log of every import run. Owner only. */
export function ExpensesTab() {
  const [settings, setSettings] = useState<DriveSettings | null>(null);
  const [folderId, setFolderId] = useState('');
  const [titlePattern, setTitlePattern] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const t = useT();

  const load = () =>
    fetchDriveSettings()
      .then((body) => {
        setSettings(body);
        setFolderId(body.folderId ?? '');
        setTitlePattern(body.indexTitlePattern ?? '');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.expenses.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!settings) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const saveFolder = async () => {
    setSaving(true);
    try {
      await saveDriveRootFolder(folderId.trim());
      toast.push(t('settings.expenses.folderSaved'), 'success');
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.expenses.saveErrorFallback'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = async () => {
    setSaving(true);
    try {
      await saveIndexTitlePattern(titlePattern.trim());
      toast.push(t('settings.expenses.titleSaved'), 'success');
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.expenses.saveErrorFallback'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const toggleSync = async () => {
    const next = !settings.dailySync;
    try {
      await saveDailySync(next);
      setSettings({ ...settings, dailySync: next });
      toast.push(next ? t('settings.expenses.syncOn') : t('settings.expenses.syncOff'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.expenses.saveErrorFallback'), 'danger');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.expenses.folderTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.expenses.folderHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="drive-root-folder">
            {t('settings.expenses.folderLabel')}
          </label>
          <input
            id="drive-root-folder"
            value={folderId}
            placeholder={t('settings.expenses.folderPlaceholder')}
            onChange={(e) => setFolderId(e.target.value)}
            className="ltr-nums min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm"
            dir="ltr"
          />
          <button
            type="button"
            disabled={saving || !folderId.trim()}
            onClick={saveFolder}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
          >
            {t('settings.expenses.saveFolder')}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.expenses.titleTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.expenses.titleHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="drive-index-title">
            {t('settings.expenses.titleLabel')}
          </label>
          <input
            id="drive-index-title"
            value={titlePattern}
            onChange={(e) => setTitlePattern(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm"
            dir="auto"
          />
          <button
            type="button"
            disabled={saving || !titlePattern.trim()}
            onClick={saveTitle}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
          >
            {t('settings.expenses.saveTitle')}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.expenses.syncTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.expenses.syncHint')}</p>
        <label className="flex w-fit items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={settings.dailySync} onChange={toggleSync} />
          {t('settings.expenses.syncLabel')}
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.expenses.runsTitle')}</h2>
        {settings.runs.length === 0 ? (
          <p className="text-sm text-muted">{t('settings.expenses.runsEmpty')}</p>
        ) : (
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{t('settings.expenses.runsTitle')}</caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="py-2">{t('settings.expenses.colWhen')}</th>
                <th>{t('settings.expenses.colTrigger')}</th>
                <th>{t('settings.expenses.colResult')}</th>
              </tr>
            </thead>
            <tbody>
              {settings.runs.map((r) => (
                <tr key={r.runId} className="border-t border-line align-top">
                  <td className="ltr-nums py-2 pe-3">{r.finishedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="pe-3">{r.trigger === 'daily' ? t('settings.expenses.triggerDaily') : t('settings.expenses.triggerManual')}</td>
                  <td className="py-2">
                    <ImportCounts summary={r} />
                    {r.errorList.map((e, i) => (
                      <p key={i} className="text-xs text-danger">
                        <span dir="auto">{e.ref}</span>: {e.message}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
