import { useEffect, useState } from 'react';
import { useDemo } from '../../app/demo';
import { GuideTip } from '../../components/GuideTip';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import {
  type DriveCheck,
  type DriveSettings,
  checkDriveFolder,
  fetchDriveSettings,
  sampleIndexSheetCsv,
  saveDailySync,
  saveDriveRootFolder,
  saveIndexTitlePattern,
} from '../expenses/api';
import { ImportCounts } from '../expenses/ImportSummaryView';
import { ApiError } from './api';
import { FinancyCard } from './FinancyCard';
import { InboxSection } from './InboxSection';

/** R20: the Drive root folder, the daily sync switch, and the log of every import run. Owner only. */
export function ExpensesTab() {
  const [settings, setSettings] = useState<DriveSettings | null>(null);
  const [folderId, setFolderId] = useState('');
  const [titlePattern, setTitlePattern] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<DriveCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const t = useT();
  // R35: the email inbox is never shown in the demo.
  const demo = useDemo();

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

  const runCheck = async (id?: string) => {
    setChecking(true);
    try {
      setCheck(await checkDriveFolder(id));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.expenses.saveErrorFallback'), 'danger');
    } finally {
      setChecking(false);
    }
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([sampleIndexSheetCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'expense-index-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveFolder = async () => {
    setSaving(true);
    try {
      await saveDriveRootFolder(folderId.trim());
      toast.push(t('settings.expenses.folderSaved'), 'success');
      void runCheck(folderId.trim());
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
      {!demo && <InboxSection />}
      {settings.reader && (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-lg text-ink">{t('settings.expenses.readerTitle')}</h2>
          <p className="text-sm text-ink" data-testid="reader-status">
            {settings.reader.provider === null
              ? t('settings.expenses.readerNone')
              : t(settings.reader.keySet ? 'settings.expenses.readerOn' : 'settings.expenses.readerNoKey', {
                  provider: settings.reader.provider === 'gemini' ? 'Gemini' : 'Anthropic',
                })}
          </p>
          <p className="text-xs text-muted">{t('settings.expenses.readerHint')}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">
          {t('settings.expenses.folderTitle')}
          <GuideTip id="driveFolder" />
        </h2>
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
          <button
            type="button"
            disabled={checking || !folderId.trim()}
            onClick={() => runCheck(folderId.trim())}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60"
          >
            {checking ? t('settings.expenses.checking') : t('settings.expenses.checkFolder')}
          </button>
        </div>
        {check && <DriveCheckResult check={check} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">
          {t('settings.expenses.titleTitle')}
          <GuideTip id="indexSheet" />
        </h2>
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
        <p className="text-xs text-muted">{t('settings.expenses.sheetColumns')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadSample}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            {t('settings.expenses.sampleSheet')}
          </button>
          <span className="text-xs text-muted">{t('settings.expenses.sampleHint')}</span>
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

      <FinancyCard />
    </div>
  );
}

/** What the Check folder button found: the folder and its month folders, or the one thing to fix. */
function DriveCheckResult({ check }: { check: DriveCheck }) {
  const t = useT();
  if (!check.ok) {
    let text: string;
    switch (check.problem) {
      case 'no_folder':
        text = t('settings.expenses.checkNoFolder');
        break;
      case 'no_key':
        text = t('settings.expenses.checkNoKey');
        break;
      case 'bad_key':
        text = t('settings.expenses.checkBadKey', { message: check.message ?? '' });
        break;
      case 'not_found':
        text = check.mode === 'api_key' ? t('settings.expenses.checkNotFoundByLink') : t('settings.expenses.checkNotFound', { account: check.account ?? '' });
        break;
      case 'not_folder':
        text = t('settings.expenses.checkNotFolder', { name: check.folderName ?? '' });
        break;
      default:
        text = t('settings.expenses.checkGoogleError', { message: check.message ?? '' });
    }
    return (
      <p role="alert" data-testid="drive-check" className="rounded-md border border-danger px-3 py-2 text-sm text-danger" dir="auto">
        {text}
      </p>
    );
  }
  return (
    <div data-testid="drive-check" className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 text-sm text-ink">
      <p className="font-semibold" dir="auto">
        {t('settings.expenses.checkOk', { name: check.folderName ?? '' })}
      </p>
      {check.mode === 'api_key' && <p className="text-xs text-muted">{t('settings.expenses.checkByLink')}</p>}
      <p dir="auto">
        {check.monthFolders.length > 0
          ? t('settings.expenses.checkMonths', { list: check.monthFolders.slice(0, 12).join(', ') })
          : t('settings.expenses.checkNoMonths')}
      </p>
      {check.sheets.length > 0 && <p dir="auto">{t('settings.expenses.checkSheets', { list: check.sheets.slice(0, 12).join(', ') })}</p>}
      {check.looseFiles > 0 && <p className="text-xs text-muted">{t('settings.expenses.checkLoose', { count: String(check.looseFiles) })}</p>}
    </div>
  );
}
