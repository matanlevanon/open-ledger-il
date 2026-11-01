import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { Card, ErrorNote, btnPrimary, btnSecondary } from '../documents/ui';

/**
 * R47: send the unified file to the Tax Authority (תוספת 1, 3.2026, required from 1.1.2027), and
 * check what the Tax Authority did with it. Owner only on the server. The sandbox takes only a
 * small PDF, so a sandbox send uploads a test PDF in place of the two files.
 */

export interface Transmission {
  id: number;
  environment: 'sandbox' | 'production';
  period_from: string;
  period_to: string;
  ini_status: string | null;
  bkm_status: string | null;
  status_description: string | null;
  error: string | null;
  test_upload: number;
  created_at: string;
  checked_at: string | null;
  ini_file_id: string | null;
}

async function call(url: string, method = 'GET'): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = body?.error;
    const message = typeof body?.message === 'string' ? body.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : null;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  return body ?? {};
}

const STATUS_KEYS: Record<string, 'unified.send.status.uploaded' | 'unified.send.status.approved' | 'unified.send.status.rejected' | 'unified.send.status.failed'> = {
  Uploaded: 'unified.send.status.uploaded',
  Approved: 'unified.send.status.approved',
  Rejected: 'unified.send.status.rejected',
  Failed: 'unified.send.status.failed',
};

export function TransmitCard({ from, to, drive }: { from: string; to: string; drive: string }) {
  const t = useT();
  const [rows, setRows] = useState<Transmission[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await call('/api/exports/unified-file/transmissions');
      setRows((body.transmissions as Transmission[]) ?? []);
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(url: string) {
    setBusy(true);
    setError(null);
    try {
      await call(url, 'POST');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unified.send.error'));
    } finally {
      await load();
      setBusy(false);
    }
  }

  const status = (s: string | null) => (s ? (STATUS_KEYS[s] ? t(STATUS_KEYS[s]!) : s) : '-');

  return (
    <Card title={t('unified.send.title')}>
      <p className="text-sm text-muted">{t('unified.send.help')}</p>
      <ErrorNote error={error} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !from || !to || from > to}
          onClick={() => void act(`/api/exports/unified-file/transmit?${new URLSearchParams({ from, to, drive })}`)}
        >
          {t('unified.send.button')}
        </button>
      </div>
      {rows && rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead className="bg-band text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-1 text-start">{t('unified.send.col.sent')}</th>
              <th className="px-2 py-1 text-start">{t('unified.send.col.period')}</th>
              <th className="px-2 py-1 text-start">INI</th>
              <th className="px-2 py-1 text-start">BKMVDATA</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-2 py-1">
                  <span className="ltr-nums">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
                  {r.environment === 'sandbox' && <span className="block text-xs text-muted">{t('unified.send.sandbox')}</span>}
                </td>
                <td className="ltr-nums px-2 py-1">
                  {r.period_from} – {r.period_to}
                </td>
                <td className="px-2 py-1">{status(r.ini_status)}</td>
                <td className="px-2 py-1">
                  {status(r.bkm_status)}
                  {(r.status_description || r.error) && <span className="block text-xs text-danger">{r.status_description ?? r.error}</span>}
                </td>
                <td className="px-2 py-1 text-end">
                  {r.ini_file_id && (
                    <button type="button" className={btnSecondary} disabled={busy} onClick={() => void act(`/api/exports/unified-file/transmissions/${r.id}/check`)}>
                      {t('unified.send.check')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
