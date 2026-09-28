import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { type CommitSummary, type UnifiedFilePreview, commitSumitUnified, previewSumitUnified } from './api';

export function SumitImportSection() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UnifiedFilePreview | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const t = useT();

  async function onPick(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    setFile(picked);
    setSummary(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await previewSumitUnified(picked));
    } catch {
      setError(t('import.sumit.readError'));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await commitSumitUnified(file);
      setSummary(result);
      toast.push(t('import.sumit.importedToast', { created: result.created, skipped: result.skipped }), 'success');
    } catch {
      setError(t('import.sumit.importFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="font-heading text-xl text-ink">{t('import.sumit.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('import.sumit.hint')}</p>

      <label className="mt-4 inline-block cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
        {file ? file.name : t('import.sumit.chooseFile')}
        <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {preview && (
        <>
          <p className="mt-4 text-sm text-muted">{t('import.sumit.recordsFound', { count: preview.totalLines })}</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {Object.entries(preview.recordTypeCounts).map(([type, count]) => (
              <li key={type} className="rounded-full bg-band px-3 py-1 text-ink">
                {t('import.sumit.recordCount', { type, count })}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={onCommit}
            className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t('import.sumit.importing') : t('import.sumit.importButton')}
          </button>
        </>
      )}

      {summary && (
        <p className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm text-ink">
          {t('import.sumit.summaryLine', { created: summary.created, skipped: summary.skipped })}
        </p>
      )}
    </div>
  );
}
