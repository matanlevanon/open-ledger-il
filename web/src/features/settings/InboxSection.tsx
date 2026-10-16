import { useEffect, useState } from 'react';
import { ApiError, apiGet } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';

/**
 * R35: Settings > Expenses > Email inbox. The address, the switch, who may forward, the Gmail
 * confirmation code, the setup steps, the last 10 emails, and a new address. Owner only. The
 * Settings page hides it in the demo.
 */
export type InboxOutcome = 'expense' | 'duplicate' | 'ignored' | 'confirmation' | 'empty' | 'off';

export interface InboxState {
  configured: boolean;
  address: string | null;
  enabled: boolean;
  senders: string[];
  gmail: { code: string | null; link: string | null; at: string } | null;
  events: { id: number; at: string; sender: string; subject: string | null; outcome: InboxOutcome; expense_id: number | null }[];
  canRotate: boolean;
}

export const inboxApi = {
  get: () => apiGet<InboxState>('/expenses/settings/inbox'),
  setSenders: (senders: string[]) => apiSend<{ senders: string[] }>('PUT', '/expenses/settings/inbox/senders', { senders }),
  setEnabled: (enabled: boolean) => apiSend<{ enabled: boolean }>('PUT', '/expenses/settings/inbox/enabled', { enabled }),
  rotate: () => apiSend<InboxState>('POST', '/expenses/settings/inbox/rotate'),
};

export const GMAIL_SEARCH = 'has:attachment (invoice OR receipt OR חשבונית OR קבלה)';

const OUTCOME_KEYS: Record<InboxOutcome, MessageKey> = {
  expense: 'settings.inbox.outcome.expense',
  duplicate: 'settings.inbox.outcome.duplicate',
  ignored: 'settings.inbox.outcome.ignored',
  confirmation: 'settings.inbox.outcome.confirmation',
  empty: 'settings.inbox.outcome.empty',
  off: 'settings.inbox.outcome.off',
};

const day = (iso: string) => iso.slice(0, 10);

export function InboxSection() {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<InboxState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [newSender, setNewSender] = useState('');
  const [search, setSearch] = useState(GMAIL_SEARCH);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    inboxApi
      .get()
      .then(setState)
      .catch((err) => {
        // 403: not the owner, or the demo. The section stays out of the way.
        if (err instanceof ApiError && err.status === 403) setHidden(true);
        else toast.push(err instanceof Error ? err.message : t('settings.inbox.loadError'), 'danger');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden || !state) return null;

  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    toast.push(t('settings.inbox.copied'));
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.inbox.saveError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const saveSenders = (senders: string[]) =>
    act(async () => {
      const saved = await inboxApi.setSenders(senders);
      setState({ ...state, senders: saved.senders });
    });

  const addSender = () => {
    const email = newSender.trim().toLowerCase();
    if (!email || state.senders.includes(email)) return;
    void saveSenders([...state.senders, email]).then(() => setNewSender(''));
  };

  const toggle = (enabled: boolean) =>
    act(async () => {
      const saved = await inboxApi.setEnabled(enabled);
      setState({ ...state, enabled: saved.enabled });
    });

  const rotate = () =>
    act(async () => {
      setState(await inboxApi.rotate());
      setConfirming(false);
    });

  return (
    <section className="flex flex-col gap-4" data-testid="inbox-section">
      <div>
        <h2 className="font-heading text-lg text-ink">{t('settings.inbox.title')}</h2>
        <p className="text-xs text-muted">{t('settings.inbox.hint')}</p>
      </div>

      {!state.configured || !state.address ? (
        <p className="text-sm text-ink" data-testid="inbox-not-set-up">
          {t('settings.inbox.notSetUp')}
        </p>
      ) : (
        <>
          <div>
            <span className={label}>{t('settings.inbox.address')}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code dir="ltr" data-testid="inbox-address" className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
                {state.address}
              </code>
              <button type="button" className={btnSecondary} onClick={() => void copy(state.address!)}>
                {t('settings.inbox.copy')}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" role="switch" checked={state.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            {t('settings.inbox.enabled')}
          </label>

          {state.gmail && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink" data-testid="inbox-gmail">
              {state.gmail.code ? t('settings.inbox.gmailCode', { code: state.gmail.code }) : t('settings.inbox.gmailNoCode')}{' '}
              {state.gmail.link && (
                <a href={state.gmail.link} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                  {t('settings.inbox.gmailLink')}
                </a>
              )}{' '}
              <span className="text-xs text-muted">{day(state.gmail.at)}</span>
            </p>
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        <span className={label}>{t('settings.inbox.senders')}</span>
        <p className="text-xs text-muted">{t('settings.inbox.sendersHint')}</p>
        <ul className="flex flex-col gap-1" data-testid="inbox-senders">
          {state.senders.map((s) => (
            <li key={s} className="flex items-center gap-2 text-sm text-ink">
              <span dir="ltr">{s}</span>
              <button type="button" className="text-xs text-danger underline" disabled={busy} onClick={() => void saveSenders(state.senders.filter((x) => x !== s))}>
                {t('settings.inbox.remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input dir="ltr" className={`${input} max-w-xs`} type="email" aria-label={t('settings.inbox.addSender')} placeholder="you@example.com" value={newSender} onChange={(e) => setNewSender(e.target.value)} />
          <button type="button" className={btnSecondary} disabled={busy || !newSender.trim()} onClick={addSender}>
            {t('settings.inbox.addSender')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>{t('settings.inbox.gmailTitle')}</span>
        <ol className="list-decimal ps-5 text-sm text-ink">
          <li>{t('settings.inbox.gmailStep1')}</li>
          <li>{t('settings.inbox.gmailStep2')}</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <input dir="ltr" className={`${input} max-w-lg font-mono`} aria-label={t('settings.inbox.gmailSearch')} data-testid="inbox-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" className={btnSecondary} onClick={() => void copy(search)}>
            {t('settings.inbox.copy')}
          </button>
        </div>
        <p className="text-xs text-muted">{t('settings.inbox.gmailSearchHint')}</p>
        <span className={label}>{t('settings.inbox.outlookTitle')}</span>
        <p className="text-sm text-ink">{t('settings.inbox.outlook')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>{t('settings.inbox.lastReceived')}</span>
        {state.events.length === 0 ? (
          <p className="text-sm text-muted">{t('settings.inbox.noEvents')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-ink" data-testid="inbox-events">
            {state.events.map((e) => (
              <li key={e.id}>
                {day(e.at)} <span dir="ltr">{e.sender}</span>: {t(OUTCOME_KEYS[e.outcome], { from: e.sender })}
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.canRotate && (
        <div>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirming(true)}>
            {t('settings.inbox.rotate')}
          </button>
        </div>
      )}

      <Dialog
        open={confirming}
        title={t('settings.inbox.rotateTitle')}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>
              {t('settings.inbox.cancel')}
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void rotate()}>
              {t('settings.inbox.rotateConfirm')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{t('settings.inbox.rotateBody')}</p>
      </Dialog>
    </section>
  );
}
