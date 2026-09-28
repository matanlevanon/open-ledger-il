import { useRef, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import type { CommitSummary, CsvPreview } from './api';

export interface CsvField {
  key: string;
  label: string;
  required?: boolean;
}

interface CsvImportSectionProps {
  title: string;
  hint: string;
  fields: CsvField[];
  preview: (file: File) => Promise<CsvPreview>;
  commit: (file: File, mapping: Record<string, string | null>) => Promise<CommitSummary>;
}

const NONE = '';

export function CsvImportSection({ title, hint, fields, preview, commit }: CsvImportSectionProps) {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const t = useT();

  /** Drops the picked file and its preview, so an unreadable file can be fixed and picked again. */
  function onCancel() {
    setFile(null);
    setData(null);
    setMapping({});
    setSummary(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function onPick(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    // Clear the input so picking the same file name again (after editing it) still fires onChange.
    if (fileInput.current) fileInput.current.value = '';
    setFile(picked);
    setSummary(null);
    setError(null);
    setBusy(true);
    try {
      const preview1 = await preview(picked);
      setData(preview1);
      const initial: Record<string, string> = {};
      for (const f of fields) initial[f.key] = preview1.suggestedMapping[f.key] ?? NONE;
      setMapping(initial);
    } catch {
      setError(t('import.csv.readError'));
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const mappingForApi: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(mapping)) mappingForApi[k] = v || null;
      const result = await commit(file, mappingForApi);
      setSummary(result);
      toast.push(
        t('import.csv.importedToast', { created: result.created, updated: result.updated, skipped: result.skipped }),
        'success',
      );
    } catch {
      setError(t('import.csv.importFailed'));
    } finally {
      setBusy(false);
    }
  }

  const missingRequired = fields.some((f) => f.required && !mapping[f.key]);

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="font-heading text-xl text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{hint}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="inline-block cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
          {file ? file.name : t('import.csv.chooseFile')}
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onPick(e.target.files)} />
        </label>
        {file && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full border border-line px-4 py-2 text-sm hover:bg-canvas disabled:opacity-50"
          >
            {t('import.csv.cancelButton')}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {data && (
        <>
          <p className="mt-4 text-sm text-muted">{t('import.csv.rowsFound', { count: data.totalRows })}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink" htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.required && (
                    <span aria-hidden className="ms-0.5 text-danger">
                      *
                    </span>
                  )}
                </label>
                <select
                  id={`map-${f.key}`}
                  className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-ink"
                  value={mapping[f.key] ?? NONE}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                >
                  <option value={NONE}>{t('import.csv.noColumn')}</option>
                  {data.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {data.sampleRows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-md border border-line">
              <table className="w-full text-start text-xs">
                <thead className="bg-band text-muted">
                  <tr>
                    {data.headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-1.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {data.headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-3 py-1.5 text-ink">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            disabled={busy || missingRequired}
            onClick={onCommit}
            className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t('import.csv.importing') : t('import.csv.importButton')}
          </button>
        </>
      )}

      {summary && (
        <div className="mt-4 rounded-md border border-line bg-canvas p-3 text-sm">
          <p className="text-ink">
            {t('import.csv.summaryLine', { total: summary.totalRows, created: summary.created, updated: summary.updated, skipped: summary.skipped })}
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-xs text-muted">
              {summary.errors.slice(0, 20).map((e, i) => (
                <li key={i}>{t('import.csv.rowError', { row: e.row, message: e.message })}</li>
              ))}
              {summary.errors.length > 20 && <li>{t('import.csv.andMore', { count: summary.errors.length - 20 })}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
