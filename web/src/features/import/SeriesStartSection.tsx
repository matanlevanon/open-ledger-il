import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { type SeriesInfo, confirmSeriesStart, listSeries } from './api';

export function SeriesStartSection() {
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const t = useT();

  async function load() {
    setSeries(await listSeries());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onConfirm(id: string) {
    const value = Number(drafts[id]);
    if (!Number.isInteger(value) || value < 1) {
      toast.push(t('import.series.invalidNumber'), 'danger');
      return;
    }
    if (!window.confirm(t('import.series.confirmDialog', { id, value }))) return;
    setBusyId(id);
    try {
      await confirmSeriesStart(id, value, t('import.series.setReason', { date: new Date().toISOString().slice(0, 10) }));
      toast.push(t('import.series.setSuccess', { id, value }), 'success');
      await load();
    } catch {
      toast.push(t('import.series.setError', { id }), 'danger');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="font-heading text-xl text-ink">{t('import.series.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('import.series.hint')}</p>
      <div className="mt-4 overflow-x-auto rounded-md border border-line">
        <table className="w-full text-start text-sm">
          <thead className="bg-band text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">{t('import.series.colType')}</th>
              <th className="px-3 py-2">{t('import.series.colNextNumberNow')}</th>
              <th className="px-3 py-2">{t('import.series.colStatus')}</th>
              <th className="px-3 py-2">{t('import.series.colSetNextNumberTo')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{s.name_en}</td>
                <td className="px-3 py-2 text-ink ltr-nums">{s.next_number}</td>
                <td className="px-3 py-2 text-muted">
                  {s.started_at ? t('import.series.statusLocked') : t('import.series.statusNotStarted')}
                </td>
                <td className="px-3 py-2 ltr-nums">
                  <input
                    type="number"
                    min={1}
                    dir="ltr"
                    disabled={Boolean(s.started_at)}
                    value={drafts[s.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                    className="w-28 rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink disabled:opacity-50"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={Boolean(s.started_at) || busyId === s.id || !drafts[s.id]}
                    onClick={() => onConfirm(s.id)}
                    className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50"
                  >
                    {t('import.series.confirm')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
