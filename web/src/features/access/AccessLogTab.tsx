import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { ApiError, fetchAccessLog, type AccessLogEntry } from './api';

export function AccessLogTab() {
  const [entries, setEntries] = useState<AccessLogEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const load = (before?: number) =>
    fetchAccessLog({ before })
      .then((body) => {
        setEntries((prev) => (before && prev ? [...prev, ...body.entries] : body.entries));
        setNextBefore(body.nextBefore);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('access.log.errorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('access.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!entries) return <p className="text-sm text-muted">{t('access.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{t('access.log.caption')}</caption>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th className="py-2">{t('access.log.colWhen')}</th>
            <th>{t('access.log.colWho')}</th>
            <th>{t('access.log.colAction')}</th>
            <th>{t('access.log.colWhat')}</th>
            <th>{t('access.log.colIp')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line">
              <td className="py-2 ltr-nums">{entry.at}</td>
              <td>{entry.userEmail ?? t('access.log.systemFallback')}</td>
              <td>{entry.action}</td>
              <td>{[entry.entity, entry.entityId].filter(Boolean).join(' ')}</td>
              <td>{entry.ip ?? t('access.log.noneFallback')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {nextBefore !== null && (
        <button
          type="button"
          onClick={() => load(nextBefore)}
          className="w-fit rounded-full border border-line px-4 py-2 text-sm text-ink hover:bg-surface"
        >
          {t('access.log.loadOlder')}
        </button>
      )}
    </div>
  );
}
