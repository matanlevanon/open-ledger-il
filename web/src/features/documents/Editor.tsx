import { type FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { useToast } from '../../components/Toast';
import { fetchBusiness } from '../settings/api';
import { type Client, type DocView, type DraftInput, type PaymentMethod, type Service, clientsApi, docsApi, paymentMethodsApi, servicesApi } from './api';
import { Dialog } from '../../components/Dialog';
import { ChequeBankFields } from './ChequeBankFields';
import { DocTypeExplainer } from './DocTypeExplainer';
import { CeilingCrossingDialog, type CeilingCrossingDetails } from './CeilingCrossingDialog';
import { CURRENCIES, METHOD_LABEL_KEYS, clientName, formatMilli, formatMinor, lineTotal, money, parseMilli, parseMinor, todayLocal } from './format';
import { Card, ErrorNote, Loading, PageTitle, btnPrimary, btnSecondary, errorText, input, label, useLoad } from './ui';

/** Shared with the client page's "New document" dropdown (R18 task 7). */
export const TYPE_NAME_KEYS: Record<string, MessageKey> = {
  QT: 'documents.editor.typeLower.quote',
  PR: 'documents.editor.typeLower.paymentRequest',
  // R18 task 10: 300 is the one proforma type now; PF stays mapped the same way for an
  // already-finalized PF document, which still needs a label when displayed.
  PF: 'documents.editor.typeLower.proforma',
  '300': 'documents.editor.typeLower.proforma',
  '400': 'documents.editor.typeLower.receipt',
  '405': 'documents.editor.typeLower.creditReceipt',
  '305': 'documents.editor.typeLower.taxInvoice',
  '320': 'documents.editor.typeLower.taxInvoiceReceipt',
};

interface LineText {
  description: string;
  descriptionHe: string;
  /** The optional description line below the item name (R18 task 4), carried from the service catalog's own description. */
  detail: string;
  detailHe: string;
  quantity: string;
  price: string;
  /** The service this line was filled from, or saved to (R17 task 5). Purely informational; every field stays editable. */
  itemId: number | null;
}

interface PaymentText {
  method: string;
  methodId: number | null;
  paidOn: string;
  reference: string;
  amount: string;
  chequeCrossed: boolean;
  bankNumber: string;
  branchNumber: string;
  accountNumber: string;
}

interface EditorState {
  clientId: number | null;
  date: string;
  dueDate: string;
  currency: string;
  notes: string;
  paymentInstructions: string;
  paymentMethodIds: number[];
  langVariant: 'en' | 'bilingual';
  lines: LineText[];
  payments: PaymentText[];
  showIls: boolean;
  overrideRate: string;
  carryRate: boolean;
}

const emptyLine = (): LineText => ({ description: '', descriptionHe: '', detail: '', detailHe: '', quantity: '1', price: '', itemId: null });
const emptyPayment = (date: string, methodId: number | null = null): PaymentText => ({
  method: 'bank_transfer',
  methodId,
  paidOn: date,
  reference: '',
  amount: '',
  chequeCrossed: false,
  bankNumber: '',
  branchNumber: '',
  accountNumber: '',
});

/** Whether a payment's chosen method is a cheque, from the catalog entry when one is picked, else the legacy bucket. */
function isChequeMethod(p: PaymentText, methods: PaymentMethod[]): boolean {
  if (p.methodId !== null) return methods.find((m) => m.id === p.methodId)?.type === 'cheque';
  return p.method === 'cheque';
}

function fromView(v: DocView): EditorState {
  const d = v.document;
  return {
    clientId: d.client_id,
    date: d.date,
    dueDate: d.due_date ?? '',
    currency: d.currency,
    notes: d.notes ?? '',
    paymentInstructions: d.payment_instructions ?? '',
    paymentMethodIds: d.payment_method_ids ? (JSON.parse(d.payment_method_ids) as number[]) : [],
    langVariant: d.lang_variant,
    lines: v.lines.map((l) => ({
      description: l.description_en,
      descriptionHe: l.description_he ?? '',
      detail: l.detail_en ?? '',
      detailHe: l.detail_he ?? '',
      quantity: formatMilli(l.quantity_milli),
      price: formatMinor(l.unit_price_minor).replace(/,/g, ''),
      itemId: l.item_id,
    })),
    payments: v.payments.map((p) => ({
      method: p.method,
      methodId: p.method_id,
      paidOn: p.paid_on,
      reference: p.reference ?? '',
      amount: formatMinor(p.amount_minor).replace(/,/g, ''),
      chequeCrossed: p.cheque_crossed === 1,
      bankNumber: p.bank_number ?? '',
      branchNumber: p.branch_number ?? '',
      accountNumber: p.account_number ?? '',
    })),
    showIls: v.meta?.show_ils === 1,
    overrideRate: d.fx_source === 'agreed' ? (d.fx_rate ?? '') : '',
    carryRate: v.meta?.carry_rate === 1,
  };
}

/** Converts the form into the API body. Throws a readable error for bad numbers. */
function toBody(s: EditorState, isReceipt: boolean, t: ReturnType<typeof useT>): DraftInput {
  const lines = s.lines
    .filter((l) => l.description.trim() || l.price.trim())
    .map((l, i) => {
      const quantityMilli = parseMilli(l.quantity);
      const unitPriceMinor = parseMinor(l.price);
      if (quantityMilli === null) throw new Error(t('documents.editor.lineQuantityError', { index: i + 1 }));
      if (unitPriceMinor === null) throw new Error(t('documents.editor.linePriceError', { index: i + 1 }));
      return {
        description: l.description,
        descriptionHe: l.descriptionHe || null,
        detail: l.detail || null,
        detailHe: l.detailHe || null,
        itemId: l.itemId,
        quantityMilli,
        unitPriceMinor,
      };
    });
  const payments = isReceipt
    ? s.payments.map((p, i) => {
        const amountMinor = parseMinor(p.amount);
        if (amountMinor === null) throw new Error(t('documents.editor.paymentAmountError', { index: i + 1 }));
        const digits = (v: string) => v.replace(/\D/g, '') || null;
        return {
          method: p.method,
          methodId: p.methodId,
          paidOn: p.paidOn,
          reference: p.reference || null,
          amountMinor,
          chequeCrossed: p.chequeCrossed,
          bankNumber: digits(p.bankNumber),
          branchNumber: digits(p.branchNumber),
          accountNumber: digits(p.accountNumber),
        };
      })
    : [];
  return {
    clientId: s.clientId,
    date: s.date,
    dueDate: s.dueDate || null,
    currency: s.currency,
    notes: s.notes || null,
    paymentInstructions: s.paymentInstructions || null,
    paymentMethodIds: s.paymentMethodIds,
    langVariant: s.langVariant,
    lines,
    payments,
    showIls: s.showIls,
    overrideRate: s.overrideRate || null,
    carryRate: s.carryRate,
  };
}

export function DocumentEditor({ type: fixedType }: { type?: string }) {
  const t = useT();
  const { locale } = usePreferences();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const editing = id !== undefined;
  /** R18 task 6: not-active clients are hidden from this picker by default, unless ticked. Every
   * client is loaded so the selected one (from ?client= or an existing draft) always shows and
   * its active flag is known; the filter is applied to the options below. */
  const [showInactiveClients, setShowInactiveClients] = useState(false);
  const clients = useLoad(() => clientsApi.list({ active: 'all' }), []);
  /** A document for a not-active client asks first: make the client active, or keep it not active. */
  const [inactivePrompt, setInactivePrompt] = useState<{ finalize: boolean } | null>(null);
  const [inactiveDecided, setInactiveDecided] = useState(false);
  const business = useLoad(() => fetchBusiness(), []);
  const paymentMethods = useLoad(() => paymentMethodsApi.list(true), []);
  const services = useLoad(() => servicesApi.list(true), []);
  const existing = useLoad(async () => (editing ? docsApi.get(Number(id)) : null), [id]);
  const [state, setState] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [ceilingCrossing, setCeilingCrossing] = useState<CeilingCrossingDetails | null>(null);
  const toast = useToast();

  const type = editing ? existing.data?.document.type : (fixedType ?? params.get('type') ?? '400');
  const isReceipt = type === '400';

  useEffect(() => {
    if (state) return;
    if (editing) {
      if (existing.data) setState(fromView(existing.data));
      return;
    }
    const today = todayLocal();
    const clientParam = params.get('client');
    setState({
      clientId: clientParam ? Number(clientParam) : null,
      date: today,
      dueDate: '',
      currency: 'ILS',
      notes: '',
      paymentInstructions: '',
      paymentMethodIds: [],
      langVariant: 'en',
      lines: [emptyLine()],
      payments: isReceipt ? [emptyPayment(today)] : [],
      showIls: false,
      overrideRate: '',
      carryRate: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, editing]);

  // A new document takes the client's currency and copy language.
  useEffect(() => {
    if (editing || !state?.clientId || !clients.data) return;
    const c = clients.data.clients.find((x) => x.id === state.clientId);
    if (c) setState((s) => (s ? { ...s, currency: c.currency, langVariant: c.client_copy_lang } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.clientId, clients.data]);

  // A new quote or payment request prefills payment instructions from the client's own field,
  // falling back to the business default; never overwrites text the person already typed.
  useEffect(() => {
    if (editing || !state || state.paymentInstructions) return;
    const c = state.clientId ? clients.data?.clients.find((x) => x.id === state.clientId) : null;
    const fallback = c?.payment_instructions || business.data?.business.payment_instructions || '';
    if (fallback) setState((s) => (s ? { ...s, paymentInstructions: fallback } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.clientId, clients.data, business.data]);

  // Same prefill rule for the payment methods multi-select (R17 task 2).
  useEffect(() => {
    if (editing || !state || state.paymentMethodIds.length > 0) return;
    const c = state.clientId ? clients.data?.clients.find((x) => x.id === state.clientId) : null;
    const parse = (raw: string | null | undefined): number[] => (raw ? (JSON.parse(raw) as number[]) : []);
    const fallback = parse(c?.payment_method_ids).length > 0 ? parse(c?.payment_method_ids) : parse(business.data?.business.payment_method_ids);
    if (fallback.length > 0) setState((s) => (s ? { ...s, paymentMethodIds: fallback } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.clientId, clients.data, business.data]);

  // Once the catalog loads, a receipt's still-unset payment rows default to its first active
  // method, so the dropdown's visible selection and the saved value always agree.
  useEffect(() => {
    if (editing || !state || !isReceipt) return;
    const first = paymentMethods.data?.paymentMethods[0]?.id;
    if (first === undefined) return;
    if (state.payments.every((p) => p.methodId !== null)) return;
    setState((s) => (s ? { ...s, payments: s.payments.map((p) => (p.methodId === null ? { ...p, methodId: first } : p)) } : s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethods.data, isReceipt]);

  if (!state || !type) return <>{existing.error ? <ErrorNote error={existing.error} /> : <Loading />}</>;
  const set = (patch: Partial<EditorState>) => setState({ ...state, ...patch });
  const locked = Boolean(existing.data?.source);
  const foreign = state.currency !== 'ILS';

  let total = 0;
  try {
    total = isReceipt
      ? state.payments.reduce((sum, p) => sum + (parseMinor(p.amount) ?? 0), 0)
      : state.lines.reduce((sum, l) => sum + lineTotal(parseMilli(l.quantity) ?? 0, parseMinor(l.price) ?? 0), 0);
  } catch {
    total = 0;
  }

  async function save(finalize: boolean, inactiveHandled = inactiveDecided) {
    const selected = state!.clientId ? clients.data?.clients.find((x) => x.id === state!.clientId) : undefined;
    if (!inactiveHandled && selected && selected.active === 0) {
      setInactivePrompt({ finalize });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = toBody(state!, isReceipt, t);
      const saved = editing ? await docsApi.update(Number(id), body) : await docsApi.create({ ...body, type });
      if (finalize) {
        try {
          await docsApi.finalize(saved.document.id, reason || undefined);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'backdate_reason_required') setNeedsReason(true);
          if (err instanceof ApiError && err.code === 'CEILING_CROSSING') setCeilingCrossing(err.details as CeilingCrossingDetails);
          if (!editing) navigate(`/income/documents/${saved.document.id}/edit`, { replace: true });
          throw err;
        }
      }
      navigate(`/income/documents/${saved.document.id}`);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  const clientList: Client[] = (clients.data?.clients ?? []).filter(
    (c) => c.active === 1 || showInactiveClients || editing || c.id === state.clientId,
  );
  const inactiveClient = state.clientId ? clients.data?.clients.find((x) => x.id === state.clientId) : undefined;

  async function resolveInactive(activate: boolean) {
    const pending = inactivePrompt;
    if (!pending || !inactiveClient) return;
    setInactivePrompt(null);
    if (activate) {
      try {
        await clientsApi.activate(inactiveClient.id);
        clients.setData(
          clients.data ? { clients: clients.data.clients.map((x) => (x.id === inactiveClient.id ? { ...x, active: 1 } : x)) } : clients.data,
        );
      } catch (err) {
        setError(errorText(err, t));
        return;
      }
    }
    setInactiveDecided(true);
    void save(pending.finalize, true);
  }
  const typeNameKey = TYPE_NAME_KEYS[type];
  const typeName = typeNameKey ? t(typeNameKey) : type.toLowerCase();
  const title = t(editing ? 'documents.editor.titleEdit' : 'documents.editor.titleNew', { typeName });

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <PageTitle>{title}</PageTitle>
      <DocTypeExplainer type={type} issued={false} />
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="block">
                <span className={label}>{t('documents.editor.clientLabel')}</span>
                <select
                  aria-label={t('documents.editor.clientLabel')}
                  className={input}
                  value={state.clientId ?? ''}
                  disabled={locked}
                  onChange={(e) => set({ clientId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">{t('documents.editor.pickClient')}</option>
                  {clientList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {clientName(c, locale)}
                    </option>
                  ))}
                </select>
              </label>
              {!editing && (
                <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={showInactiveClients} onChange={(e) => setShowInactiveClients(e.target.checked)} />
                  {t('documents.editor.showInactiveClients')}
                </label>
              )}
            </div>
            <label className="block">
              <span className={label}>{t('documents.editor.currencyLabel')}</span>
              <select
                aria-label={t('documents.editor.currencyLabel')}
                className={input}
                value={state.currency}
                disabled={locked}
                onChange={(e) => set({ currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{t('documents.editor.dateLabel')}</span>
              <input
                aria-label={t('documents.editor.dateLabel')}
                type="date"
                dir="ltr"
                className={input}
                value={state.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>
            {!isReceipt && (
              <label className="block">
                <span className={label}>{t('documents.editor.dueDateLabel')}</span>
                <input
                  aria-label={t('documents.editor.dueDateLabel')}
                  type="date"
                  dir="ltr"
                  className={input}
                  value={state.dueDate}
                  onChange={(e) => set({ dueDate: e.target.value })}
                />
              </label>
            )}
            <label className="block">
              <span className={label}>{t('documents.editor.clientCopyLabel')}</span>
              <select
                aria-label={t('documents.editor.clientCopyLabel')}
                className={input}
                value={state.langVariant}
                onChange={(e) => set({ langVariant: e.target.value as 'en' | 'bilingual' })}
              >
                <option value="en">{t('documents.editor.langEnglish')}</option>
                <option value="bilingual">{t('documents.editor.langBilingual')}</option>
              </select>
            </label>
          </div>
        </Card>

        <Card title={t('documents.editor.itemsTitle')}>
          <div className="space-y-3">
            {state.lines.map((l, i) => (
              <div key={i} className="space-y-1">
                {(services.data?.services.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t('documents.editor.serviceAriaLabel', { index: i + 1 })}
                      className={`${input} max-w-xs`}
                      value=""
                      onChange={(e) => {
                        const svc = services.data!.services.find((s) => s.id === Number(e.target.value));
                        if (!svc) return;
                        set({
                          lines: state.lines.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  description: svc.name_en,
                                  descriptionHe: svc.name_he ?? x.descriptionHe,
                                  detail: svc.description_en ?? '',
                                  detailHe: svc.description_he ?? '',
                                  quantity: formatMilli(svc.default_quantity_milli),
                                  price: formatMinor(svc.unit_price_minor).replace(/,/g, ''),
                                  itemId: svc.id,
                                }
                              : x,
                          ),
                        });
                      }}
                    >
                      <option value="">{t('documents.editor.fillFromServicePlaceholder')}</option>
                      {services.data!.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name_en} ({money(s.unit_price_minor, s.currency)})
                        </option>
                      ))}
                    </select>
                    {l.itemId === null && l.description.trim() && (
                      <button
                        type="button"
                        className="text-xs text-brand hover:underline"
                        onClick={async () => {
                          try {
                            await servicesApi.create({
                              nameEn: l.description,
                              nameHe: l.descriptionHe || null,
                              descriptionEn: l.detail || null,
                              descriptionHe: l.detailHe || null,
                              unitPriceMinor: parseMinor(l.price) ?? 0,
                              currency: state.currency,
                              defaultQuantityMilli: parseMilli(l.quantity) ?? 1000,
                            });
                            await services.reload();
                            toast.push(t('documents.editor.savedAsServiceNotice'));
                          } catch (err) {
                            toast.push(errorText(err, t), 'danger');
                          }
                        }}
                      >
                        {t('documents.editor.saveAsService')}
                      </button>
                    )}
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-[2fr_2fr_80px_120px_120px_auto]">
                <input
                  aria-label={t('documents.editor.descriptionAriaLabel', { index: i + 1 })}
                  placeholder={t('documents.editor.descriptionPlaceholder')}
                  className={input}
                  value={l.description}
                  onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
                />
                <input
                  aria-label={t('documents.editor.hebrewDescriptionAriaLabel', { index: i + 1 })}
                  placeholder={t('documents.editor.hebrewDescriptionPlaceholder')}
                  dir="rtl"
                  className={input}
                  value={l.descriptionHe}
                  onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, descriptionHe: e.target.value } : x)) })}
                />
                <input
                  aria-label={t('documents.editor.quantityAriaLabel', { index: i + 1 })}
                  inputMode="decimal"
                  className={input}
                  value={l.quantity}
                  onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })}
                />
                <input
                  aria-label={t('documents.editor.priceAriaLabel', { index: i + 1 })}
                  inputMode="decimal"
                  placeholder={t('documents.editor.amountPlaceholder')}
                  className={input}
                  value={l.price}
                  onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })}
                />
                <p className="ltr-nums self-center text-end text-sm tabular-nums">
                  {money(lineTotal(parseMilli(l.quantity) ?? 0, parseMinor(l.price) ?? 0), state.currency)}
                </p>
                <button type="button" className="text-sm text-danger" onClick={() => set({ lines: state.lines.filter((_, j) => j !== i) })}>
                  {t('documents.editor.remove')}
                </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    aria-label={t('documents.editor.detailAriaLabel', { index: i + 1 })}
                    placeholder={t('documents.editor.detailPlaceholder')}
                    className={input}
                    value={l.detail}
                    onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })}
                  />
                  <input
                    aria-label={t('documents.editor.hebrewDetailAriaLabel', { index: i + 1 })}
                    placeholder={t('documents.editor.hebrewDetailPlaceholder')}
                    dir="rtl"
                    className={input}
                    value={l.detailHe}
                    onChange={(e) => set({ lines: state.lines.map((x, j) => (j === i ? { ...x, detailHe: e.target.value } : x)) })}
                  />
                </div>
              </div>
            ))}
            <button type="button" className={btnSecondary} onClick={() => set({ lines: [...state.lines, emptyLine()] })}>
              {t('documents.editor.addLine')}
            </button>
          </div>
        </Card>

        {isReceipt && (
          <Card title={t('documents.editor.paymentsTitle')}>
            <div className="space-y-3">
              {state.payments.map((p, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[160px_150px_1fr_130px_auto_auto]">
                  {(paymentMethods.data?.paymentMethods.length ?? 0) > 0 ? (
                    <select
                      aria-label={t('documents.editor.methodAriaLabel', { index: i + 1 })}
                      className={input}
                      value={p.methodId ?? ''}
                      onChange={(e) =>
                        set({ payments: state.payments.map((x, j) => (j === i ? { ...x, methodId: e.target.value ? Number(e.target.value) : null } : x)) })
                      }
                    >
                      {paymentMethods.data!.paymentMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      aria-label={t('documents.editor.methodAriaLabel', { index: i + 1 })}
                      className={input}
                      value={p.method}
                      onChange={(e) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)) })}
                    >
                      {Object.entries(METHOD_LABEL_KEYS).map(([k, messageKey]) => (
                        <option key={k} value={k}>
                          {t(messageKey)}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    aria-label={t('documents.editor.paidOnAriaLabel', { index: i + 1 })}
                    type="date"
                    dir="ltr"
                    className={input}
                    value={p.paidOn}
                    onChange={(e) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, paidOn: e.target.value } : x)) })}
                  />
                  <input
                    aria-label={t('documents.editor.referenceAriaLabel', { index: i + 1 })}
                    placeholder={t('documents.editor.referencePlaceholder')}
                    className={input}
                    value={p.reference}
                    onChange={(e) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)) })}
                  />
                  <input
                    aria-label={t('documents.editor.amountAriaLabel', { index: i + 1 })}
                    inputMode="decimal"
                    placeholder={t('documents.editor.amountPlaceholder')}
                    className={input}
                    value={p.amount}
                    onChange={(e) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })}
                  />
                  {isChequeMethod(p, paymentMethods.data?.paymentMethods ?? []) ? (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={p.chequeCrossed}
                        onChange={(e) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, chequeCrossed: e.target.checked } : x)) })}
                      />{' '}
                      {t('documents.editor.crossedLabel')}
                    </label>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="text-sm text-danger" onClick={() => set({ payments: state.payments.filter((_, j) => j !== i) })}>
                    {t('documents.editor.remove')}
                  </button>
                  {isChequeMethod(p, paymentMethods.data?.paymentMethods ?? []) && (
                    <ChequeBankFields
                      index={i + 1}
                      value={p}
                      onChange={(patch) => set({ payments: state.payments.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                    />
                  )}
                </div>
              ))}
              <button
                type="button"
                className={btnSecondary}
                onClick={() => set({ payments: [...state.payments, emptyPayment(state.date, paymentMethods.data?.paymentMethods[0]?.id ?? null)] })}
              >
                {t('documents.editor.addPayment')}
              </button>
            </div>
          </Card>
        )}

        {!isReceipt && foreign && (
          <Card title={t('documents.editor.exchangeRateTitle')}>
            <div className="flex flex-wrap items-end gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={state.showIls} onChange={(e) => set({ showIls: e.target.checked })} /> {t('documents.editor.showIlsLabel')}
              </label>
              <label className="block">
                <span className={label}>{t('documents.editor.agreedRateLabel')}</span>
                <input
                  aria-label={t('documents.editor.agreedRateLabel')}
                  inputMode="decimal"
                  placeholder={t('documents.editor.agreedRatePlaceholder')}
                  className={input}
                  value={state.overrideRate}
                  onChange={(e) => set({ overrideRate: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={state.carryRate} onChange={(e) => set({ carryRate: e.target.checked })} /> {t('documents.editor.carryRateLabel')}
              </label>
            </div>
          </Card>
        )}

        <Card>
          <label className="block">
            <span className={label}>{t('documents.editor.notesLabel')}</span>
            <textarea aria-label={t('documents.editor.notesLabel')} className={input} rows={3} value={state.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          {['QT', 'PR', 'PF', '300', '332'].includes(type) && (
            <div className="mt-4">
              <span className={label}>{t('documents.editor.paymentMethodsLabel')}</span>
              {(paymentMethods.data?.paymentMethods.length ?? 0) === 0 ? (
                <p className="text-xs text-muted">{t('documents.editor.paymentMethodsEmpty')}</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-3">
                  {paymentMethods.data!.paymentMethods.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={state.paymentMethodIds.includes(m.id)}
                        onChange={(e) =>
                          set({
                            paymentMethodIds: e.target.checked ? [...state.paymentMethodIds, m.id] : state.paymentMethodIds.filter((x) => x !== m.id),
                          })
                        }
                      />
                      {m.display_name}
                    </label>
                  ))}
                </div>
              )}
              <span className="mt-1 block text-xs text-muted">{t('documents.editor.paymentMethodsHint')}</span>
              <label className="mt-3 block">
                <span className={label}>{t('documents.editor.noteLabel')}</span>
                <textarea
                  aria-label={t('documents.editor.noteLabel')}
                  className={input}
                  rows={2}
                  value={state.paymentInstructions}
                  onChange={(e) => set({ paymentInstructions: e.target.value })}
                />
                <span className="mt-1 block text-xs text-muted">{t('documents.editor.noteHint')}</span>
              </label>
            </div>
          )}
          <p className="ltr-nums mt-4 text-end text-lg font-semibold tabular-nums">
            {t('documents.editor.totalLabel')} <span data-testid="editor-total">{money(total, state.currency)}</span>
          </p>
          {needsReason && (
            <label className="mt-4 block">
              <span className={label}>{t('documents.editor.backdateReasonLabel')}</span>
              <input aria-label={t('documents.editor.backdateReasonLabel')} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          <ErrorNote error={error} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className={btnSecondary} disabled={busy}>
              {t('documents.editor.saveDraft')}
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save(true)}>
              {t('documents.editor.saveAndFinalize')}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">{t('documents.editor.finalizeHint')}</p>
        </Card>
      </form>
      <Dialog
        open={inactivePrompt !== null}
        title={t('documents.editor.inactiveClient.title')}
        onClose={() => setInactivePrompt(null)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setInactivePrompt(null)}>
              {t('documents.editor.inactiveClient.cancel')}
            </button>
            <button type="button" className={btnSecondary} onClick={() => void resolveInactive(false)}>
              {t('documents.editor.inactiveClient.keep')}
            </button>
            <button type="button" className={btnPrimary} onClick={() => void resolveInactive(true)}>
              {t('documents.editor.inactiveClient.activate')}
            </button>
          </>
        }
      >
        <p className="text-sm">{t('documents.editor.inactiveClient.body', { name: inactiveClient ? clientName(inactiveClient, locale) : '' })}</p>
      </Dialog>
      {ceilingCrossing && (
        <CeilingCrossingDialog
          details={ceilingCrossing}
          onClose={() => setCeilingCrossing(null)}
          onRetry={() => {
            setCeilingCrossing(null);
            void save(true, true);
          }}
        />
      )}
    </section>
  );
}
