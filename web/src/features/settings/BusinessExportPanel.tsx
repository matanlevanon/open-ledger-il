import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useT } from '../../i18n';

/**
 * R48 task 4: Settings > Businesses > Export. Each file is built by its own request, so a large
 * business never hits a Worker's memory. Progress per file, and Retry on a file that failed.
 */
export interface ExportFile {
  name: string;
  built: boolean;
  size?: number;
  sha256?: string;
  links?: string[];
}

export interface ExportRunView {
  id: string;
  completedAt: string | null;
  files: ExportFile[];
}

async function send(path: string): Promise<{ run: ExportRunView }> {
  const res = await fetch(`/api/business-export${path}`, { method: 'POST', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as { run: ExportRunView };
}

export const exportApi = {
  start: () => send('/runs'),
  build: (runId: string, name: string) => send(`/runs/${runId}/files/${encodeURIComponent(name)}`),
};

export function BusinessExportPanel({ api = exportApi }: { api?: typeof exportApi }) {
  const t = useT();
  const [run, setRun] = useState<ExportRunView | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);

  const buildAll = async (start: ExportRunView, only?: string[]) => {
    let current = start;
    for (const f of start.files) {
      if (f.built || (only && !only.includes(f.name))) continue;
      setWorking(f.name);
      try {
        current = (await api.build(start.id, f.name)).run;
        setRun(current);
        setFailed((x) => {
          const next = { ...x };
          delete next[f.name];
          return next;
        });
      } catch (err) {
        setFailed((x) => ({ ...x, [f.name]: err instanceof Error ? err.message : String(err) }));
      }
    }
    setWorking(null);
  };

  const start = async () => {
    setFailed({});
    try {
      const { run: fresh } = await api.start();
      setRun(fresh);
      await buildAll(fresh);
    } catch (err) {
      setFailed({ '': err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="business-export">
      <h3 className="font-heading text-base text-ink">{t('businesses.export.title')}</h3>
      <p className="text-xs text-muted">{t('businesses.export.hint')}</p>
      <button type="button" disabled={working !== null} onClick={start} className="w-fit rounded-full border border-line px-4 py-2 text-sm disabled:opacity-60">
        {t('businesses.export.start')}
      </button>
      {failed[''] && <p className="text-sm text-danger">{failed['']}</p>}
      {run && (
        <ul className="flex flex-col gap-1 text-sm">
          {run.files.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center gap-2" data-testid="export-file">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.built ? (
                (f.links ?? []).map((link, i) => (
                  <a key={link} href={`/api${link}`} className="text-accent-2 hover:underline">
                    {f.links!.length > 1 ? t('businesses.export.part', { n: String(i + 1) }) : t('businesses.export.download')}
                  </a>
                ))
              ) : working === f.name ? (
                <span className="text-muted">{t('businesses.export.building')}</span>
              ) : failed[f.name] ? (
                <>
                  <span className="text-danger">{failed[f.name]}</span>
                  <button type="button" className="text-accent-2" onClick={() => buildAll(run, [f.name])}>
                    {t('businesses.export.retry')}
                  </button>
                </>
              ) : (
                <span className="text-muted">{t('businesses.export.waiting')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {run?.completedAt && <p className="text-sm text-ink">{t('businesses.export.done')}</p>}
    </section>
  );
}
