import { useEffect, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, fetchSeries, setSeriesStartNumber, type SeriesRow } from './api';

export function NumberingTab() {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const toast = useToast();
  const t = useT();
  const { locale } = usePreferences();
  const seriesName = (row: SeriesRow) => (locale === 'he' ? (row.name_he ?? row.name_en) : row.name_en);
  const legalMode = (mode: string | null) =>
    mode === 'patur'
      ? t('settings.numbering.legalModePatur')
      : mode === 'murshe'
        ? t('settings.numbering.legalModeMurshe')
        : t('settings.numbering.legalModeBoth');

  const load = () =>
    fetchSeries()
      .then((body) => setSeries(body.series))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.numbering.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!series) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const save = async (row: SeriesRow) => {
    const value = Number(drafts[row.id] ?? row.start_number);
    if (!Number.isInteger(value) || value < 1) {
      toast.push(t('settings.numbering.invalidStartNumber'), 'danger');
      return;
    }
    try {
      const body = await setSeriesStartNumber(row.id, value);
      setSeries(body.series);
      toast.push(t('settings.numbering.setSuccess', { name: seriesName(row), value }));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.numbering.setErrorFallback'), 'danger');
    }
  };

  return (
    <table className="w-full text-start text-sm">
      <caption className="sr-only">{t('settings.numbering.caption')}</caption>
      <thead>
        <tr className="text-xs uppercase tracking-wide text-muted">
          <th className="py-2 text-start">{t('settings.numbering.colType')}</th>
          <th className="text-start">{t('settings.numbering.colLegalMode')}</th>
          <th className="text-start">{t('settings.numbering.colStartingNumber')}</th>
          <th className="text-start">{t('settings.numbering.colNextNumber')}</th>
          <th className="text-start">{t('settings.numbering.colStatus')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {series.map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className="py-2">{seriesName(row)}</td>
            <td>{legalMode(row.legal_mode)}</td>
            <td>
              {row.started_at ? (
                <bdi className="ltr-nums">{row.start_number}</bdi>
              ) : (
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  className="w-24 rounded-md border border-line bg-canvas px-2 py-1"
                  value={drafts[row.id] ?? row.start_number}
                  onChange={(e) => setDrafts({ ...drafts, [row.id]: e.target.value })}
                />
              )}
            </td>
            <td>
              <bdi className="ltr-nums">{row.next_number}</bdi>
            </td>
            <td>
              {row.closed_at
                ? t('settings.numbering.statusClosed')
                : row.started_at
                  ? t('settings.numbering.statusInUse')
                  : t('settings.numbering.statusNotStarted')}
            </td>
            <td>
              {!row.started_at && (
                <button type="button" onClick={() => save(row)} className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface">
                  {t('settings.numbering.setButton')}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
