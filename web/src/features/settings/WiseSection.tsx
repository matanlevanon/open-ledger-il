import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { useT } from '../../i18n';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';
import { shortTime } from '../financy/api';
import { type WiseConnection, type WiseProfileChoice, wiseApi } from '../wise/api';

/**
 * R49: Settings > Expenses > Wise connection. Owner only, hidden in the demo. The token is typed
 * once and never comes back: the panel shows its last 4 characters. The webhook address is shown
 * with the steps to add it in Wise when the Ledger could not create it through the API.
 */
export function WiseSection({ demo }: { demo: boolean }) {
  const [connection, setConnection] = useState<WiseConnection | null>(null);

  useEffect(() => {
    if (demo) return;
    wiseApi
      .get()
      .then((body) => setConnection(body.connection))
      .catch(() => setConnection(null));
  }, [demo]);

  if (demo || !connection) return null;
  return (
    <section data-testid="wise-panel" className="flex flex-col gap-3 rounded-md border border-line px-4 py-3">
      <WisePanel connection={connection} onChange={setConnection} />
    </section>
  );
}

function WisePanel({ connection, onChange }: { connection: WiseConnection; onChange: (c: WiseConnection) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [profiles, setProfiles] = useState<WiseProfileChoice[] | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const showForm = editing || connection.status === null;
  const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : t('settings.wise.failed'));
  const counts = (c: { accounts: number; transactions: number }) => t('settings.wise.counts', { accounts: String(c.accounts), transactions: String(c.transactions) });

  const connect = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await wiseApi.connect(token.trim(), profileId ?? undefined);
      onChange(res.connection);
      setToken('');
      setProfiles(null);
      setProfileId(null);
      setEditing(false);
      if (res.syncError) setError(res.syncError);
      else if (res.sync) setResult(t('settings.wise.synced', { counts: counts(res.sync) }));
    } catch (err) {
      // A token that reaches several Wise Business profiles: the answer lists them to pick from.
      const list = err instanceof ApiError && err.code === 'wise_pick_profile' ? (err.details as { profiles?: WiseProfileChoice[] } | undefined)?.profiles : undefined;
      if (list && list.length > 0) {
        setProfiles(list);
        setProfileId(list[0]!.id);
      } else setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await wiseApi.sync();
      onChange(res.connection);
      setResult(t('settings.wise.synced', { counts: counts(res.sync) }));
    } catch (err) {
      setError(message(err));
      wiseApi
        .get()
        .then((body) => onChange(body.connection))
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      onChange((await wiseApi.disconnect()).connection);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connection.webhook.url ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink">{t('settings.wise.title')}</h3>
        {connection.status === 'connected' && (
          <span data-testid="wise-connected" className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            {t('settings.wise.connectedChip')}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{t('settings.wise.intro')}</p>

      {connection.status === 'error' && connection.lastError && !error && (
        <p role="alert" data-testid="wise-error" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-ink" dir="auto">
          {connection.lastError}
        </p>
      )}

      {showForm ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p className="text-sm text-muted">{t('settings.wise.whereToFind')}</p>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('settings.wise.token')}</span>
            <input className={input} dir="ltr" type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          {profiles && (
            <label className="flex flex-col gap-1">
              <span className={label}>{t('settings.wise.pickProfile')}</span>
              <select className={input} data-testid="wise-profiles" value={profileId ?? ''} onChange={(e) => setProfileId(Number(e.target.value))}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? String(p.id)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || token.trim().length < 8}>
              {busy ? t('settings.wise.connecting') : t('settings.wise.connect')}
            </button>
            {editing && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(false)}>
                {t('settings.wise.cancel')}
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <dl data-testid="wise-details" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t('settings.wise.business')}</dt>
            <dd className="text-ink" dir="auto">
              {connection.profileName ?? ''}
            </dd>
            <dt className="text-muted">{t('settings.wise.token')}</dt>
            <dd className="text-ink">{t('settings.wise.tokenSaved', { last4: connection.tokenLast4 ?? '' })}</dd>
            <dt className="text-muted">{t('settings.wise.lastSync')}</dt>
            <dd className="ltr-nums text-ink">
              {connection.lastSyncAt ? `${shortTime(connection.lastSyncAt)}${connection.lastSyncResult ? `, ${counts(connection.lastSyncResult)}` : ''}` : t('settings.wise.never')}
            </dd>
            <dt className="text-muted">{t('settings.wise.webhook')}</dt>
            <dd className="text-ink" data-testid="wise-webhook-state">
              {connection.webhook.state === 'auto' ? t('settings.wise.webhookAuto') : connection.webhook.lastEventAt ? t('settings.wise.webhookManualOn') : t('settings.wise.webhookManual')}
              {connection.webhook.lastEventAt ? ` ${t('settings.wise.lastEvent', { time: shortTime(connection.webhook.lastEventAt) })}` : ''}
            </dd>
          </dl>

          {connection.webhook.state === 'manual' && connection.webhook.url && (
            <div data-testid="wise-webhook-steps" className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <p className="text-ink">{t('settings.wise.webhookSteps')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="ltr-nums break-all text-ink" dir="ltr" data-testid="wise-webhook-url">
                  {connection.webhook.url}
                </code>
                <button type="button" className={btnSecondary} onClick={() => void copy()}>
                  {copied ? t('settings.wise.copied') : t('settings.wise.copy')}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void sync()}>
              {busy ? t('settings.wise.syncing') : t('settings.wise.syncNow')}
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(true)}>
              {t('settings.wise.replace')}
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirm(true)}>
              {t('settings.wise.disconnect')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p role="status" data-testid="wise-result" className="text-sm text-success">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="wise-form-error" className="text-sm text-danger" dir="auto">
          {error}
        </p>
      )}

      <Dialog
        open={confirm}
        title={t('settings.wise.disconnect')}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setConfirm(false)}>
              {t('settings.wise.cancel')}
            </button>
            <button type="button" className={btnPrimary} onClick={() => void disconnect()}>
              {t('settings.wise.disconnect')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{t('settings.wise.disconnectBody')}</p>
      </Dialog>
    </>
  );
}
