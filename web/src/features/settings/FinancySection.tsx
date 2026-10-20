import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { GuideTip } from '../../components/GuideTip';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { btnDanger, btnPrimary, btnSecondary, input, label } from '../documents/ui';
import { type AvailableAccount, type FinancyConnection, type SyncCounts, financyApi, shortTime } from '../financy/api';
import { FinancyCard } from './FinancyCard';

/**
 * R40: Settings > Expenses. The Financy partner card and, right under it, the Financy connection
 * panel. Owner only. The demo shows the card alone. The secret is typed once and never comes back:
 * the panel shows its last 4 characters.
 */
export function FinancySection({ demo }: { demo: boolean }) {
  const [connection, setConnection] = useState<FinancyConnection | null>(null);
  const [hidden, setHidden] = useState(demo);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (demo) return;
    financyApi
      .get()
      .then((body) => setConnection(body.connection))
      .catch(() => setHidden(true));
  }, [demo]);

  const scrollToPanel = () => {
    panel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
  };

  return (
    <>
      <FinancyCard connected={connection?.connected ?? false} onConnect={hidden ? undefined : scrollToPanel} />
      {!hidden && connection && (
        <section ref={panel} data-testid="financy-panel" className="flex flex-col gap-3 rounded-md border border-line px-4 py-3">
          <FinancyPanel connection={connection} onChange={setConnection} />
        </section>
      )}
    </>
  );
}

type Confirm = 'disconnect' | 'delete' | null;

function FinancyPanel({ connection, onChange }: { connection: FinancyConnection; onChange: (c: FinancyConnection) => void }) {
  const t = useT();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ clientId: '', clientSecret: '', userId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // R40 task 3b: the account picker, open right after Connect and from Choose accounts.
  const [picker, setPicker] = useState<AvailableAccount[] | null>(null);

  const showForm = editing || connection.status === null;
  const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : t('settings.financy.failed'));

  const connect = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await financyApi.connect({ clientId: details.clientId.trim(), clientSecret: details.clientSecret.trim(), userId: details.userId.trim() });
      onChange(res.connection);
      setDetails({ clientId: '', clientSecret: '', userId: '' });
      setEditing(false);
      setPicker(res.accounts);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setBusy(true);
    setError(null);
    try {
      setPicker((await financyApi.availableAccounts()).accounts);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const picked = (next: FinancyConnection, sync: SyncCounts | null) => {
    onChange(next);
    setPicker(null);
    if (sync) setResult(t('settings.financy.connectedResult', { accounts: String(sync.accounts), transactions: String(sync.transactions) }));
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await financyApi.sync();
      onChange(res.connection);
      toast.push(t('settings.financy.synced', { transactions: String(res.sync.transactions), new: String(res.sync.new) }), 'success');
    } catch (err) {
      setError(message(err));
      financyApi.get().then((b) => onChange(b.connection)).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmed = async () => {
    const what = confirm;
    setConfirm(null);
    setBusy(true);
    setError(null);
    try {
      if (what === 'disconnect') {
        onChange((await financyApi.disconnect()).connection);
        setResult(null);
        toast.push(t('settings.financy.disconnected'), 'success');
      } else if (what === 'delete') {
        const res = await financyApi.deleteData();
        toast.push(t('settings.financy.deleted', { transactions: String(res.deleted.transactions) }), 'success');
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="font-heading text-lg text-ink">
        {t('settings.financy.title')}
        <GuideTip id="financy" />
      </h2>

      {connection.status === 'error' && !editing && (
        <p role="alert" data-testid="financy-error" className="rounded-md border border-danger px-3 py-2 text-sm text-danger" dir="auto">
          {connection.lastError ?? t('settings.financy.failed')}
        </p>
      )}

      {picker ? (
        <AccountPicker accounts={picker} onSaved={picked} onCancel={() => setPicker(null)} />
      ) : showForm ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p className="text-sm text-muted">{t('settings.financy.whereToFind')}</p>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('settings.financy.clientId')}</span>
            <input className={input} dir="ltr" autoComplete="off" value={details.clientId} onChange={(e) => setDetails({ ...details, clientId: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('settings.financy.clientSecret')}</span>
            <input
              className={input}
              dir="ltr"
              type="password"
              autoComplete="new-password"
              value={details.clientSecret}
              onChange={(e) => setDetails({ ...details, clientSecret: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('settings.financy.userId')}</span>
            <input className={input} dir="ltr" autoComplete="off" value={details.userId} onChange={(e) => setDetails({ ...details, userId: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || !details.clientId.trim() || !details.clientSecret.trim() || !details.userId.trim()}>
              {busy ? t('settings.financy.connecting') : t('settings.financy.connect')}
            </button>
            {editing && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(false)}>
                {t('settings.financy.cancel')}
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {connection.needsAccounts && (
            <p role="status" data-testid="financy-needs-accounts" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
              {t('settings.financy.needsAccounts')}
            </p>
          )}
          {connection.status === 'connected' && (
            <dl data-testid="financy-details" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">{t('settings.financy.clientId')}</dt>
              <dd className="ltr-nums text-ink" dir="ltr">
                {connection.clientId}
              </dd>
              <dt className="text-muted">{t('settings.financy.clientSecret')}</dt>
              <dd className="text-ink">{t('settings.financy.secretSaved', { last4: connection.secretLast4 ?? '' })}</dd>
              <dt className="text-muted">{t('settings.financy.userId')}</dt>
              <dd className="ltr-nums text-ink" dir="ltr">
                {connection.userId}
              </dd>
              <dt className="text-muted">{t('settings.financy.lastSync')}</dt>
              <dd className="ltr-nums text-ink">
                {connection.lastSyncAt
                  ? `${shortTime(connection.lastSyncAt)}${
                      connection.lastSyncResult
                        ? `, ${t('settings.financy.counts', { accounts: String(connection.lastSyncResult.accounts), transactions: String(connection.lastSyncResult.transactions) })}`
                        : ''
                    }`
                  : t('settings.financy.never')}
              </dd>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {connection.status === 'connected' && !connection.needsAccounts && (
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void sync()}>
                {busy ? t('settings.financy.syncing') : t('settings.financy.syncNow')}
              </button>
            )}
            {connection.status === 'connected' && (
              <button type="button" className={connection.needsAccounts ? btnPrimary : btnSecondary} disabled={busy} onClick={() => void openPicker()}>
                {t('settings.financy.chooseAccounts')}
              </button>
            )}
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(true)}>
              {t('settings.financy.replace')}
            </button>
            {connection.status === 'connected' && (
              <>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirm('disconnect')}>
                  {t('settings.financy.disconnect')}
                </button>
                <button type="button" className={btnDanger} disabled={busy} onClick={() => setConfirm('delete')}>
                  {t('settings.financy.deleteData')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {result && (
        <p role="status" data-testid="financy-result" className="text-sm text-success">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="financy-form-error" className="text-sm text-danger" dir="auto">
          {error}
        </p>
      )}

      <Dialog
        open={confirm !== null}
        title={confirm === 'delete' ? t('settings.financy.deleteData') : t('settings.financy.disconnect')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setConfirm(null)}>
              {t('settings.financy.cancel')}
            </button>
            <button type="button" className={confirm === 'delete' ? btnDanger : btnPrimary} onClick={() => void confirmed()}>
              {confirm === 'delete' ? t('settings.financy.deleteConfirmButton') : t('settings.financy.disconnectConfirmButton')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{confirm === 'delete' ? t('settings.financy.deleteConfirm') : t('settings.financy.disconnectConfirm')}</p>
      </Dialog>
    </>
  );
}

/**
 * R40 task 3b: tick the accounts the business uses. Nothing is ticked at first. Unticking an
 * account whose transactions are stored asks once more, then deletes them.
 */
function AccountPicker({
  accounts,
  onSaved,
  onCancel,
}: {
  accounts: AvailableAccount[];
  onSaved: (connection: FinancyConnection, sync: SyncCounts | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(accounts.filter((a) => a.picked).map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unpick, setUnpick] = useState<string | null>(null);

  const toggle = (id: string) =>
    setTicked((all) => {
      const next = new Set(all);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await financyApi.pickAccounts([...ticked], confirm);
      setUnpick(null);
      onSaved(res.connection, res.sync);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'financy_unpick') setUnpick(err.message);
      else setError(err instanceof Error ? err.message : t('settings.financy.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="financy-picker" className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink">{t('settings.financy.pickTitle')}</p>
      <p className="text-sm text-muted">{t('settings.financy.pickHint')}</p>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">{t('settings.financy.pickEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.id}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={ticked.has(a.id)} onChange={() => toggle(a.id)} />
                <span>
                  <span dir="auto">{a.name ?? (a.type === 'CARD' ? t('settings.financy.card') : t('settings.financy.bankAccount'))}</span>
                  {a.last4 && <span className="ltr-nums"> ··{a.last4}</span>}
                  <span className="block text-xs text-muted">
                    {[a.type === 'CARD' ? t('settings.financy.card') : t('settings.financy.bankAccount'), a.provider, a.currencies.join(', ') || null, a.dueDay && !/-/.test(a.dueDay) ? t('settings.financy.dueDay', { day: a.dueDay }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {a.blocked && <span className="ms-0 mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-xs text-muted">{t('settings.financy.blocked')}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save(false)}>
          {busy ? t('settings.financy.syncing') : t('settings.financy.pickSave')}
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={onCancel}>
          {t('settings.financy.cancel')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger" dir="auto">
          {error}
        </p>
      )}
      <Dialog
        open={unpick !== null}
        title={t('settings.financy.unpickTitle')}
        onClose={() => setUnpick(null)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setUnpick(null)}>
              {t('settings.financy.cancel')}
            </button>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void save(true)}>
              {t('settings.financy.unpickConfirm')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{unpick}</p>
      </Dialog>
    </div>
  );
}
