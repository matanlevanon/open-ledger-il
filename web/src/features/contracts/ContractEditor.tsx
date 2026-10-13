import { announceDemoSend } from '../../app/demo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { fetchMe } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { formatMinor } from '../../lib/money';
import { btnPrimary, btnSecondary, Card, ErrorNote, errorText, input, label, Loading, PageTitle, useLoad } from '../documents/ui';
import {
  type ChoiceValue,
  type ContractInput,
  type ContractLanguage,
  contractsApi,
  fetchPreview,
  type FieldDef,
  type Money,
  type ScopeEntry,
  type SendResult,
  type Service,
} from './api';

const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

/** "1,234.5" to 123450 without floats. Empty or not a number reads as null. */
export function toMinor(text: string): number | null {
  const m = /^\s*(\d[\d,]*)(?:\.(\d{0,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const labelOf = (f: { labelEn: string; labelHe: string; key: string }, locale: 'en' | 'he') => (locale === 'he' ? f.labelHe || f.labelEn : f.labelEn || f.labelHe) || f.key;

/** The scope value as stored (names copied in) back to what the editor sends. */
function toScopeEntries(v: unknown): ScopeEntry[] {
  const services = (v as { services?: unknown[] } | null)?.services ?? [];
  return services.map((raw) => {
    const s = raw as { serviceId: number; itemIds?: number[]; items?: { itemId: number }[]; other?: string | null; note?: string | null; fee?: Money | null };
    return { serviceId: s.serviceId, itemIds: s.itemIds ?? (s.items ?? []).map((i) => i.itemId), other: s.other ?? null, note: s.note ?? null, fee: s.fee ?? null };
  });
}

function MoneyInput({ value, onChange, ariaLabel }: { value: Money | null; onChange: (v: Money | null) => void; ariaLabel: string }) {
  const t = useT();
  const [text, setText] = useState(value ? formatMinor(value.amountMinor).replace(/,/g, '') : '');
  const currency = value?.currency ?? 'ILS';
  return (
    <div className="flex gap-2">
      <input
        aria-label={`${ariaLabel}: ${t('contracts.editor.amount')}`}
        className={`${input} ltr-nums`}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const minor = toMinor(e.target.value);
          onChange(minor === null ? null : { amountMinor: minor, currency });
        }}
      />
      <select
        aria-label={`${ariaLabel}: ${t('contracts.editor.currency')}`}
        className={`${input} w-28`}
        value={currency}
        onChange={(e) => {
          const minor = toMinor(text);
          onChange(minor === null ? null : { amountMinor: minor, currency: e.target.value });
        }}
      >
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}

function ChoiceInput({ field, value, onChange, locale }: { field: FieldDef; value: ChoiceValue | null; onChange: (v: ChoiceValue) => void; locale: 'en' | 'he' }) {
  const t = useT();
  const v: ChoiceValue = value ?? { selected: [] };
  const picked = (opt: string) => v.selected.find((s) => s.value === opt);
  const toggle = (opt: string, on: boolean) => {
    const rest = field.multiple ? v.selected.filter((s) => s.value !== opt) : [];
    onChange({ ...v, selected: on ? [...rest, { value: opt, text: picked(opt)?.text ?? '' }] : rest });
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={label}>{labelOf(field, locale)}</legend>
      {field.options.map((o) => (
        <div key={o.value} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type={field.multiple ? 'checkbox' : 'radio'} name={field.key} checked={Boolean(picked(o.value))} onChange={(e) => toggle(o.value, e.target.checked)} />
            <bdi>{labelOf({ ...o, key: o.value }, locale)}</bdi>
          </label>
          {o.freeText && picked(o.value) && (
            <input
              aria-label={labelOf({ ...o, key: o.value }, locale)}
              className={`${input} max-w-[14rem]`}
              value={picked(o.value)?.text ?? ''}
              onChange={(e) => onChange({ ...v, selected: v.selected.map((s) => (s.value === o.value ? { ...s, text: e.target.value } : s)) })}
            />
          )}
        </div>
      ))}
      {field.allowOther && (
        <input aria-label={t('contracts.editor.other')} placeholder={t('contracts.editor.other')} className={input} value={v.other ?? ''} onChange={(e) => onChange({ ...v, other: e.target.value })} />
      )}
    </fieldset>
  );
}

function ScopePicker({ field, services, value, onChange, locale }: { field: FieldDef; services: Service[]; value: ScopeEntry[]; onChange: (v: ScopeEntry[]) => void; locale: 'en' | 'he' }) {
  const t = useT();
  const entry = (id: number) => value.find((e) => e.serviceId === id);
  const patch = (id: number, p: Partial<ScopeEntry>) => onChange(value.map((e) => (e.serviceId === id ? { ...e, ...p } : e)));
  const name = (s: Service) => (locale === 'he' ? s.nameHe || s.nameEn : s.nameEn || s.nameHe);
  return (
    <fieldset className="flex flex-col gap-2" data-testid="scope-picker">
      <legend className={label}>{labelOf(field, locale)}</legend>
      {services.map((s) => {
        const e = entry(s.id);
        return (
          <div key={s.id} className="rounded-md border border-line p-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={Boolean(e)}
                onChange={(ev) => onChange(ev.target.checked ? [...value, { serviceId: s.id, itemIds: [], other: null, note: null, fee: null }] : value.filter((x) => x.serviceId !== s.id))}
              />
              <bdi>{name(s)}</bdi>
              <span className="font-normal text-muted">· {locale === 'he' ? s.modelLabelHe : s.modelLabelEn}</span>
            </label>
            {e && (
              <div className="mt-2 flex flex-col gap-1.5 ps-6">
                {s.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={e.itemIds.includes(it.id)}
                      onChange={(ev) => patch(s.id, { itemIds: ev.target.checked ? [...e.itemIds, it.id] : e.itemIds.filter((x) => x !== it.id) })}
                    />
                    <bdi>{locale === 'he' ? it.labelHe || it.labelEn : it.labelEn || it.labelHe}</bdi>
                  </label>
                ))}
                <input aria-label={`${name(s)}: ${t('contracts.editor.other')}`} placeholder={t('contracts.editor.other')} className={input} value={e.other ?? ''} onChange={(ev) => patch(s.id, { other: ev.target.value })} />
                <input aria-label={`${name(s)}: ${t('contracts.editor.note')}`} placeholder={t('contracts.editor.note')} className={input} value={e.note ?? ''} onChange={(ev) => patch(s.id, { note: ev.target.value })} />
                <span className="text-xs text-muted">{t('contracts.editor.fee')}</span>
                <MoneyInput ariaLabel={`${name(s)}: ${t('contracts.editor.fee')}`} value={e.fee ?? null} onChange={(fee) => patch(s.id, { fee })} />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

function FieldInput({ field, value, setValue, services, locale }: { field: FieldDef; value: unknown; setValue: (v: unknown) => void; services: Service[]; locale: 'en' | 'he' }) {
  const t = useT();
  const text = typeof value === 'string' ? value : '';
  const title =
    field.kind === 'client' ? t('contracts.editor.fromClient', { label: labelOf(field, locale) }) : field.kind === 'business' ? t('contracts.editor.fromBusiness', { label: labelOf(field, locale) }) : labelOf(field, locale);
  if (field.kind === 'choice' && field.binding === 'services') return <ScopePicker field={field} services={services} value={toScopeEntries(value)} onChange={(v) => setValue({ services: v })} locale={locale} />;
  if (field.kind === 'choice') return <ChoiceInput field={field} value={(value as ChoiceValue) ?? null} onChange={setValue} locale={locale} />;
  if (field.inputType === 'money') {
    return (
      <div>
        <span className={label}>{title}</span>
        <MoneyInput ariaLabel={title} value={(value as Money) ?? null} onChange={setValue} />
      </div>
    );
  }
  return (
    <label className="block">
      <span className={label}>
        {title}
        {field.required && <span className="ms-0.5 text-danger">*</span>}
      </span>
      {field.inputType === 'multiline' ? (
        <textarea className={input} rows={3} dir="auto" value={text} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <input className={input} dir="auto" type={field.inputType === 'date' ? 'date' : 'text'} inputMode={field.inputType === 'number' ? 'decimal' : undefined} value={text} onChange={(e) => setValue(e.target.value)} />
      )}
    </label>
  );
}

const OWNER_KINDS = ['client', 'business', 'owner_input', 'choice'];

/** True when a field you fill on this screen has no value yet: the same test the server's "Fill these fields first" makes. */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.services)) return o.services.length === 0;
    if (Array.isArray(o.selected)) return o.selected.length === 0 && !(typeof o.other === 'string' && o.other.trim());
    if ('amount' in o) return o.amount === null || o.amount === undefined || String(o.amount).trim() === '';
  }
  return false;
}

/** R25b: the template a first engagement includes. "Standard Terms" first, else the first contract template. */
export function defaultTermsTemplate(templates: { id: number; name: string; kind: string }[]): number | null {
  const contracts = templates.filter((x) => x.kind === 'contract');
  return (contracts.find((x) => x.name.trim().toLowerCase() === 'standard terms') ?? contracts[0])?.id ?? null;
}

/** R25, Screen B: pick a template, check the fields, preview, send. */
export function ContractEditor() {
  const t = useT();
  const { locale } = usePreferences();
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const clientFromQuery = Number(new URLSearchParams(useLocation().search).get('clientId'));
  const me = useLoad(() => fetchMe(), []);
  const templates = useLoad(() => contractsApi.templates(), []);
  const services = useLoad(() => contractsApi.services(), []);
  const existing = useLoad(() => (editId ? contractsApi.get(editId) : Promise.resolve(null)), [editId]);

  const [clientId, setClientId] = useState<number>(clientFromQuery);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [includeTerms, setIncludeTerms] = useState(false);
  const [termsId, setTermsId] = useState<number | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<ContractLanguage>('en');
  const [signer, setSigner] = useState({ name: '', email: '', phone: '' });
  const [linkDays, setLinkDays] = useState<7 | 14 | 30>(14);
  const [ownerSign, setOwnerSign] = useState(false);
  // After a send or save that failed, empty required fields show in red until they are filled.
  const [showMissing, setShowMissing] = useState(false);
  const [ownerSignature, setOwnerSignature] = useState(false);
  const [emailReady, setEmailReady] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [savedId, setSavedId] = useState<number | null>(editId);
  const loadedFor = useRef<string>('');

  const active = useMemo(() => (templates.data?.templates ?? []).filter((x) => x.active), [templates.data]);
  const termsTemplates = useMemo(() => active.filter((x) => x.kind === 'contract'), [active]);
  const isWorkOrder = active.find((x) => x.id === templateId)?.kind === 'work_order';
  const includeId = isWorkOrder && includeTerms ? termsId : null;
  const loadedTemplate = useRef<number | null>(null);

  // The picker starts on the Standard Terms.
  useEffect(() => {
    if (termsId === null) setTermsId(defaultTermsTemplate(active));
  }, [active, termsId]);

  // An existing draft: its values, signer and settings.
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const c = d.contract;
    setClientId(c.clientId);
    setTemplateId(c.templateId);
    setIncludeTerms(Boolean(c.includedTemplate));
    if (c.includedTemplate) setTermsId(c.includedTemplate.id);
    setFields(d.currentFields);
    setValues(c.values as Record<string, unknown>);
    setTitle(c.title);
    setLanguage(c.language);
    setSigner({ name: c.signer.name ?? '', email: c.signer.email ?? '', phone: c.signer.phone ?? '' });
    setLinkDays(c.linkDays as 7 | 14 | 30);
    setOwnerSign(c.ownerSign);
    setOwnerSignature(d.ownerSignature);
    setEmailReady(d.emailReady);
    loadedFor.current = `${c.clientId}:${c.templateId}:${c.includedTemplate?.id ?? 0}`;
    loadedTemplate.current = c.templateId;
  }, [existing.data]);

  // A new contract starts on the first template.
  useEffect(() => {
    if (!editId && templateId === null && active.length > 0) setTemplateId(active[0]!.id);
  }, [editId, templateId, active]);

  // Picking a template loads its fields and every value the Ledger knows. Ticking the Standard
  // Terms adds their fields and keeps what the owner already typed.
  useEffect(() => {
    if (!templateId || !clientId) return;
    const key = `${clientId}:${templateId}:${includeId ?? 0}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const sameTemplate = loadedTemplate.current === templateId;
    loadedTemplate.current = templateId;
    contractsApi
      .defaults(clientId, templateId, includeId)
      .then((d) => {
        setFields(d.fields);
        if (sameTemplate) {
          setValues((prev) => ({ ...(d.values as Record<string, unknown>), ...prev }));
          return;
        }
        setValues(d.values as Record<string, unknown>);
        setTitle(d.title);
        if (!editId) setSigner(d.signer);
        setOwnerSignature(d.ownerSignature);
        setOwnerSign(d.ownerSignature);
        setEmailReady(d.emailReady);
      })
      .catch((e: unknown) => setError(errorText(e, t)));
  }, [templateId, clientId, includeId, editId, t]);

  const body: ContractInput | null = templateId
    ? { clientId, templateId, includeTemplateId: includeId, title, language, values, signer, linkDays, ownerSign }
    : null;
  const bodyKey = JSON.stringify(body);

  // The preview follows every keystroke, half a second behind.
  useEffect(() => {
    if (!body || fields.length === 0) return;
    const timer = setTimeout(() => {
      fetchPreview(body)
        .then(setPreview)
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, fields.length]);

  if (!templates.data || !services.data || (editId && !existing.data)) return templates.error || existing.error ? <ErrorNote error={templates.error ?? existing.error} /> : <Loading />;

  const ownerName = me.data?.name || me.data?.email || '';
  const isOwner = me.data?.role === 'owner';
  const signerFields = fields.filter((f) => f.kind === 'signer_input');

  async function save(): Promise<number | null> {
    if (!body) return null;
    setError(null);
    try {
      if (savedId) {
        await contractsApi.update(savedId, body);
        return savedId;
      }
      const res = await contractsApi.create(body);
      setSavedId(res.contract.id);
      window.history.replaceState(null, '', `/contracts/${res.contract.id}/edit`);
      return res.contract.id;
    } catch (e) {
      setError(errorText(e, t));
      return null;
    }
  }

  async function onSave() {
    setBusy(true);
    const id = await save();
    if (id) setNote(t('contracts.editor.saved'));
    setBusy(false);
  }

  function markMissing() {
    setShowMissing(true);
    requestAnimationFrame(() => document.querySelector('[data-missing="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  async function onSend() {
    setBusy(true);
    setNote(null);
    const id = await save();
    if (id) {
      try {
        setSent(await contractsApi.send(id, emailReady ? 'email' : 'link'));
        announceDemoSend();
      } catch (e) {
        setError(errorText(e, t));
        markMissing();
      }
    }
    setBusy(false);
  }

  if (sent && savedId) {
    return (
      <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
        <PageTitle>{t('contracts.sent.title')}</PageTitle>
        <Card>
          {sent.emailed && <p className="text-sm">{t('contracts.sent.emailed', { email: signer.email })}</p>}
          <p className="mt-2 break-all text-sm text-muted ltr-nums">{sent.url}</p>
          <p className="mt-1 text-sm text-muted">{t('contracts.detail.expires', { date: sent.expiresAt.slice(0, 10) })}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => void navigator.clipboard?.writeText(sent.url).then(() => setNote(t('contracts.sent.copied')))}>
              {t('contracts.sent.copy')}
            </button>
            <a className={btnSecondary} href={sent.whatsappUrl} target="_blank" rel="noreferrer">
              {t('contracts.sent.whatsapp')}
            </a>
            <Link className={btnPrimary} to={`/contracts/${savedId}`}>
              {t('contracts.open')}
            </Link>
          </div>
          {note && (
            <p role="status" className="mt-2 text-sm text-muted">
              {note}
            </p>
          )}
        </Card>
      </section>
    );
  }

  const setValue = (key: string) => (v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-6xl">
      <PageTitle subtitle={t('contracts.editor.sub')}>{editId ? t('contracts.editor.titleEdit') : t('contracts.editor.titleNew')}</PageTitle>
      <ErrorNote error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className={label}>{t('contracts.editor.template')}</span>
              <select
                className={input}
                value={templateId ?? ''}
                disabled={Boolean(editId)}
                onChange={(e) => {
                  loadedFor.current = '';
                  setTemplateId(Number(e.target.value));
                }}
              >
                {!templateId && <option value="">{t('contracts.editor.pickTemplate')}</option>}
                {active.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>
            {isWorkOrder && termsTemplates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-testid="include-terms">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeTerms} onChange={(e) => setIncludeTerms(e.target.checked)} />
                  {t('contracts.editor.includeTerms')}
                </label>
                <select
                  aria-label={t('contracts.editor.termsTemplate')}
                  className={`${input} w-auto min-w-[12rem] flex-1`}
                  value={termsId ?? ''}
                  disabled={!includeTerms}
                  onChange={(e) => setTermsId(Number(e.target.value))}
                >
                  {termsTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="block">
              <span className={label}>{t('contracts.editor.language')}</span>
              <select className={input} value={language} onChange={(e) => setLanguage(e.target.value as ContractLanguage)}>
                <option value="both">{t('contracts.editor.lang.both')}</option>
                <option value="en">{t('contracts.editor.lang.en')}</option>
                <option value="he">{t('contracts.editor.lang.he')}</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>{t('contracts.editor.name')}</span>
              <input className={input} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {fields
              .filter((f) => OWNER_KINDS.includes(f.kind) || f.role === 'terms_date')
              .map((f) =>
                OWNER_KINDS.includes(f.kind) ? (
                  <div
                    key={f.key}
                    data-missing={showMissing && f.required && isEmptyValue(values[f.key]) ? 'true' : undefined}
                    className={showMissing && f.required && isEmptyValue(values[f.key]) ? 'rounded-md p-1 ring-2 ring-danger' : undefined}
                  >
                    <FieldInput field={f} value={values[f.key]} setValue={setValue(f.key)} services={services.data!.services} locale={locale} />
                  </div>
                ) : (
                  <div key={f.key}>
                    <span className={label}>{labelOf(f, locale)}</span>
                    <p className="text-sm text-muted">{t('contracts.editor.termsDateFilled')}</p>
                  </div>
                ),
              )}
            <fieldset className="flex flex-col gap-2">
              <legend className={label}>{t('contracts.editor.signer')}</legend>
              <input aria-label={t('contracts.editor.signerName')} placeholder={t('contracts.editor.signerName')} className={input} dir="auto" value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} />
              <input aria-label={t('contracts.editor.signerEmail')} placeholder={t('contracts.editor.signerEmail')} className={input} type="email" value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} />
              <input aria-label={t('contracts.editor.signerPhone')} placeholder={t('contracts.editor.signerPhone')} className={input} type="tel" value={signer.phone} onChange={(e) => setSigner({ ...signer, phone: e.target.value })} />
            </fieldset>
            {signerFields.length > 0 && <p className="text-xs text-muted">{t('contracts.editor.signerFills', { list: signerFields.map((f) => labelOf(f, locale)).join(', ') })}</p>}
            <label className="block">
              <span className={label}>{t('contracts.editor.linkDays')}</span>
              <select className={input} value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value) as 7 | 14 | 30)}>
                {[7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    {t('contracts.editor.days', { n })}
                  </option>
                ))}
              </select>
            </label>
            {isOwner &&
              (ownerSignature ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={ownerSign} onChange={(e) => setOwnerSign(e.target.checked)} />
                  {t('contracts.editor.ownerSign', { name: ownerName })}
                </label>
              ) : (
                <p className="text-xs text-muted">{t('contracts.editor.noSignature')}</p>
              ))}
          </div>
        </Card>
        <Card title={t('contracts.editor.preview')}>
          <iframe title={t('contracts.editor.preview')} data-testid="contract-preview" className="h-[640px] w-full rounded-md border border-line bg-white" srcDoc={preview} sandbox="" />
          <p className="mt-2 text-xs text-muted">{t('contracts.editor.previewNote')}</p>
        </Card>
      </div>
      {/* The same notice as at the top, next to the buttons that raised it. */}
      <div className="mt-4">
        <ErrorNote error={error} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">{t(emailReady ? 'contracts.editor.sendNote' : 'contracts.editor.sendNoteNoEmail', { n: linkDays })}</span>
        <div className="flex gap-2">
          {note && (
            <span role="status" className="self-center text-sm text-muted">
              {note}
            </span>
          )}
          <button type="button" className={btnSecondary} disabled={busy || !body} onClick={() => void onSave()}>
            {t('contracts.editor.saveDraft')}
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !body} onClick={() => void onSend()}>
            {emailReady ? t('contracts.editor.send') : t('contracts.editor.makeLink')}
          </button>
        </div>
      </div>
    </section>
  );
}
