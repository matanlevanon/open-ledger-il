import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useIssuing } from '../../app/issuing';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { type MessageKey, useT } from '../../i18n';
import { type Client, type ClientConsent, type ConsentFormInput, clientsApi, docsApi } from './api';
import { DocumentTable } from './DocumentList';
import { TYPE_NAME_KEYS } from './Editor';
import { CURRENCIES, newDocumentPath, offeredDocumentTypes, totalsText } from './format';
import { LedgerView } from './Ledger';
import { Card, ErrorNote, Loading, PageTitle, btnPrimary, btnSecondary, errorText, input, label, useLoad } from './ui';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const CONSENT_SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  signed_contract: 'clients.consentSource.signedContract',
  other: 'clients.consentSource.other',
};
const CONSENT_STATUS_LABEL_KEYS: Record<ClientConsent['status'], MessageKey> = {
  none: 'clients.consentStatus.none',
  requested: 'clients.consentStatus.requested',
  granted: 'clients.consentStatus.granted',
  revoked: 'clients.consentStatus.revoked',
};

/**
 * R18 task 8: the client page showed the raw method key, e.g. "Consented on 2026-09-25
 * (email_link)". A translated label instead: "by email link", "manually, signed contract",
 * "manually, other". null for a method this page has no label for (for example a revoke's
 * "owner"), so nothing prints rather than a raw key leaking through again.
 */
function consentMethodLabelKey(method: string | null, source: string | null): MessageKey | null {
  if (method === 'email_link') return 'clients.page.consentMethod.emailLink';
  if (method === 'manual') return source === 'signed_contract' ? 'clients.page.consentMethod.manualSignedContract' : 'clients.page.consentMethod.manualOther';
  return null;
}

export function ClientsArea() {
  return (
    <Routes>
      <Route index element={<ClientList />} />
      <Route path="new" element={<ClientForm />} />
      <Route path=":id/edit" element={<ClientForm />} />
      <Route path=":id" element={<ClientPage />} />
    </Routes>
  );
}

export function ClientList() {
  const t = useT();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const { data, error } = useLoad(() => clientsApi.list({ q, active: showInactive ? 'all' : '1' }), [q, showInactive]);

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <PageTitle
        actions={
          <Link to="/clients/new" className={btnPrimary}>
            {t('clients.list.newClient')}
          </Link>
        }
      >
        {t('clients.list.title')}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label={t('clients.list.searchAriaLabel')}
          placeholder={t('clients.list.searchPlaceholder')}
          className={`${input} max-w-sm`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {t('clients.list.showInactive')}
        </label>
      </div>
      <ErrorNote error={error} />
      {!data ? (
        !error && <Loading />
      ) : data.clients.length === 0 ? (
        <Card>
          <p className="text-muted">{t('clients.list.noClientsYet')}</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-band text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">{t('clients.list.colName')}</th>
                <th className="px-4 py-2">{t('clients.list.colCountry')}</th>
                <th className="px-4 py-2">{t('clients.list.colCurrency')}</th>
                <th className="px-4 py-2 text-end">{t('clients.list.colBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    {c.name_en && (
                      <Link to={`/clients/${c.id}`} className="font-semibold text-brand hover:underline">
                        {c.name_en}
                      </Link>
                    )}
                    {c.name_he && (
                      // The gap sits on the outer link: margin on the rtl <bdi> itself lands on its far side.
                      // Only when an English name renders first; a Hebrew-only client gets no leading gap.
                      <Link to={`/clients/${c.id}`} className={`font-semibold text-brand hover:underline ${c.name_en ? 'ms-8' : ''}`}>
                        <bdi dir="rtl">{c.name_he}</bdi>
                      </Link>
                    )}
                    {c.active !== 1 && <span className="ms-3 text-xs text-muted">{t('clients.notActiveBadge')}</span>}
                  </td>
                  <td className="px-4 py-2">{c.country}</td>
                  <td className="px-4 py-2">{c.currency}</td>
                  <td className="ltr-nums px-4 py-2 text-end tabular-nums">
                    {totalsText(c.balances ?? {})}
                    {c.overdue && Object.keys(c.overdue).length > 0 && (
                      <span className="block text-xs text-danger">
                        {t('clients.list.overduePrefix')} {totalsText(c.overdue)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type ClientFields = {
  nameEn: string;
  nameHe: string;
  companyId: string;
  vatNumber: string;
  country: string;
  foreignResident: boolean;
  currency: string;
  clientCopyLang: 'en' | 'bilingual';
  email: string;
  ccEmails: string;
  phone: string;
  addressEn: string;
  city: string;
  postalCode: string;
  notes: string;
  paymentInstructions: string;
};

function fieldsFrom(c?: Client): ClientFields {
  return {
    nameEn: c?.name_en ?? '',
    nameHe: c?.name_he ?? '',
    companyId: c?.company_id ?? '',
    vatNumber: c?.vat_number ?? '',
    country: c?.country ?? 'IL',
    foreignResident: c?.foreign_resident === 1,
    currency: c?.currency ?? 'ILS',
    clientCopyLang: c?.client_copy_lang ?? 'en',
    email: c?.email ?? '',
    ccEmails: c?.cc_emails ?? '',
    phone: c?.phone ?? '',
    addressEn: c?.address_en || c?.address_he || '',
    city: c?.city ?? '',
    postalCode: c?.postal_code ?? '',
    notes: c?.notes ?? '',
    paymentInstructions: c?.payment_instructions ?? '',
  };
}

type ConsentFields = { granted: boolean; source: 'signed_contract' | 'other'; date: string; note: string };

function consentFieldsFrom(consent?: ClientConsent): ConsentFields {
  return {
    granted: consent?.status === 'granted',
    source: consent?.source === 'other' ? 'other' : 'signed_contract',
    date: consent?.at ? consent.at.slice(0, 10) : todayDate(),
    note: '',
  };
}

export function ClientForm() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;
  const loaded = useLoad(async () => (editing ? clientsApi.get(Number(id)) : null), [id]);
  const [fields, setFields] = useState<ClientFields | null>(null);
  const [consent, setConsent] = useState<ConsentFields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** R19 part 2: until the copy language is picked by hand, a new Hebrew-only client defaults to bilingual. */
  const [copyLangTouched, setCopyLangTouched] = useState(false);

  const current = fields ?? (editing ? (loaded.data ? fieldsFrom(loaded.data.client) : null) : fieldsFrom());
  const currentConsent = consent ?? (editing ? (loaded.data ? consentFieldsFrom(loaded.data.consent) : null) : consentFieldsFrom());
  if (!current || !currentConsent) return <Loading />;
  const set = <K extends keyof ClientFields>(key: K, value: ClientFields[K]) => {
    const next = { ...current, [key]: value };
    if (!editing && !copyLangTouched && (key === 'nameEn' || key === 'nameHe')) {
      next.clientCopyLang = !next.nameEn.trim() && next.nameHe.trim() ? 'bilingual' : 'en';
    }
    setFields(next);
  };
  const setConsentField = <K extends keyof ConsentFields>(key: K, value: ConsentFields[K]) => setConsent({ ...currentConsent, [key]: value });

  const wasGranted = editing ? loaded.data?.consent.status === 'granted' : false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...current! };
      // Only write a consent row when the checkbox actually changed the granted state, so
      // an unrelated edit does not add a redundant entry to the consent history.
      if (currentConsent!.granted !== wasGranted) {
        const c = currentConsent!;
        const consentBody: ConsentFormInput = { granted: c.granted, source: c.source, date: c.date, note: c.note || null };
        body.consent = consentBody;
      }
      const saved = editing ? await clientsApi.update(Number(id), body) : await clientsApi.create(body);
      navigate(`/clients/${saved.client.id}`);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }

  const text = (key: keyof ClientFields, titleKey: MessageKey, extra: Record<string, unknown> = {}) => (
    <label className="block">
      <span className={label}>{t(titleKey)}</span>
      <input className={input} value={current[key] as string} onChange={(e) => set(key, e.target.value as never)} {...extra} />
    </label>
  );

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <PageTitle>{t(editing ? 'clients.form.titleEdit' : 'clients.form.titleNew')}</PageTitle>
      <form onSubmit={submit}>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            {text('nameEn', 'clients.form.nameEn')}
            {text('nameHe', 'clients.form.nameHe', { dir: 'rtl' })}
            <p className="-mt-2 text-xs text-muted md:col-span-2">{t('clients.form.oneNameHint')}</p>
            {text('companyId', 'clients.form.companyId')}
            {text('vatNumber', 'clients.form.vatNumber')}
            {text('country', 'clients.form.countryCode', { maxLength: 2 })}
            <label className="block">
              <span className={label}>{t('clients.form.defaultCurrency')}</span>
              <select className={input} value={current.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{t('clients.form.clientCopy')}</span>
              <select className={input} value={current.clientCopyLang} onChange={(e) => {
                  setCopyLangTouched(true);
                  set('clientCopyLang', e.target.value as 'en' | 'bilingual');
                }}>
                <option value="en">{t('clients.form.langEnglish')}</option>
                <option value="bilingual">{t('clients.form.langBilingual')}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={current.foreignResident} onChange={(e) => set('foreignResident', e.target.checked)} /> {t('clients.form.foreignResident')}
            </label>
            {text('email', 'clients.form.email', { type: 'email' })}
            {text('ccEmails', 'clients.form.ccEmails', { dir: 'ltr', placeholder: 'name@example.com, other@example.com' })}
            {text('phone', 'clients.form.phone')}
            {text('addressEn', 'clients.form.address', { dir: 'auto' })}
            {text('city', 'clients.form.city', { dir: 'auto' })}
            {text('postalCode', 'clients.form.postalCode', { dir: 'ltr' })}
          </div>
          <label className="mt-4 block">
            <span className={label}>{t('clients.form.notes')}</span>
            <textarea className={input} rows={3} value={current.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <label className="mt-4 block">
            <span className={label}>{t('clients.form.paymentInstructions')}</span>
            <textarea
              className={input}
              rows={3}
              value={current.paymentInstructions}
              onChange={(e) => set('paymentInstructions', e.target.value)}
              placeholder={t('clients.form.paymentInstructionsPlaceholder')}
            />
          </label>
          <div className="mt-4 rounded-md border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={currentConsent.granted} onChange={(e) => setConsentField('granted', e.target.checked)} />
              {t('clients.form.consentedLabel')}
            </label>
            {currentConsent.granted && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className={label}>{t('clients.form.sourceLabel')}</span>
                  <select className={input} value={currentConsent.source} onChange={(e) => setConsentField('source', e.target.value as ConsentFields['source'])}>
                    <option value="signed_contract">{t('clients.consentSource.signedContract')}</option>
                    <option value="other">{t('clients.consentSource.other')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className={label}>{t('clients.form.dateLabel')}</span>
                  <input type="date" dir="ltr" className={input} value={currentConsent.date} onChange={(e) => setConsentField('date', e.target.value)} />
                </label>
                <label className="block md:col-span-1">
                  <span className={label}>{t('clients.form.referenceNoteLabel')}</span>
                  <input className={input} value={currentConsent.note} onChange={(e) => setConsentField('note', e.target.value)} />
                </label>
              </div>
            )}
          </div>
          <ErrorNote error={error ?? loaded.error} />
          <div className="mt-4 flex gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {t('clients.form.saveClient')}
            </button>
            <button type="button" className={btnSecondary} onClick={() => navigate(-1)}>
              {t('clients.form.back')}
            </button>
          </div>
        </Card>
      </form>
    </section>
  );
}

const TABS: { key: 'overview' | 'ledger' | 'documents'; label: MessageKey }[] = [
  { key: 'overview', label: 'clients.page.tabOverview' },
  { key: 'ledger', label: 'clients.page.tabLedger' },
  { key: 'documents', label: 'clients.page.tabDocuments' },
];

export function ClientPage() {
  const t = useT();
  const issuing = useIssuing();
  const id = Number(useParams().id);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('overview');
  const { data, error, setData } = useLoad(() => clientsApi.get(id), [id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contact, setContact] = useState({ name: '', email: '', role: '' });
  const types = useLoad(() => docsApi.types(), []);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const newDocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newDocOpen) return;
    const close = (e: MouseEvent) => {
      if (!newDocRef.current?.contains(e.target as Node)) setNewDocOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newDocOpen]);

  if (!data) return <>{error ? <ErrorNote error={error} /> : <Loading />}</>;
  const c = data.client;

  async function act(work: () => Promise<typeof data>) {
    setActionError(null);
    try {
      setData(await work());
    } catch (e) {
      setActionError(errorText(e, t));
    }
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <PageTitle
        subtitle={c.name_en && c.name_he ? <bdi dir="rtl">{c.name_he}</bdi> : undefined}
        actions={
          <>
            {issuing && (
            <div className="relative" ref={newDocRef}>
              <button
                type="button"
                className={btnPrimary}
                aria-haspopup="menu"
                aria-expanded={newDocOpen}
                onClick={() => setNewDocOpen((open) => !open)}
              >
                {t('clients.page.newDocument')}
              </button>
              {newDocOpen && (
                <ul
                  role="menu"
                  className="absolute start-0 z-20 mt-2 min-w-[12rem] rounded-card border border-line bg-canvas p-1 shadow-card"
                >
                  {offeredDocumentTypes(types.data?.types ?? []).map((ty) => (
                    <li key={ty.code} role="none">
                      <Link
                        role="menuitem"
                        to={newDocumentPath(ty.code, c.id)}
                        className="block rounded-md px-3 py-2 text-sm capitalize hover:bg-surface"
                        onClick={() => setNewDocOpen(false)}
                      >
                        {TYPE_NAME_KEYS[ty.code] ? t(TYPE_NAME_KEYS[ty.code]!) : ty.name_en}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )}
            <Link to={`/clients/${c.id}/edit`} className={btnSecondary}>
              {t('clients.page.edit')}
            </Link>
            <button
              type="button"
              role="switch"
              aria-checked={c.active === 1}
              aria-label={t('clients.page.activeSwitch')}
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface"
              onClick={() => act(() => (c.active === 1 ? clientsApi.deactivate(c.id) : clientsApi.activate(c.id)))}
            >
              {/* Knob sits at the track's start when not active and its end when active (flex, so RTL mirrors it). */}
              <span
                className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  c.active === 1 ? 'justify-end bg-brand' : 'justify-start bg-line'
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-white shadow" />
              </span>
              {c.active === 1 ? t('clients.page.active') : t('clients.page.notActive')}
            </button>
          </>
        }
      >
        {c.name_en || <bdi dir="rtl">{c.name_he}</bdi>}
      </PageTitle>
      <p className="mb-4 text-sm text-muted">
        {t('clients.page.balanceLabel')} <span className="ltr-nums font-semibold text-ink">{totalsText(data.balances)}</span>
        {c.active !== 1 && <span className="ms-3 text-danger">{t('clients.notActiveBadge')}</span>}
      </p>
      <ErrorNote error={actionError} />
      <div role="tablist" aria-label={t('clients.page.sectionsAriaLabel')} className="mb-4 flex gap-2 border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            type="button"
            aria-selected={tab === tb.key}
            className={`px-3 py-2 text-sm ${tab === tb.key ? 'border-b-2 border-brand font-semibold text-brand' : 'text-muted'}`}
            onClick={() => setTab(tb.key)}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={t('clients.page.detailsTitle')}>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">{t('clients.page.companyIdLabel')}</dt>
              <dd>{c.company_id ?? t('clients.page.noneFallback')}</dd>
              <dt className="text-muted">{t('clients.page.vatNumberLabel')}</dt>
              <dd>{c.vat_number ?? t('clients.page.noneFallback')}</dd>
              <dt className="text-muted">{t('clients.page.countryLabel')}</dt>
              <dd>
                {c.country}
                {c.foreign_resident === 1 && ` ${t('clients.page.foreignResidentSuffix')}`}
              </dd>
              <dt className="text-muted">{t('clients.page.currencyLabel')}</dt>
              <dd>{c.currency}</dd>
              <dt className="text-muted">{t('clients.page.clientCopyLabel')}</dt>
              <dd>{c.client_copy_lang === 'en' ? t('clients.form.langEnglish') : t('clients.form.langBilingual')}</dd>
              <dt className="text-muted">{t('clients.page.emailLabel')}</dt>
              <dd>{c.email ?? t('clients.page.noneFallback')}</dd>
              {c.cc_emails && (
                <>
                  <dt className="text-muted">{t('clients.form.ccEmails')}</dt>
                  <dd dir="ltr">{c.cc_emails}</dd>
                </>
              )}
              <dt className="text-muted">{t('clients.page.digitalDocumentsLabel')}</dt>
              <dd>
                {t(CONSENT_STATUS_LABEL_KEYS[data.consent.status])}
                {data.consent.at && ` ${t('clients.page.consentOnDate', { date: data.consent.at.slice(0, 10) })}`}
                {consentMethodLabelKey(data.consent.method, data.consent.source) && ` (${t(consentMethodLabelKey(data.consent.method, data.consent.source)!)})`}
              </dd>
            </dl>
            {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{c.notes}</p>}
          </Card>
          <Card title={t('clients.page.contactsTitle')}>
            <ul className="mb-3 space-y-2 text-sm">
              {data.contacts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{p.name}</span>
                    {p.is_primary === 1 && <span className="ms-2 text-xs text-muted">{t('clients.page.primaryBadge')}</span>}
                    <span className="block text-xs text-muted">{[p.role, p.email, p.phone].filter(Boolean).join(', ')}</span>
                  </span>
                  <button type="button" className="text-xs text-danger" onClick={() => act(() => clientsApi.removeContact(c.id, p.id))}>
                    {t('clients.page.removeContact')}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => clientsApi.addContact(c.id, { ...contact, isPrimary: data.contacts.length === 0 })).then(() =>
                  setContact({ name: '', email: '', role: '' }),
                );
              }}
            >
              <input
                aria-label={t('clients.page.contactNameAriaLabel')}
                placeholder={t('clients.page.contactNamePlaceholder')}
                className={input}
                value={contact.name}
                onChange={(e) => setContact({ ...contact, name: e.target.value })}
                required
              />
              <input
                aria-label={t('clients.page.contactRoleAriaLabel')}
                placeholder={t('clients.page.contactRolePlaceholder')}
                className={input}
                value={contact.role}
                onChange={(e) => setContact({ ...contact, role: e.target.value })}
              />
              <input
                aria-label={t('clients.page.contactEmailAriaLabel')}
                placeholder={t('clients.page.contactEmailPlaceholder')}
                type="email"
                className={input}
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
              />
              <button type="submit" className={btnSecondary}>
                {t('clients.page.addContact')}
              </button>
            </form>
          </Card>
        </div>
      )}
      {tab === 'ledger' && <LedgerView clientId={c.id} />}
      {tab === 'documents' && <DocumentTable clientId={c.id} />}
    </section>
  );
}
