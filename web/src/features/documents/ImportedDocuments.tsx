import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { type Client, apiSend, clientsApi, docsApi, type Service, servicesApi } from './api';
import { CURRENCIES, clientName, money } from './format';
import { Card, ErrorNote, Loading, useLoad } from './ui';

export interface ImportedDocument {
  id: number;
  doc_type: string;
  original_number: string;
  issue_date: string;
  client_id: number | null;
  client_name_text: string;
  client_tax_id: string | null;
  currency: string;
  amount_before_vat_minor: number;
  vat_amount_minor: number;
  total_minor: number;
  paid_status: string;
  item_id: number | null;
  receipt_json: string | null;
}

interface LinkedReceipt {
  id: number;
  type: string;
  number: number | null;
  status: string;
}

export type ImportedKind = 'receipt' | 'proforma' | 'quote' | 'request';

/** The imported document's type is free text read from the PDF, in English or Hebrew. */
export function importedKind(docType: string): ImportedKind | 'other' {
  const t = docType.toLowerCase();
  if (/pro ?forma|חשבון עסקה/.test(t)) return 'proforma';
  if (/payment request|דרישת תשלום/.test(t)) return 'request';
  if (/quot|הצעת מחיר/.test(t)) return 'quote';
  if (/receipt|invoice|credit|קבלה|חשבונית|חשבון|זיכוי/.test(t)) return 'receipt';
  return 'other';
}

/** 2026-08-05 as 05/08/2026, the way Israeli documents print dates. */
export const dayFirst = (iso: string) => iso.split('-').reverse().join('/');

/** The types a past document can be filed as, stored by their English name. */
export const IMPORTED_DOC_TYPES = [
  { value: 'Quote', en: 'Quote', he: 'הצעת מחיר' },
  { value: 'Payment Request', en: 'Payment request', he: 'דרישת תשלום' },
  { value: 'Pro Forma Invoice', en: 'Pro forma invoice', he: 'חשבון עסקה' },
  { value: 'Tax Invoice', en: 'Tax invoice', he: 'חשבונית מס' },
  { value: 'Invoice/Receipt', en: 'Invoice/receipt', he: 'חשבונית מס/קבלה' },
  { value: 'Receipt', en: 'Receipt', he: 'קבלה' },
  { value: 'Credit', en: 'Credit', he: 'זיכוי' },
] as const;

const major = (minor: number) => (minor / 100).toFixed(2);
const input = 'w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm';
const label = 'block text-xs font-semibold text-muted';

interface EditForm {
  documentType: string;
  originalNumber: string;
  issueDate: string;
  clientId: number | null;
  clientName: string;
  currency: string;
  amountBeforeVat: string;
  vatAmount: string;
  total: string;
  paidStatus: string;
  itemId: number | null;
}

function EditRow({ doc, clients, services, onDone }: { doc: ImportedDocument; clients: Client[]; services: Service[]; onDone: (saved: boolean) => void }) {
  const t = useT();
  const { locale } = usePreferences();
  const [form, setForm] = useState<EditForm>({
    documentType: doc.doc_type,
    originalNumber: doc.original_number,
    issueDate: doc.issue_date,
    clientId: doc.client_id,
    clientName: doc.client_name_text,
    currency: doc.currency,
    amountBeforeVat: major(doc.amount_before_vat_minor),
    vatAmount: major(doc.vat_amount_minor),
    total: major(doc.total_minor),
    paidStatus: doc.paid_status,
    itemId: doc.item_id,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }));
  const typeOptions = IMPORTED_DOC_TYPES.some((d) => d.value === form.documentType)
    ? IMPORTED_DOC_TYPES
    : [{ value: form.documentType, en: form.documentType, he: form.documentType }, ...IMPORTED_DOC_TYPES];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiSend('PATCH', `/import/external-documents/${doc.id}`, form);
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line bg-surface">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label>
            <span className={label}>{t('import.uploads.field.documentType')}</span>
            <select className={input} value={form.documentType} onChange={(e) => set({ documentType: e.target.value })}>
              {typeOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {locale === 'he' ? d.he : d.en}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.originalNumber')}</span>
            <input className={input} value={form.originalNumber} onChange={(e) => set({ originalNumber: e.target.value })} />
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.issueDate')}</span>
            <input type="date" dir="ltr" className={input} value={form.issueDate} onChange={(e) => set({ issueDate: e.target.value })} />
            {form.issueDate && <span className="ltr-nums mt-1 block text-xs text-muted">{dayFirst(form.issueDate)}</span>}
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.client')}</span>
            <select className={input} value={form.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('import.uploads.field.noClientMatch')}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {clientName(c, locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.currency')}</span>
            <select className={input} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((cur) => (
                <option key={cur}>{cur}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.amountBeforeVat')}</span>
            <input inputMode="decimal" className={input} value={form.amountBeforeVat} onChange={(e) => set({ amountBeforeVat: e.target.value })} />
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.vatAmount')}</span>
            <input inputMode="decimal" className={input} value={form.vatAmount} onChange={(e) => set({ vatAmount: e.target.value })} />
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.total')}</span>
            <input inputMode="decimal" className={input} value={form.total} onChange={(e) => set({ total: e.target.value })} />
          </label>
          <label>
            <span className={label}>{t('import.uploads.field.paidStatus')}</span>
            <select className={input} value={form.paidStatus} onChange={(e) => set({ paidStatus: e.target.value })}>
              <option value="paid">{t('documents.imported.paid.paid')}</option>
              <option value="unpaid">{t('documents.imported.paid.unpaid')}</option>
              <option value="unknown">{t('documents.imported.paid.unknown')}</option>
            </select>
          </label>
          <label>
            <span className={label}>{t('documents.imported.service')}</span>
            <select className={input} value={form.itemId ?? ''} onChange={(e) => set({ itemId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('documents.imported.noService')}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {locale === 'he' ? s.name_he || s.name_en : s.name_en}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60">
            {t('documents.imported.save')}
          </button>
          <button type="button" disabled={busy} onClick={() => onDone(false)} className="rounded-full border border-line px-4 py-2 text-sm hover:bg-canvas">
            {t('documents.imported.cancel')}
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Documents issued in another system before the ledger and filed under Import (R17 task 7).
 * They keep their original numbers, outside the ledger's own series, so they list separately.
 * Their fields can be corrected, and an unpaid pro forma or payment request can be paid with a
 * receipt issued here.
 */
export function ImportedDocuments({ kinds, clientId }: { kinds?: ImportedKind[]; clientId?: number }) {
  const t = useT();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error } = useLoad(
    () => apiGet<{ documents: ImportedDocument[] }>(`/import/external-documents${clientId ? `?clientId=${clientId}` : ''}`),
    [clientId, reload],
  );
  useEffect(() => {
    if (editing === null || clients.length > 0) return;
    clientsApi
      .list({ active: 'all' })
      .then((b) => setClients(b.clients))
      .catch(() => undefined);
  }, [editing, clients.length]);
  useEffect(() => {
    if (editing === null || services.length > 0) return;
    servicesApi
      .list()
      .then((b) => setServices(b.services))
      .catch(() => undefined);
  }, [editing, services.length]);

  const rows = (data?.documents ?? [])
    .filter((d) => !kinds || kinds.includes(importedKind(d.doc_type) as ImportedKind))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.id - a.id);
  if (data && rows.length === 0) return null;

  /** Opens a receipt draft for the imported document's client and total, linked to it. */
  async function createReceipt(d: ImportedDocument) {
    setActionError(null);
    try {
      const { types } = await docsApi.types();
      const type = types.find((ty) => ty.code === '320' && ty.enabled) ? '320' : '400';
      const draft = await docsApi.create({
        type,
        clientId: d.client_id,
        currency: d.currency,
        lines: [{ description: `${d.doc_type} ${d.original_number}`, unitPriceMinor: d.total_minor, quantityMilli: 1000 }],
      } as never);
      await apiSend('POST', `/import/external-documents/${d.id}/receipts`, { documentId: draft.document.id });
      navigate(`/income/documents/${draft.document.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const receiptOf = (d: ImportedDocument): LinkedReceipt | null => (d.receipt_json ? (JSON.parse(d.receipt_json) as LinkedReceipt) : null);

  return (
    <Card title={t('documents.imported.title')}>
      <p className="mb-3 text-sm text-muted">{t('documents.imported.hint')}</p>
      <ErrorNote error={error ?? actionError} />
      {!data ? (
        !error && <Loading />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-band text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 text-start">{t('documents.list.colDate')}</th>
                <th className="px-3 py-2 text-start">{t('documents.list.colNumber')}</th>
                <th className="px-3 py-2 text-start">{t('documents.list.colClient')}</th>
                <th className="px-3 py-2 text-end">{t('documents.list.colAmount')}</th>
                <th className="px-3 py-2 text-start">{t('documents.imported.colPaid')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                if (editing === d.id) {
                  return (
                    <EditRow
                      key={d.id}
                      doc={d}
                      clients={clients}
                      services={services}
                      onDone={(saved) => {
                        setEditing(null);
                        if (saved) setReload((n) => n + 1);
                      }}
                    />
                  );
                }
                const receipt = receiptOf(d);
                const kind = importedKind(d.doc_type);
                const canReceipt = (kind === 'proforma' || kind === 'request') && d.paid_status !== 'paid' && !receipt;
                return (
                  <tr key={d.id} className="border-t border-line">
                    <td className="ltr-nums px-3 py-2 tabular-nums">{dayFirst(d.issue_date)}</td>
                    <td className="px-3 py-2">
                      <span dir="auto">{d.doc_type}</span> / {d.original_number}
                    </td>
                    <td className="px-3 py-2" dir="auto">
                      {d.client_name_text}
                    </td>
                    <td className="ltr-nums px-3 py-2 text-end tabular-nums">{money(d.total_minor, d.currency)}</td>
                    <td className="px-3 py-2">
                      {receipt ? (
                        <a href={`/income/documents/${receipt.id}`} className="text-brand hover:underline">
                          {receipt.status === 'final' ? t('documents.imported.paidBy', { number: String(receipt.number ?? '') }) : t('documents.imported.receiptDraft')}
                        </a>
                      ) : d.paid_status === 'paid' ? (
                        t('documents.imported.paid.paid')
                      ) : d.paid_status === 'unpaid' ? (
                        t('documents.imported.paid.unpaid')
                      ) : (
                        t('documents.imported.paid.unknown')
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      <a href={`/api/import/external-documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand hover:underline">
                        {t('documents.imported.viewPdf')}
                      </a>
                      <button type="button" className="ms-3 text-sm text-brand hover:underline" onClick={() => setEditing(d.id)}>
                        {t('documents.imported.edit')}
                      </button>
                      {canReceipt && (
                        <button type="button" className="ms-3 text-sm font-semibold text-brand hover:underline" onClick={() => void createReceipt(d)}>
                          {t('documents.imported.createReceipt')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
