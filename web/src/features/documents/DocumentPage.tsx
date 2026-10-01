import { type ReactNode, useState } from 'react';
import { useIssuing } from '../../app/issuing';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { type DocEvent, type DocView, type PaymentMethod, docsApi, paymentMethodsApi, pdfApi, sendingApi } from './api';
import { METHOD_LABEL_KEYS, clientName, formatMilli, formatMinor, money, parseMinor, todayLocal, currencyTag } from './format';
import { ChequeBankFields } from './ChequeBankFields';
import { DocTypeExplainer } from './DocTypeExplainer';
import { Card, ErrorNote, Loading, PageTitle, StatusChip, btn, btnDanger, btnPrimary, btnSecondary, errorText, input, label, useLoad } from './ui';

// R18 task 10: 300 is the one proforma type now (merged with PF's behaviour); PF is disabled for
// new documents, so it offers no "convert to" button of its own any more (an already-finalized
// PF can still be paid through the ordinary Record payment flow, unaffected by this map).
const CONVERT_TO: Record<string, { type: string; labelKey: MessageKey }[]> = {
  QT: [
    { type: 'PR', labelKey: 'documents.page.createPaymentRequest' },
    { type: '300', labelKey: 'documents.page.createProforma' },
    { type: '400', labelKey: 'documents.page.createReceipt' },
  ],
  PR: [{ type: '300', labelKey: 'documents.page.createProforma' }],
};

function eventText(t: ReturnType<typeof useT>, e: DocEvent): string {
  switch (e.kind) {
    case 'created':
      return e.details?.from
        ? t('documents.event.createdFrom', { from: String(e.details.from) })
        : e.details?.revises
          ? t('documents.event.revisionOf', { revises: String(e.details.revises) })
          : t('documents.event.created');
    case 'finalized':
      return t('documents.event.finalizedAs', { label: String(e.details?.label ?? '') });
    case 'sent':
      return t('documents.event.sentBy', { channel: String(e.details?.channel ?? 'other') });
    case 'payment':
      return t('documents.event.paymentRecordedOn', { label: String(e.details?.label ?? '') });
    case 'paid':
      return t('documents.event.paidInFull');
    case 'converted':
      return t('documents.event.convertedTo', { label: String(e.details?.label ?? '') });
    case 'credited':
      return t('documents.event.creditedBy', { label: String(e.details?.label ?? '') });
    case 'cancelled':
      return t('documents.event.cancelled', { reason: String(e.details?.reason ?? '') });
    case 'revised':
      return t('documents.event.replacedBy', { label: String(e.details?.label ?? '') });
    case 'target_cancelled':
      return t('documents.event.wasCancelled', { label: e.details?.label ? String(e.details.label) : t('documents.event.linkedDocumentFallback') });
    default:
      return e.kind;
  }
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative ps-10">
      <span className="absolute start-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-band text-sm font-semibold text-brand">{n}</span>
      <Card title={title}>{children}</Card>
    </li>
  );
}

export function DocumentPage() {
  const t = useT();
  const issuing = useIssuing();
  const { locale } = usePreferences();
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, error, setData } = useLoad(() => docsApi.get(id), [id]);
  const paymentMethods = useLoad(() => paymentMethodsApi.list(true), []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [sendForm, setSendForm] = useState<{ to: string; cc: string } | null>(null);
  const [consentRequired, setConsentRequired] = useState<{ clientId: number; clientName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return <>{error ? <ErrorNote error={error} /> : <Loading />}</>;
  const d = data.document;
  const isDraft = d.status === 'draft';
  const isFinal = d.status === 'final';

  /** Runs an action on the document. True when it went through, false when it showed an error. */
  async function act(work: () => Promise<DocView>, go = false): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const next = await work();
      if (go || next.document.id !== id) navigate(`/income/documents/${next.document.id}`);
      else setData(next);
      return true;
    } catch (e) {
      setActionError(e instanceof ApiError && e.code === 'backdate_reason_required' ? t('documents.page.backdateReasonSuffix', { message: e.message }) : errorText(e, t));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleSendError(e: unknown) {
    if (e instanceof ApiError && e.code === 'consent_required') {
      const details = e.details as { clientId?: number; clientName?: string } | undefined;
      setConsentRequired({
        clientId: details?.clientId ?? d.client_id!,
        clientName: details?.clientName ?? (clientName({ name_en: d.client_name_en, name_he: d.client_name_he }, locale) || t('documents.page.thisClientFallback')),
      });
    } else {
      setActionError(errorText(e, t));
    }
  }

  /** Opens the send form, prefilled with the client's email and the default copies. */
  async function openSendForm() {
    setActionError(null);
    setSendNotice(null);
    try {
      const defaults = await sendingApi.sendDefaults(id);
      setSendForm({ to: defaults.to ?? '', cc: defaults.cc.join(', ') });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function sendEmail() {
    if (!sendForm) return;
    setBusy(true);
    setActionError(null);
    setSendNotice(null);
    setConsentRequired(null);
    try {
      const cc = sendForm.cc
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await sendingApi.sendEmail(id, { to: sendForm.to.trim() || null, cc });
      setSendForm(null);
      setSendNotice(t('documents.page.sentByEmailNotice'));
      setData(await docsApi.get(id));
    } catch (e) {
      handleSendError(e);
    } finally {
      setBusy(false);
    }
  }

  async function whatsappLink() {
    setBusy(true);
    setActionError(null);
    setSendNotice(null);
    setConsentRequired(null);
    try {
      const result = await sendingApi.whatsappLink(id);
      setSendNotice(result.waUrl ? t('documents.page.sentByWhatsappNotice') : t('documents.page.sentByWhatsappUrlNotice', { url: result.url }));
      if (result.waUrl) window.open(result.waUrl, '_blank', 'noopener');
      setData(await docsApi.get(id));
    } catch (e) {
      handleSendError(e);
    } finally {
      setBusy(false);
    }
  }

  function showDraft() {
    pdfApi.showDraft(id, 'client');
    pdfApi.showDraft(id, 'filed');
  }

  async function viewCopy(variant: 'client' | 'filed') {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await pdfApi.view(id, variant);
      window.open(`/api${url}`, '_blank', 'noopener');
    } catch (e) {
      setActionError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  /** R17 task 3: next to each view button, saves the file instead of opening it. */
  async function downloadCopy(variant: 'client' | 'filed') {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await pdfApi.download(id, variant);
      window.open(`/api${url}`, '_blank', 'noopener');
    } catch (e) {
      setActionError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function sendConsentRequest() {
    if (!consentRequired) return;
    setBusy(true);
    setActionError(null);
    try {
      await sendingApi.requestConsent(consentRequired.clientId);
      setSendNotice(t('documents.page.consentRequestSentNotice'));
      setConsentRequired(null);
    } catch (e) {
      setActionError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const sentEvents = data.events.filter((e) => e.kind === 'sent');
  const receipts = data.links.outgoing.filter((l) => l.kind === 'payment');
  const credits = data.links.outgoing.filter((l) => l.kind === 'credit');

  // Steps render conditionally (a quote has no Payments step, for example), so number them
  // in sequence as they actually appear rather than with a fixed 1/2/3/4.
  const showPayments = !isDraft && (d.kind === 'demand' || d.kind === 'receipt' || d.kind === 'credit');
  const showCancel = (issuing && isFinal) || d.status === 'cancelled';
  let stepNo = 1;
  const stepCreate = stepNo++;
  const stepSend = !isDraft ? stepNo++ : null;
  const stepPayments = showPayments ? stepNo++ : null;
  const stepCancel = showCancel ? stepNo++ : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <PageTitle
        actions={
          <>
            {isDraft && (
              <>
                <button type="button" className={btnSecondary} onClick={showDraft}>
                  {t('documents.page.showDocument')}
                </button>
                {issuing && (
                  <Link to={`/income/documents/${id}/edit`} className={btnSecondary}>
                    {t('documents.page.editDraft')}
                  </Link>
                )}
                <button type="button" className={btnDanger} disabled={busy} onClick={() => {
                    if (!window.confirm(t('documents.page.deleteDraftConfirm'))) return;
                    void docsApi.remove(id).then(() => navigate('/income/documents'));
                  }}>
                  {t('documents.page.deleteDraft')}
                </button>
              </>
            )}
            {issuing && ['quote', 'demand', 'invoice', 'receipt', 'invoice_receipt'].includes(d.kind) && d.status !== 'cancelled' && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => act(() => docsApi.duplicate(id), true)}>
                {t('documents.page.duplicate')}
              </button>
            )}
            {issuing && isFinal && ['demand', 'invoice'].includes(d.kind) && (
              <Link to={`/income/recurring?template=${id}`} className={btnSecondary}>
                {t('documents.page.makeRecurring')}
              </Link>
            )}
            {issuing && isFinal && ['QT', 'PR'].includes(d.type) && d.state !== 'converted' && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => act(() => docsApi.revise(id))}>
                {t('documents.page.revise')}
              </button>
            )}
            {issuing &&
              isFinal &&
              d.state !== 'converted' &&
              (CONVERT_TO[d.type] ?? []).map((c) => (
                <button key={c.type} type="button" className={btnSecondary} disabled={busy} onClick={() => act(() => docsApi.convert(id, c.type))}>
                  {t(c.labelKey)}
                </button>
              ))}
          </>
        }
      >
        {d.display_number ?? t('documents.page.draftFallbackTitle', { typeName: d.type_name_en })}
      </PageTitle>
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-3 text-sm text-muted">
        <StatusChip state={d.state} overdue={d.overdue} />
        <span>{d.type_name_en}</span>
        {d.client_id && (
          <Link to={`/clients/${d.client_id}`} className="text-brand hover:underline">
            {clientName({ name_en: d.client_name_en, name_he: d.client_name_he }, locale)}
          </Link>
        )}
        {data.source && (
          <span>
            {t('documents.page.fromLabel')}{' '}
            <Link to={`/income/documents/${data.source.id}`} className="text-brand hover:underline">
              {data.source.display_number}
            </Link>
          </span>
        )}
      </div>
      <DocTypeExplainer type={d.type} issued={!isDraft} />
      {!issuing && <p className="mb-4 rounded-md bg-surface px-3 py-2 text-sm text-muted">{t('issuing.offNote')}</p>}
      <ErrorNote error={actionError} />

      <ol className="space-y-4" aria-label={t('documents.page.timelineLabel')}>
        <Step n={stepCreate} title={t('documents.page.stepCreate')}>
          <Summary view={data} />
          {issuing && isDraft && (
            <button type="button" className={`${btnPrimary} mt-4`} disabled={busy} onClick={() => act(() => docsApi.finalize(id))}>
              {t('documents.page.finalize')}
            </button>
          )}
        </Step>

        {!isDraft && (
          <Step n={stepSend!} title={t('documents.page.stepSend')}>
            {sentEvents.length === 0 ? (
              <p className="text-sm text-muted">{t('documents.page.notSentYet')}</p>
            ) : (
              <ul className="text-sm">
                {sentEvents.map((e) => (
                  <li key={e.id}>{t('documents.page.sentByOn', { channel: String(e.details?.channel ?? 'other'), date: e.at.slice(0, 10) })}</li>
                ))}
              </ul>
            )}
            {sendNotice && (
              <div role="status" className="mt-3 flex items-start justify-between gap-3 rounded-md border border-success bg-surface p-3 text-sm text-ink">
                <span>
                  <span aria-hidden="true" className="me-2 font-semibold text-success">
                    ✓
                  </span>
                  {sendNotice}
                </span>
                <button type="button" aria-label={t('documents.page.closeNotice')} className="px-1 text-lg leading-none text-muted hover:text-ink" onClick={() => setSendNotice(null)}>
                  ×
                </button>
              </div>
            )}
            {sendForm && (
              <form
                className="mt-3 grid gap-2 rounded-md border border-line bg-surface p-3 md:grid-cols-[1fr_1fr_auto_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendEmail();
                }}
              >
                <label className="block">
                  <span className={label}>{t('documents.page.sendTo')}</span>
                  <input type="email" dir="ltr" required className={input} value={sendForm.to} onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })} />
                </label>
                <label className="block">
                  <span className={label}>{t('documents.page.sendCc')}</span>
                  <input
                    dir="ltr"
                    className={input}
                    value={sendForm.cc}
                    placeholder={t('documents.page.sendCcPlaceholder')}
                    onChange={(e) => setSendForm({ ...sendForm, cc: e.target.value })}
                  />
                </label>
                <button type="submit" className={`${btnPrimary} self-end`} disabled={busy}>
                  {t('documents.page.sendNow')}
                </button>
                <button type="button" className={`${btnSecondary} self-end`} disabled={busy} onClick={() => setSendForm(null)}>
                  {t('documents.page.sendCancel')}
                </button>
                <p className="text-xs text-muted md:col-span-4">{t('documents.page.sendCcHint')}</p>
              </form>
            )}
            {consentRequired && (
              <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm">
                <p>{t('documents.page.consentRequiredNotice', { clientName: consentRequired.clientName })}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btnSecondary} disabled={busy} onClick={() => void sendConsentRequest()}>
                    {t('documents.page.sendConsentRequest')}
                  </button>
                  <Link to={`/clients/${consentRequired.clientId}/edit`} className={btnSecondary}>
                    {t('documents.page.recordConsentManually')}
                  </Link>
                </div>
              </div>
            )}
            {isFinal && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void viewCopy('client')}>
                  {t('documents.page.viewClientCopy')}
                </button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void downloadCopy('client')}>
                  {t('documents.page.downloadClientCopy')}
                </button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void viewCopy('filed')}>
                  {t('documents.page.viewFiledCopy')}
                </button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void downloadCopy('filed')}>
                  {t('documents.page.downloadFiledCopy')}
                </button>
                <button type="button" className={sentEvents.length === 0 ? btnPrimary : btnSecondary} disabled={busy} onClick={() => void openSendForm()}>
                  {t('documents.page.sendByEmail')}
                </button>
                <button
                  type="button"
                  className={sentEvents.length === 0 ? `${btn} bg-[#128C4A] text-white hover:opacity-90` : btnSecondary}
                  disabled={busy}
                  onClick={() => void whatsappLink()}
                >
                  {t('documents.page.getWhatsappLink')}
                </button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => {
                    setSendNotice(null);
                    void act(() => docsApi.sent(id, 'print')).then((ok) => ok && setSendNotice(t('documents.page.markedSentByPrintNotice')));
                  }}
                >
                  {t('documents.page.markSentByPrint')}
                </button>
              </div>
            )}
          </Step>
        )}

        {!isDraft && d.kind === 'demand' && (
          <Step n={stepPayments!} title={t('documents.page.stepPayments')}>
            <p className="text-sm">
              {t('documents.page.paidOfTotal', { paid: money(d.paid_minor ?? 0, d.currency), total: money(d.total_minor, d.currency) })}{' '}
              {(d.remaining_minor ?? 0) > 0 && <span className="font-semibold">{t('documents.page.openRemaining', { remaining: money(d.remaining_minor!, d.currency) })}</span>}
            </p>
            {receipts.length > 0 && (
              <ul className="mt-2 text-sm">
                {receipts.map((r) => (
                  <li key={r.id}>
                    <Link to={`/income/documents/${r.other_id}`} className="text-brand hover:underline">
                      {r.other_display_number}
                    </Link>{' '}
                    {money(r.amount_minor ?? 0, d.currency)} {r.other_status === 'cancelled' && <span className="text-danger">{t('documents.page.cancelledLower')}</span>}
                  </li>
                ))}
              </ul>
            )}
            {issuing && isFinal && (d.remaining_minor ?? 0) > 0 && (
              <RecordPayment
                remaining={d.remaining_minor!}
                currency={d.currency}
                busy={busy}
                methods={paymentMethods.data?.paymentMethods ?? []}
                onSubmit={({ overrideRate, latestRate, ...payment }) => act(() => docsApi.recordPayment(id, { payments: [payment], overrideRate, latestRate }), true)}
              />
            )}
          </Step>
        )}

        {!isDraft && ['receipt', 'credit'].includes(d.kind) && (
          <Step n={stepPayments!} title={t('documents.page.stepPayments')}>
            <PaymentsTable view={data} />
            {credits.length > 0 && (
              <ul className="mt-2 text-sm">
                {credits.map((c) => (
                  <li key={c.id}>
                    {t('documents.page.creditedBy')}{' '}
                    <Link to={`/income/documents/${c.other_id}`} className="text-brand hover:underline">
                      {c.other_display_number}
                    </Link>{' '}
                    {money(c.amount_minor ?? 0, d.currency)}
                  </li>
                ))}
              </ul>
            )}
            {issuing && isFinal && d.kind === 'receipt' && d.state !== 'credited' && <CreditForm busy={busy} currency={d.currency} onSubmit={(body) => act(() => docsApi.credit(id, body), true)} />}
          </Step>
        )}

        {issuing && isFinal && (
          <Step n={stepCancel!} title={t('documents.page.stepCancel')}>
            <CancelForm busy={busy} onSubmit={(reason) => act(() => docsApi.cancel(id, reason))} />
          </Step>
        )}
        {d.status === 'cancelled' && (
          <Step n={stepCancel!} title={t('documents.state.cancelled')}>
            <p className="text-sm text-danger">{d.cancel_reason}</p>
          </Step>
        )}
      </ol>

      <Card title={t('documents.page.historyTitle')}>
        <ul className="space-y-1 text-sm">
          {data.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3">
              <span>{eventText(t, e)}</span>
              <span className="ltr-nums text-muted tabular-nums">{e.at.slice(0, 16).replace('T', ' ')}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Summary({ view }: { view: DocView }) {
  const t = useT();
  const d = view.document;
  const showIls = d.currency !== 'ILS' && d.total_ils_minor !== null;
  const rateNote =
    d.fx_source === 'carried'
      ? t('documents.page.rateCarriedFrom', { source: view.source?.display_number ?? t('documents.page.theSourceFallback') })
      : d.fx_source === 'agreed'
        ? t('documents.page.rateAgreed')
        : d.fx_source === 'indicative'
          ? t('documents.page.rateIndicative')
          : t('documents.page.rateBankOfIsrael');
  return (
    <div className="space-y-3 text-sm">
      <p>
        {t('documents.page.datedOn', { date: d.date })}
        {d.due_date && t('documents.page.dueSuffix', { dueDate: d.due_date })}
      </p>
      {view.lines.length > 0 && (
        <table className="w-full">
          <thead className="bg-band text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-1">{t('documents.page.colItem')}</th>
              <th className="px-2 py-1 text-end">{t('documents.page.colQty')}</th>
              <th className="px-2 py-1 text-end">{t('documents.page.colPrice')}</th>
              <th className="px-2 py-1 text-end">{t('documents.page.colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-2 py-1">
                  {l.description_en}
                  {l.description_he && (
                    <span dir="rtl" className="block text-xs text-muted">
                      {l.description_he}
                    </span>
                  )}
                </td>
                <td className="ltr-nums px-2 py-1 text-end tabular-nums">{formatMilli(l.quantity_milli)}</td>
                <td className="ltr-nums px-2 py-1 text-end tabular-nums">{money(l.unit_price_minor, d.currency)}</td>
                <td className="ltr-nums px-2 py-1 text-end tabular-nums">{money(l.line_total_minor, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="ltr-nums text-end text-lg font-semibold tabular-nums">
        {t('documents.page.totalLabel')} {money(d.total_minor, d.currency)}
      </p>
      {showIls && (
        <p className="ltr-nums text-end text-muted tabular-nums">
          {money(d.total_ils_minor!, 'ILS')}
          {d.fx_rate && ` ${t('documents.page.atRateNote', { rate: d.fx_rate, rateNote, rateDate: d.fx_rate_date ?? '' })}`}
        </p>
      )}
      {d.notes && <p className="whitespace-pre-wrap">{d.notes}</p>}
    </div>
  );
}

function PaymentsTable({ view }: { view: DocView }) {
  const t = useT();
  const d = view.document;
  return (
    <table className="w-full text-sm">
      <thead className="bg-band text-start text-xs uppercase text-muted">
        <tr>
          <th className="px-2 py-1">{t('documents.page.colMethod')}</th>
          <th className="px-2 py-1">{t('documents.page.colPaidOn')}</th>
          <th className="px-2 py-1">{t('documents.page.colReference')}</th>
          <th className="px-2 py-1 text-end">{t('documents.page.colAmount')}</th>
          <th className="px-2 py-1 text-end">{t('documents.page.colIls')}</th>
        </tr>
      </thead>
      <tbody>
        {view.payments.map((p) => {
          const methodKey = METHOD_LABEL_KEYS[p.method];
          return (
            <tr key={p.id} className="border-t border-line">
              <td className="px-2 py-1">
                {p.method_detail?.display_name ?? (methodKey ? t(methodKey) : p.method)}
                {p.cheque_crossed === 1 && t('documents.page.crossedSuffix')}
                {p.bank_number && (
                  <span className="ltr-nums block text-xs text-muted">
                    {t('documents.cheque.summary', { bank: p.bank_number, branch: p.branch_number ?? '', account: p.account_number ?? '' })}
                  </span>
                )}
              </td>
              <td className="ltr-nums px-2 py-1 tabular-nums">{p.paid_on}</td>
              <td className="px-2 py-1">{p.reference}</td>
              <td className="ltr-nums px-2 py-1 text-end tabular-nums">{money(p.amount_minor, d.currency)}</td>
              <td className="ltr-nums px-2 py-1 text-end tabular-nums">
                {p.amount_ils_minor !== null && money(p.amount_ils_minor, 'ILS')}
                {p.fx_rate && <span className="block text-xs text-muted">{t('documents.page.atRateShort', { rate: p.fx_rate })}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RecordPayment({
  remaining,
  currency,
  busy,
  methods,
  onSubmit,
}: {
  remaining: number;
  currency: string;
  busy: boolean;
  methods: PaymentMethod[];
  onSubmit: (p: {
    method: string;
    methodId: number | null;
    paidOn: string;
    amountMinor: number;
    reference: string | null;
    chequeCrossed: boolean;
    bankNumber: string | null;
    branchNumber: string | null;
    accountNumber: string | null;
    overrideRate: string | null;
    latestRate: boolean;
  }) => void;
}) {
  const t = useT();
  const [method, setMethod] = useState('bank_transfer');
  const [methodId, setMethodId] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [amount, setAmount] = useState(formatMinor(remaining).replace(/,/g, ''));
  const [reference, setReference] = useState('');
  const [crossed, setCrossed] = useState(false);
  const [bank, setBank] = useState({ bankNumber: '', branchNumber: '', accountNumber: '' });
  const [rate, setRate] = useState('');
  const [latest, setLatest] = useState(false);
  const foreign = currency !== 'ILS';
  const [error, setError] = useState<string | null>(null);
  const isCheque = methodId !== null ? methods.find((m) => m.id === methodId)?.type === 'cheque' : method === 'cheque';
  return (
    <form
      className="mt-4 grid gap-2 md:grid-cols-[160px_150px_1fr_130px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const amountMinor = parseMinor(amount);
        if (amountMinor === null || amountMinor <= 0) return setError(t('documents.page.checkAmountError'));
        setError(null);
        onSubmit({
          method,
          methodId,
          paidOn,
          amountMinor,
          reference: reference || null,
          chequeCrossed: crossed,
          bankNumber: isCheque ? bank.bankNumber || null : null,
          branchNumber: isCheque ? bank.branchNumber || null : null,
          accountNumber: isCheque ? bank.accountNumber || null : null,
          overrideRate: foreign && !latest && rate.trim() ? rate.trim() : null,
          latestRate: foreign && latest,
        });
      }}
    >
      {methods.length > 0 ? (
        <select
          aria-label={t('documents.page.paymentMethodAriaLabel')}
          className={input}
          value={methodId ?? ''}
          onChange={(e) => setMethodId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="" disabled>
            {t('documents.page.paymentMethodAriaLabel')}
          </option>
          {methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      ) : (
        <select aria-label={t('documents.page.paymentMethodAriaLabel')} className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(METHOD_LABEL_KEYS).map(([k, messageKey]) => (
            <option key={k} value={k}>
              {t(messageKey)}
            </option>
          ))}
        </select>
      )}
      <input aria-label={t('documents.page.paidOnAriaLabel')} type="date" dir="ltr" className={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      <input
        aria-label={t('documents.page.referenceAriaLabel')}
        placeholder={t('documents.page.referenceAriaLabel')}
        className={input}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <input
        aria-label={t('documents.page.amountInCurrency', { currency })}
        inputMode="decimal"
        className={input}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button type="submit" className={btnPrimary} disabled={busy}>
        {t('documents.page.recordPayment')}
      </button>
      {isCheque && (
        <label className="flex items-center gap-2 text-sm md:col-span-5">
          <input type="checkbox" checked={crossed} onChange={(e) => setCrossed(e.target.checked)} /> {t('documents.page.crossedCheque')}
        </label>
      )}
      {isCheque && <ChequeBankFields index={1} value={bank} onChange={(patch) => setBank({ ...bank, ...patch })} />}
      {foreign && (
        <label className="block md:col-span-2">
          <span className={label}>{t('documents.page.receiptRateLabel', { currency })}</span>
          <input
            aria-label={t('documents.page.receiptRateLabel', { currency })}
            inputMode="decimal"
            dir="ltr"
            className={input}
            value={rate}
            disabled={latest}
            placeholder={t('documents.page.receiptRatePlaceholder')}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
      )}
      {foreign && (
        <label className="flex items-center gap-2 text-sm md:col-span-3 md:self-end">
          <input type="checkbox" checked={latest} onChange={(e) => setLatest(e.target.checked)} /> {t('documents.editor.latestRateLabel')}
        </label>
      )}
      <p className="text-xs text-muted md:col-span-5">{t('documents.page.recordPaymentHint')}</p>
      <ErrorNote error={error} />
    </form>
  );
}

function CreditForm({ busy, currency, onSubmit }: { busy: boolean; currency: string; onSubmit: (b: { mode: 'full' | 'partial'; amountMinor?: number; reason?: string }) => void }) {
  const t = useT();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ mode, amountMinor: mode === 'partial' ? (parseMinor(amount) ?? undefined) : undefined, reason: reason || undefined });
      }}
    >
      <label>
        <span className={label}>{t('documents.page.creditLabel')}</span>
        <select aria-label={t('documents.page.creditModeAriaLabel')} className={input} value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'partial')}>
          <option value="full">{t('documents.page.creditFull')}</option>
          <option value="partial">{t('documents.page.creditPartial')}</option>
        </select>
      </label>
      {mode === 'partial' && (
        <label>
          <span className={label}>{t('documents.page.creditAmountLabel')}</span>
          {/* The credit is always in the receipt's own currency; the tag says which. */}
          <span className="flex items-center gap-2">
            <span className="ltr-nums shrink-0 text-sm font-semibold text-muted" data-testid="credit-currency">
              {currencyTag(currency)}
            </span>
            <input aria-label={t('documents.page.creditAmountAriaLabel')} inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </span>
        </label>
      )}
      <label className="flex-1">
        <span className={label}>{t('documents.page.reasonLabel')}</span>
        <input aria-label={t('documents.page.creditReasonAriaLabel')} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className={btnSecondary} disabled={busy}>
        {t('documents.page.issueCreditReceipt')}
      </button>
    </form>
  );
}

function CancelForm({ busy, onSubmit }: { busy: boolean; onSubmit: (reason: string) => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <label className="flex-1">
        <span className={label}>{t('documents.page.reasonLabel')}</span>
        <input aria-label={t('documents.page.cancelReasonAriaLabel')} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className={btnDanger} disabled={busy || !reason.trim()}>
        {t('documents.page.cancelDocument')}
      </button>
      <p className="w-full text-xs text-muted">{t('documents.page.cancelHint')}</p>
    </form>
  );
}
