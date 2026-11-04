import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { Card, ErrorNote, btnPrimary, btnSecondary } from '../documents/ui';
import { showDate, showDateTime } from '../../lib/dates';

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
    throw Object.assign(new Error(message ?? `HTTP ${res.status}`), { code: typeof err === 'string' ? err : null });
  }
  return body ?? {};
}

const STATUS_KEYS: Record<
  string,
  'unified.send.status.uploaded' | 'unified.send.status.approved' | 'unified.send.status.rejected' | 'unified.send.status.failed' | 'unified.send.status.notRequired'
> = {
  NotRequired: 'unified.send.status.notRequired',
  Uploaded: 'unified.send.status.uploaded',
  Approved: 'unified.send.status.approved',
  Rejected: 'unified.send.status.rejected',
  Failed: 'unified.send.status.failed',
};

/** The Tax Authority's answer for a business it has not asked for the file. Shown in green, not as an error. */
const NOT_REQUIRED = /no requirement/i;

type ErrorKey = 'unified.send.err.reconnect' | 'unified.send.err.unavailable' | 'unified.send.err.manual' | 'unified.send.err.demo';

/** The Ledger's own refusals, by code. The Tax Authority's refusals show in its own words. */
const ERROR_KEYS: Record<string, ErrorKey> = {
  reconnect: 'unified.send.err.reconnect',
  unavailable: 'unified.send.err.unavailable',
  manual: 'unified.send.err.manual',
  demo: 'unified.send.err.demo',
};

export function TransmitCard({ from, to, drive }: { from: string; to: string; drive: string }) {
  const t = useT();
  const [rows, setRows] = useState<Transmission[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The separate Tax Authority login the unified file services take (dailytoken).
  const [login, setLogin] = useState<{ available: boolean; connected?: boolean; until?: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await call('/api/exports/unified-file/transmissions');
      setRows((body.transmissions as Transmission[]) ?? []);
    } catch {
      setRows([]);
    }
    try {
      setLogin((await call('/api/exports/unified-file/connection')) as { available: boolean; connected?: boolean; until?: string | null });
    } catch {
      setLogin(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The sign-in comes back here with ?connected=1 or ?error=<code>. Say what happened, then clean the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code) setError(t('unified.send.login.failed', { code }));
    if (code || params.get('connected')) window.history.replaceState(null, '', window.location.pathname);
  }, [t]);

  async function act(url: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = await call(url, 'POST');
      if (body.notice === 'not_required') setNotice(t('unified.send.notRequired'));
    } catch (e) {
      const code = (e as { code?: string | null })?.code;
      setError(code && ERROR_KEYS[code] ? t(ERROR_KEYS[code]!) : e instanceof Error ? e.message : t('unified.send.error'));
    } finally {
      await load();
      setBusy(false);
    }
  }

  const status = (s: string | null) => (s ? (STATUS_KEYS[s] ? t(STATUS_KEYS[s]!) : s) : '-');

  return (
    <Card title={t('unified.send.title')}>
      <p className="mb-2 text-sm text-ink">
        {t('unified.step.forPeriod', { from: `${from.slice(8, 10)}/${from.slice(5, 7)}/${from.slice(0, 4)}`, to: `${to.slice(8, 10)}/${to.slice(5, 7)}/${to.slice(0, 4)}` })}
      </p>
      <p className="text-sm text-muted">{t('unified.send.help')}</p>
      <ErrorNote error={error} />
      {notice && (
        <p role="status" className="my-3 rounded-md border border-success px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}
      {login?.available && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className={login.connected ? 'text-ink' : 'text-muted'}>
            {login.connected && login.until
              ? t('unified.send.login.until', { until: showDateTime(login.until) })
              : t('unified.send.login.none')}
          </span>
          <a className={btnSecondary} href="/api/ita/connect?purpose=unified_file" data-busy-on-click>
            {login.connected ? t('unified.send.login.again') : t('unified.send.login.button')}
          </a>
        </div>
      )}
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
                  <span className="ltr-nums">{showDateTime(r.created_at)}</span>
                  {r.environment === 'sandbox' && <span className="block text-xs text-muted">{t('unified.send.sandbox')}</span>}
                </td>
                <td className="ltr-nums px-2 py-1">
                  {showDate(r.period_from)} – {showDate(r.period_to)}
                </td>
                <td className="px-2 py-1">{status(NOT_REQUIRED.test(r.error ?? '') ? 'NotRequired' : r.ini_status)}</td>
                <td className="px-2 py-1">
                  {status(NOT_REQUIRED.test(r.error ?? '') ? 'NotRequired' : r.bkm_status)}
                  {/* The Tax Authority's description in grey. Red only for a send that failed. */}
                  {r.status_description && (
                    <span className={`block text-xs ${NOT_REQUIRED.test(r.status_description) ? 'text-success' : 'text-muted'}`}>{r.status_description}</span>
                  )}
                  {r.error && (
                    <span className={`block text-xs ${NOT_REQUIRED.test(r.error) ? 'text-success' : 'text-danger'}`}>
                      {ERROR_KEYS[r.error] ? t(ERROR_KEYS[r.error]!) : r.error}
                    </span>
                  )}
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
