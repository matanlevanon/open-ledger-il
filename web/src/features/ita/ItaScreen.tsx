import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT, type MessageKey } from '../../i18n';
import { CONNECT_URL, type AllocationItem, type ItaApi, type Overview, type RefusalChoice, httpItaApi } from './api';

const CHOICES: { choice: RefusalChoice; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { choice: 'cancel', labelKey: 'ita.choice.cancel.label', hintKey: 'ita.choice.cancel.hint' },
  { choice: 'continue', labelKey: 'ita.choice.continue.label', hintKey: 'ita.choice.continue.hint' },
  { choice: 'reverse_charge', labelKey: 'ita.choice.reverseCharge.label', hintKey: 'ita.choice.reverseCharge.hint' },
  { choice: 'further_objection', labelKey: 'ita.choice.furtherObjection.label', hintKey: 'ita.choice.furtherObjection.hint' },
];

const CALLBACK_ERROR_KEYS: Record<string, MessageKey> = {
  state: 'ita.callbackError.state',
  denied: 'ita.callbackError.denied',
};

type T = ReturnType<typeof useT>;

function money(minor: number): string {
  return `₪${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function docLabel(item: { type: string; number: number | null; id: number }, t: T): string {
  return item.number === null ? t('ita.docLabelDraft', { type: item.type, id: item.id }) : t('ita.docLabelNumbered', { type: item.type, number: item.number });
}

function when(iso: string | null, t: T): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : t('ita.notScheduled');
}

const STATUS_TEXT_KEYS: Record<string, MessageKey> = {
  pending: 'ita.status.pending',
  stalled: 'ita.status.stalled',
  failed: 'ita.status.failed',
};

interface ItaScreenProps {
  api?: ItaApi;
}

export function ItaScreen({ api = httpItaApi }: ItaScreenProps) {
  const t = useT();
  const [params] = useSearchParams();
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(() => {
    if (params.get('connected')) return { tone: 'ok', text: t('ita.connectedNotice') };
    const err = params.get('error');
    const errKey = err ? CALLBACK_ERROR_KEYS[err] : undefined;
    return err ? { tone: 'error', text: errKey ? t(errKey) : t('ita.callbackError.default') } : null;
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkRoute = () => {
    if (!api.routeCheck) return;
    setChecking(true);
    const line = (name: string, p: { from: string | null; status: number; reached: boolean; reply: string } | null) =>
      p ? t(p.reached ? 'ita.route.reached' : 'ita.route.blocked', { name, from: p.from ?? '?', status: p.status, reply: p.reply }) : '';
    api
      .routeCheck()
      .then((r) => {
        const text = [line(t('ita.route.direct'), r.direct), line(t('ita.route.relay'), r.relay)]
          .filter(Boolean)
          .join(' ');
        setNotice({ tone: r.relay?.reached || r.direct.reached ? 'ok' : 'error', text });
      })
      .catch(() => setNotice({ tone: 'error', text: t('ita.route.failed') }))
      .finally(() => setChecking(false));
  };
  const testRenewal = () => {
    if (!api.refresh) return;
    setRenewing(true);
    api
      .refresh()
      .then((r) =>
        setNotice(
          r.ok
            ? { tone: 'ok', text: t('ita.renewal.ok', { from: r.from ?? '?' }) }
            : { tone: 'error', text: t('ita.renewal.failed', { reason: r.reason ?? '', from: r.from ?? '?' }) },
        ),
      )
      .catch(() => setNotice({ tone: 'error', text: t('ita.renewal.failed', { reason: '' }) }))
      .finally(() => {
        setRenewing(false);
        load();
      });
  };

  const load = useCallback(() => {
    api
      .overview()
      .then((o) => {
        setData(o);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [api]);

  useEffect(() => load(), [load]);

  async function act(documentId: number, run: () => Promise<{ message: string }>) {
    setBusy(documentId);
    try {
      const result = await run();
      setNotice({ tone: 'ok', text: result.message });
      load();
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : t('ita.requestFailed') });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <section className="mx-auto max-w-5xl">
        <h1 className="font-heading text-3xl text-ink">{t('ita.title')}</h1>
        <p role="alert" className="mt-4 text-danger">
          {loadError}
        </p>
      </section>
    );
  }
  if (!data) return <p className="text-muted">{t('ita.loadingStatus')}</p>;

  const c = data.connection;
  const manual = data.mode === 'manual';
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl space-y-6">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('ita.title')}
      </h1>

      {notice && (
        <p role="status" className={`rounded-card border px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border-success text-success' : 'border-danger text-danger'}`}>
          {notice.text}
        </p>
      )}

      {!manual && (c.banner || c.status === 'reconnect_required') && (
        <p role="alert" className="rounded-card border border-warning bg-tile-peach px-4 py-3 text-sm text-ink">
          {c.status === 'reconnect_required' ? t('ita.banner.reconnectRequired') : t('ita.banner.reloginSoon', { days: c.days_until_relogin ?? 0 })}
        </p>
      )}

      {manual ? (
        <div className="rounded-card border border-line bg-surface p-5 shadow-card" data-testid="manual-mode">
          <h2 className="text-lg text-ink">{t('ita.manual.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('ita.manual.body')}</p>
          <a className="mt-3 inline-block text-sm text-accent-2 underline" href={data.links.web_app} target="_blank" rel="noreferrer">
            {t('ita.queue.openWebApp')}
          </a>
        </div>
      ) : (
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg text-ink">{t('ita.connection.title')}</h2>
            <p className="text-sm text-muted" data-testid="connection-status">
              {c.status === 'not_connected' && t('ita.connection.notConnected')}
              {c.status === 'active' && t('ita.connection.active', { environment: c.environment, days: c.days_until_relogin ?? 0 })}
              {c.status === 'reconnect_required' && t('ita.connection.reconnectRequired', { environment: c.environment })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {api.routeCheck && (
              <button
                type="button"
                className="rounded-card border border-line bg-canvas px-4 py-2 text-sm text-ink disabled:opacity-50"
                disabled={checking}
                onClick={checkRoute}
              >
                {checking ? t('ita.route.running') : t('ita.route.check')}
              </button>
            )}
            {c.status === 'active' && api.refresh && (
              <button
                type="button"
                className="rounded-card border border-line bg-canvas px-4 py-2 text-sm text-ink disabled:opacity-50"
                disabled={renewing}
                onClick={testRenewal}
                title={t('ita.renewal.hint')}
              >
                {renewing ? t('ita.renewal.running') : t('ita.renewal.test')}
              </button>
            )}
            <a href={CONNECT_URL} className="rounded-card bg-brand px-4 py-2 text-sm text-brand-ink">
              {c.status === 'not_connected' ? t('ita.connection.connectToIta') : t('ita.connection.connectAgain')}
            </a>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">{t('ita.connection.environmentHint', { environment: c.environment })}</p>
      </div>
      )}

      <div className="rounded-card border border-line bg-canvas p-5 shadow-card">
        <h2 className="text-lg text-ink">{t('ita.refused.title')}</h2>
        {data.refused.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('ita.refused.none')}</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {data.refused.map((item) => (
              <RefusedRow key={item.document_id} item={item} hearingUrl={data.links.hearing} busy={busy === item.document_id} onAct={act} api={api} t={t} />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-card border border-line bg-canvas p-5 shadow-card">
        <h2 className="text-lg text-ink">{t('ita.queue.title')}</h2>
        {data.queue.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('ita.queue.none')}</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {data.queue.map((item) => (
              <QueueRow
                key={item.document_id}
                item={item}
                webAppUrl={data.links.web_app}
                manual={manual}
                businessVat={data.business_vat_number ?? null}
                busy={busy === item.document_id}
                onAct={act}
                api={api}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-card border border-line bg-canvas p-5 shadow-card">
        <h2 className="text-lg text-ink">{t('ita.withoutNumbers.title')}</h2>
        {data.without_numbers.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('ita.withoutNumbers.none')}</p>
        ) : (
          <table className="mt-3 w-full text-start text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1">{t('ita.withoutNumbers.colDocument')}</th>
                <th>{t('ita.withoutNumbers.colClient')}</th>
                <th>{t('ita.withoutNumbers.colDate')}</th>
                <th className="text-end">{t('ita.withoutNumbers.colBeforeVat')}</th>
                <th>{t('ita.withoutNumbers.colWhy')}</th>
              </tr>
            </thead>
            <tbody>
              {data.without_numbers.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-1">{docLabel(d, t)}</td>
                  <td>{d.client_name ?? ''}</td>
                  <td className="ltr-nums">{d.date}</td>
                  <td className="ltr-nums text-end">{money(d.subtotal_minor)}</td>
                  <td>{d.decision === 'continue' ? t('ita.withoutNumbers.issuedWithoutNumber') : d.status.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  item: AllocationItem;
  busy: boolean;
  api: ItaApi;
  t: T;
  onAct: (documentId: number, run: () => Promise<{ message: string }>) => Promise<void>;
}

function RefusedRow({ item, busy, api, onAct, hearingUrl, t }: RowProps & { hearingUrl: string }) {
  const d = item.document;
  const objected = item.decision === 'further_objection';
  return (
    <li className="rounded-card border border-line p-4" data-testid={`refused-${item.document_id}`}>
      <p className="text-ink">
        {d ? docLabel(d, t) : t('ita.documentFallback', { id: item.document_id })} {d?.customer_name ? t('ita.forCustomer', { name: d.customer_name }) : ''}{' '}
        {d ? t('ita.beforeVat', { amount: money(d.payment_amount_minor) }) : ''}
      </p>
      {objected ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">{t('ita.refused.hearingRequested')}</span>
          <a className="text-accent-2 underline" href={hearingUrl} target="_blank" rel="noreferrer">
            {t('ita.refused.openPortal')}
          </a>
          <button type="button" disabled={busy} className="rounded-card border border-line px-3 py-1" onClick={() => onAct(item.document_id, () => api.request(item.document_id))}>
            {t('ita.refused.requestAgain')}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t('ita.refused.description')}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {CHOICES.map((ch) => (
              <button
                key={ch.choice}
                type="button"
                disabled={busy}
                title={t(ch.hintKey)}
                className="rounded-card border border-line px-3 py-2 text-start text-sm hover:bg-band"
                onClick={() => onAct(item.document_id, () => api.decide(item.document_id, ch.choice))}
              >
                <span className="block text-ink">{t(ch.labelKey)}</span>
                <span className="block text-xs text-muted">{t(ch.hintKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}

/** The invoice details the ITA web app asks for, in Hebrew, ready to paste. */
function webAppDetails(d: NonNullable<AllocationItem['document']>, businessVat: string | null): string {
  const money = (minor: number | undefined) => (minor === undefined ? '' : (minor / 100).toFixed(2));
  return [
    `מספר עוסק מורשה: ${businessVat ?? ''}`,
    `מספר עוסק של הלקוח: ${d.customer_vat_number ?? ''}`,
    `שם הלקוח: ${d.customer_name ?? ''}`,
    `מספר מסמך: ${d.number ?? ''}`,
    `תאריך: ${d.date}`,
    `סכום לפני מע"מ: ${money(d.payment_amount_minor)}`,
    `מע"מ: ${money(d.vat_amount_minor)}`,
    `סכום כולל מע"מ: ${money(d.total_minor)}`,
  ].join('\n');
}

function QueueRow({
  item,
  busy,
  api,
  onAct,
  webAppUrl,
  manual = false,
  businessVat = null,
  t,
}: RowProps & { webAppUrl: string; manual?: boolean; businessVat?: string | null }) {
  const d = item.document;
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const waitingForWebApp = manual || item.last_error_code === 'manual_mode';

  function copyDetails() {
    if (!d || !navigator.clipboard) return;
    void navigator.clipboard.writeText(webAppDetails(d, businessVat)).then(() => setCopied(true));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void onAct(item.document_id, () => api.manual(item.document_id, number, note));
  }

  return (
    <li className="rounded-card border border-line p-4" data-testid={`queue-${item.document_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink">
          {d ? docLabel(d, t) : t('ita.documentFallback', { id: item.document_id })} {d?.customer_name ? t('ita.forCustomer', { name: d.customer_name }) : ''}
        </p>
        <span className="rounded-full bg-tile-blue px-2 py-0.5 text-xs text-ink">
          {waitingForWebApp ? t('ita.status.stalled') : STATUS_TEXT_KEYS[item.status] ? t(STATUS_TEXT_KEYS[item.status]!) : item.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {waitingForWebApp && item.status !== 'failed' && t('ita.queue.manualWaiting')}
        {!waitingForWebApp && item.status === 'pending' && t('ita.queue.triedTimes', { attempts: item.attempts, next: when(item.next_attempt_at, t) })}
        {!waitingForWebApp && item.status === 'stalled' && t('ita.queue.stalled')}
        {item.status === 'failed' && (item.last_error_message ?? t('ita.queue.failedDefault'))}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!waitingForWebApp && (
          <button type="button" disabled={busy} className="rounded-card border border-line px-3 py-2 text-sm" onClick={() => onAct(item.document_id, () => api.request(item.document_id))}>
            {t('ita.queue.retryNow')}
          </button>
        )}
        {d && (
          <button type="button" className="rounded-card border border-line px-3 py-2 text-sm" onClick={copyDetails}>
            {copied ? t('ita.queue.copied') : t('ita.queue.copyDetails')}
          </button>
        )}
        <a className="text-sm text-accent-2 underline" href={webAppUrl} target="_blank" rel="noreferrer">
          {t('ita.queue.openWebApp')}
        </a>
      </div>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="text-sm text-ink">
          {t('ita.queue.allocationNumberLabel')}
          <input
            className="mt-1 block rounded-card border border-line bg-canvas px-2 py-1"
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label className="text-sm text-ink">
          {t('ita.queue.noteLabel')}
          <input
            className="mt-1 block rounded-card border border-line bg-canvas px-2 py-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('ita.queue.notePlaceholder')}
          />
        </label>
        <button type="submit" disabled={busy || number.trim().length < 9} className="rounded-card bg-brand px-3 py-2 text-sm text-brand-ink disabled:opacity-50">
          {t('ita.queue.saveNumber')}
        </button>
      </form>
    </li>
  );
}
