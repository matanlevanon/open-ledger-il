import { useEffect, useState } from 'react';
import { useIssuing } from '../../app/issuing';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { type DocListItem, apiSend, docsApi } from './api';
import { clientName, money, todayLocal } from './format';
import { Card, ErrorNote, Loading, PageTitle, btnPrimary, btnSecondary, errorText, input, label, useLoad } from './ui';

type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type Mode = 'approve' | 'auto';

interface Schedule {
  id: number;
  name: string | null;
  template_document_id: number;
  template_type: string;
  template_number: number | null;
  template_type_name_en: string;
  template_type_name_he: string | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string;
  total_minor: number;
  frequency: Frequency;
  next_run_date: string;
  end_date: string | null;
  mode: Mode;
  send_email: number;
  active: number;
  due_days: number | null;
}

interface Run {
  id: number;
  schedule_name: string | null;
  run_date: string;
  document_id: number | null;
  document_number: number | null;
  document_status: string | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string | null;
  total_minor: number | null;
  status: 'pending_approval' | 'issued' | 'sent' | 'skipped' | 'failed';
  error: string | null;
  send_email: number;
}

interface RecurringState {
  schedules: Schedule[];
  runs: Run[];
}

const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
/** Documents that ask for money repeat: payment requests, pro formas, transaction and tax invoices. */
const TEMPLATE_TYPES = 'PR,PF,300,305';

const STATUS_KEY: Record<Run['status'], MessageKey> = {
  pending_approval: 'recurring.status.pending',
  issued: 'recurring.status.issued',
  sent: 'recurring.status.sent',
  skipped: 'recurring.status.skipped',
  failed: 'recurring.status.failed',
};

function NewSchedule({ onCreated }: { onCreated: (s: RecurringState) => void }) {
  const t = useT();
  const { locale } = usePreferences();
  const [params] = useSearchParams();
  const [templates, setTemplates] = useState<DocListItem[]>([]);
  const [form, setForm] = useState({
    templateDocumentId: Number(params.get('template')) || 0,
    name: '',
    frequency: 'monthly' as Frequency,
    startDate: todayLocal(),
    endDate: '',
    mode: 'approve' as Mode,
    sendEmail: true,
    dueDays: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    docsApi
      .list({ type: TEMPLATE_TYPES })
      .then((l) => setTemplates(l.items.filter((d) => d.status !== 'cancelled')))
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await apiSend<RecurringState>('POST', '/recurring', {
        ...form,
        endDate: form.endDate || null,
        name: form.name || null,
        dueDays: form.dueDays.trim() === '' ? null : Number(form.dueDays),
      });
      onCreated(next);
      setForm((f) => ({ ...f, templateDocumentId: 0, name: '', endDate: '', dueDays: '' }));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('recurring.new.title')}>
      <p className="mb-3 text-sm text-muted">{t('recurring.new.hint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="sm:col-span-2">
          <span className={label}>{t('recurring.field.template')}</span>
          <select className={input} value={form.templateDocumentId || ''} onChange={(e) => setForm({ ...form, templateDocumentId: Number(e.target.value) })}>
            <option value="">{t('recurring.field.pickTemplate')}</option>
            {templates.map((d) => (
              <option key={d.id} value={d.id}>
                {(d.display_number ?? `${d.type_name_en} (${t('recurring.draft')})`) +
                  ' · ' +
                  (clientName({ name_en: d.client_name_en, name_he: d.client_name_he }, locale) || '') +
                  ' · ' +
                  money(d.total_minor, d.currency)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>{t('recurring.field.name')}</span>
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('recurring.field.namePlaceholder')} />
        </label>
        <label>
          <span className={label}>{t('recurring.field.frequency')}</span>
          <select className={input} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`recurring.frequency.${f}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>{t('recurring.field.startDate')}</span>
          <input type="date" dir="ltr" className={input} value={form.startDate} min={todayLocal()} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </label>
        <label>
          <span className={label}>{t('recurring.field.endDate')}</span>
          <input type="date" dir="ltr" className={input} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </label>
        <label>
          <span className={label}>{t('recurring.field.dueDays')}</span>
          <input
            inputMode="numeric"
            dir="ltr"
            className={input}
            value={form.dueDays}
            placeholder={t('recurring.field.dueDaysPlaceholder')}
            onChange={(e) => setForm({ ...form, dueDays: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          />
        </label>
        <label className="sm:col-span-2">
          <span className={label}>{t('recurring.field.mode')}</span>
          <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Mode })}>
            <option value="approve">{t('recurring.mode.approve')}</option>
            <option value="auto">{t('recurring.mode.auto')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />
          {t('recurring.field.sendEmail')}
        </label>
      </div>
      <ErrorNote error={error} />
      <button type="button" className={`${btnPrimary} mt-3`} disabled={busy || !form.templateDocumentId} onClick={() => void save()}>
        {t('recurring.new.save')}
      </button>
    </Card>
  );
}

/**
 * Approvals: every recurring copy waiting for you, as cards that work on a phone. Approve issues it
 * (and emails it when the schedule says so), Skip deletes the draft, Open shows the draft first.
 */
export function ApprovalsPage() {
  const t = useT();
  const issuing = useIssuing();
  const { locale } = usePreferences();
  const { data, error } = useLoad(() => apiGet<RecurringState>('/recurring'), []);
  const [state, setState] = useState<RecurringState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (data) setState(data);
  }, [data]);

  async function act(work: () => Promise<RecurringState>, notice: string) {
    setBusy(true);
    setActionError(null);
    setDone(null);
    try {
      setState(await work());
      setDone(notice);
    } catch (e) {
      setActionError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const pending = (state?.runs ?? []).filter((r) => r.status === 'pending_approval');
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageTitle subtitle={t('approvals.subtitle')}>{t('nav.incomeApprovals')}</PageTitle>
      {!issuing && <p className="rounded-md bg-surface px-3 py-2 text-sm text-muted">{t('issuing.recurringPaused')}</p>}
      <ErrorNote error={error ?? actionError} />
      {done && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-success bg-surface p-3 text-sm">
          <span>{done}</span>
          <button type="button" aria-label={t('documents.page.closeNotice')} className="px-1 text-lg leading-none text-muted hover:text-ink" onClick={() => setDone(null)}>
            ×
          </button>
        </div>
      )}
      {!state ? (
        !error && <Loading />
      ) : pending.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-muted">{t('approvals.empty')}</p>
          <p className="text-center text-sm">
            <Link to="/income/recurring" className="text-brand hover:underline">
              {t('approvals.toRecurring')}
            </Link>
          </p>
        </Card>
      ) : (
        pending.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-base font-semibold text-ink">{r.schedule_name || t('recurring.draft')}</span>
              <span>{clientName({ name_en: r.client_name_en, name_he: r.client_name_he }, locale)}</span>
              <span className="ltr-nums text-lg font-semibold">{r.total_minor !== null && r.currency ? money(r.total_minor, r.currency) : ''}</span>
              <span className="text-muted">{t('approvals.runDate', { date: r.run_date })}</span>
              {r.send_email === 1 && <span className="text-muted">{t('approvals.willEmail')}</span>}
            </div>
            {issuing && (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => void act(() => apiSend<RecurringState>('POST', `/recurring/runs/${r.id}/approve`), r.send_email ? t('approvals.approvedSent') : t('approvals.approved'))}
                >
                  {r.send_email ? t('recurring.approveSend') : t('recurring.approve')}
                </button>
                <Link to={`/income/documents/${r.document_id}`} className={btnSecondary}>
                  {t('approvals.open')}
                </Link>
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('approvals.skipConfirm'))) return;
                    void act(() => apiSend<RecurringState>('POST', `/recurring/runs/${r.id}/skip`), t('approvals.skipped'));
                  }}
                >
                  {t('recurring.skip')}
                </button>
              </div>
            )}
          </Card>
        ))
      )}
    </section>
  );
}

/** How many recurring copies wait for approval, for the Quick page and the menu. */
export function usePendingApprovals(): number {
  const { data } = useLoad(() => apiGet<RecurringState>('/recurring').catch(() => null), []);
  return (data?.runs ?? []).filter((r) => r.status === 'pending_approval').length;
}

export function RecurringPage() {
  const t = useT();
  const issuing = useIssuing();
  const { locale } = usePreferences();
  const { data, error } = useLoad(() => apiGet<RecurringState>('/recurring'), []);
  const [state, setState] = useState<RecurringState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setState(data);
  }, [data]);

  async function act(work: () => Promise<RecurringState>) {
    setBusy(true);
    setActionError(null);
    try {
      setState(await work());
    } catch (e) {
      setActionError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const name = (r: { client_name_en: string | null; client_name_he: string | null }) => clientName({ name_en: r.client_name_en, name_he: r.client_name_he }, locale);
  const pending = (state?.runs ?? []).filter((r) => r.status === 'pending_approval');
  const history = (state?.runs ?? []).filter((r) => r.status !== 'pending_approval');

  return (
    <section className="flex flex-col gap-6">
      <PageTitle
        subtitle={t('recurring.subtitle')}
        actions={
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void act(() => apiSend<RecurringState>('POST', '/recurring/run-due'))}>
            {t('recurring.runDue')}
          </button>
        }
      >
        {t('nav.incomeRecurring')}
      </PageTitle>
      {!issuing && <p className="mb-4 rounded-md bg-surface px-3 py-2 text-sm text-muted">{t('issuing.recurringPaused')}</p>}
      <ErrorNote error={error ?? actionError} />
      {!state ? (
        !error && <Loading />
      ) : (
        <>
          {pending.length > 0 && (
            <Card title={t('recurring.pending.title')}>
              <ul className="flex flex-col divide-y divide-line">
                {pending.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className="text-sm">
                      <Link to={`/income/documents/${r.document_id}`} className="font-semibold text-brand hover:underline">
                        {r.schedule_name || t('recurring.draft')}
                      </Link>{' '}
                      · {name(r)} · <span className="ltr-nums">{r.total_minor !== null && r.currency ? money(r.total_minor, r.currency) : ''}</span> ·{' '}
                      <span className="ltr-nums">{r.run_date}</span>
                    </span>
                    <span className="flex gap-2">
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act(() => apiSend<RecurringState>('POST', `/recurring/runs/${r.id}/approve`))}>
                        {r.send_email ? t('recurring.approveSend') : t('recurring.approve')}
                      </button>
                      <button type="button" className={btnSecondary} disabled={busy} onClick={() => void act(() => apiSend<RecurringState>('POST', `/recurring/runs/${r.id}/skip`))}>
                        {t('recurring.skip')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={t('recurring.schedules.title')}>
            {state.schedules.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">{t('recurring.schedules.empty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-band text-start text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('recurring.col.template')}</th>
                      <th className="px-3 py-2 text-start">{t('recurring.col.client')}</th>
                      <th className="px-3 py-2 text-end">{t('recurring.col.amount')}</th>
                      <th className="px-3 py-2 text-start">{t('recurring.col.frequency')}</th>
                      <th className="px-3 py-2 text-start">{t('recurring.col.next')}</th>
                      <th className="px-3 py-2 text-start">{t('recurring.col.due')}</th>
                      <th className="px-3 py-2 text-start">{t('recurring.col.mode')}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {state.schedules.map((s) => (
                      <tr key={s.id} className={`border-t border-line ${s.active ? '' : 'opacity-60'}`}>
                        <td className="px-3 py-2">
                          <Link to={`/income/documents/${s.template_document_id}`} className="text-brand hover:underline">
                            {s.name || `${locale === 'he' ? s.template_type_name_he || s.template_type_name_en : s.template_type_name_en} ${s.template_number ?? ''}`}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{name(s)}</td>
                        <td className="ltr-nums px-3 py-2 text-end tabular-nums">{money(s.total_minor, s.currency)}</td>
                        <td className="px-3 py-2">{t(`recurring.frequency.${s.frequency}` as MessageKey)}</td>
                        <td className="ltr-nums px-3 py-2">{s.active ? s.next_run_date : t('recurring.paused')}</td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={t('recurring.field.dueDays')}
                            inputMode="numeric"
                            dir="ltr"
                            className={`${input} w-20`}
                            defaultValue={s.due_days ?? ''}
                            placeholder="—"
                            disabled={busy}
                            onBlur={(e) => {
                              const v = e.target.value.replace(/\D/g, '');
                              const next = v === '' ? null : Math.min(365, Number(v));
                              if (next !== s.due_days) void act(() => apiSend<RecurringState>('PATCH', `/recurring/${s.id}`, { dueDays: next }));
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={input}
                            value={s.mode}
                            disabled={busy}
                            onChange={(e) => void act(() => apiSend<RecurringState>('PATCH', `/recurring/${s.id}`, { mode: e.target.value }))}
                          >
                            <option value="approve">{t('recurring.mode.approveShort')}</option>
                            <option value="auto">{t('recurring.mode.autoShort')}</option>
                          </select>
                          <label className="mt-1 flex items-center gap-2 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={s.send_email === 1}
                              disabled={busy}
                              onChange={(e) => void act(() => apiSend<RecurringState>('PATCH', `/recurring/${s.id}`, { sendEmail: e.target.checked }))}
                            />
                            {t('recurring.field.sendEmail')}
                          </label>
                        </td>
                        <td className="px-3 py-2 text-end">
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                apiSend<RecurringState>('PATCH', `/recurring/${s.id}`, {
                                  active: !s.active,
                                  ...(s.active || s.next_run_date >= todayLocal() ? {} : { nextRunDate: todayLocal() }),
                                }),
                              )
                            }
                          >
                            {s.active ? t('recurring.pause') : t('recurring.resume')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <NewSchedule onCreated={setState} />

          {history.length > 0 && (
            <Card title={t('recurring.history.title')}>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {history.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="ltr-nums">{r.run_date}</span> · {r.schedule_name || name(r)} ·{' '}
                      {r.document_id ? (
                        <Link to={`/income/documents/${r.document_id}`} className="text-brand hover:underline">
                          {r.document_number ?? t('recurring.draft')}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </span>
                    <span className={r.status === 'failed' || r.error ? 'text-danger' : 'text-muted'}>
                      {t(STATUS_KEY[r.status])}
                      {r.error ? `: ${r.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
