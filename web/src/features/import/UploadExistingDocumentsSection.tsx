import { useEffect, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { type Client, clientsApi } from '../documents/api';
import { CURRENCIES, clientName } from '../documents/format';
import { type ExtractedExternalDoc, fileExternalDocument, uploadExternalDocument } from './api';

const SOURCES = ['sumit', 'wave', 'other'] as const;
const PAID_STATUSES = ['paid', 'unpaid', 'unknown'] as const;

interface Row {
  key: string;
  filename: string;
  uploadId: number | null;
  extractionError: string | null;
  source: (typeof SOURCES)[number];
  documentType: string;
  originalNumber: string;
  issueDate: string;
  clientId: number | null;
  clientName: string;
  clientTaxId: string;
  currency: string;
  amountBeforeVat: string;
  vatAmount: string;
  total: string;
  paidStatus: (typeof PAID_STATUSES)[number];
  filedId: number | null;
  error: string | null;
  busy: boolean;
}

function fromExtraction(filename: string, uploadId: number, extraction: ExtractedExternalDoc, extractionError: string | null): Row {
  return {
    key: `${filename}-${uploadId}`,
    filename,
    uploadId,
    extractionError,
    source: extraction.source ?? 'other',
    documentType: extraction.documentType ?? '',
    originalNumber: extraction.originalNumber ?? '',
    issueDate: extraction.issueDate ?? '',
    clientId: null,
    clientName: extraction.clientName ?? '',
    clientTaxId: extraction.clientTaxId ?? '',
    currency: extraction.currency ?? 'ILS',
    amountBeforeVat: extraction.amountBeforeVat ?? '',
    vatAmount: extraction.vatAmount ?? '0',
    total: extraction.total ?? '',
    paidStatus: extraction.paidStatus ?? 'unknown',
    filedId: null,
    error: null,
    busy: false,
  };
}

const input = 'w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm';
const label = 'block text-xs font-semibold text-muted';

/** R17 task 7: upload one or many previously-issued documents, review the extracted fields, then file them. */
export function UploadExistingDocumentsSection() {
  const t = useT();
  const { locale } = usePreferences();
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    clientsApi
      .list()
      .then((body) => setClients(body.clients))
      .catch(() => undefined);
  }, []);

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadExternalDocument(file);
        setRows((rs) => [...rs, fromExtraction(file.name, result.uploadId, result.extraction, result.extractionError)]);
      }
    } finally {
      setUploading(false);
    }
  }

  async function createClient(row: Row) {
    if (!row.clientName.trim()) return;
    const created = await clientsApi.create({ nameEn: row.clientName });
    setClients((cs) => [...cs, created.client]);
    set(row.key, { clientId: created.client.id });
  }

  async function file(row: Row) {
    if (row.uploadId === null) return;
    set(row.key, { busy: true, error: null });
    try {
      const document = await fileExternalDocument({
        uploadId: row.uploadId,
        source: row.source,
        documentType: row.documentType,
        originalNumber: row.originalNumber,
        issueDate: row.issueDate,
        clientId: row.clientId,
        clientName: row.clientName,
        clientTaxId: row.clientTaxId || null,
        currency: row.currency,
        amountBeforeVat: row.amountBeforeVat || '0',
        vatAmount: row.vatAmount || '0',
        total: row.total || '0',
        paidStatus: row.paidStatus,
      });
      set(row.key, { filedId: document.id, busy: false });
    } catch (err) {
      set(row.key, { error: err instanceof Error ? err.message : String(err), busy: false });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg text-ink">{t('import.uploads.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('import.uploads.hint')}</p>
      </div>
      <label className="inline-block">
        <span className="sr-only">{t('import.uploads.chooseFiles')}</span>
        <input type="file" accept="application/pdf" multiple disabled={uploading} onChange={(e) => void onFiles(e.target.files)} />
      </label>
      {uploading && <p className="text-sm text-muted">{t('import.uploads.uploading')}</p>}

      {rows.map((row) => (
        <div key={row.key} className="rounded-card border border-line bg-canvas p-4 shadow-card">
          <p className="text-sm font-semibold">{row.filename}</p>
          {row.extractionError && <p className="mt-1 text-xs text-danger">{t('import.uploads.extractionFailed', { message: row.extractionError })}</p>}
          {row.filedId !== null ? (
            <p className="mt-2 text-sm text-success">{t('import.uploads.filed', { id: String(row.filedId) })}</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label>
                  <span className={label}>{t('import.uploads.field.source')}</span>
                  <select className={input} value={row.source} onChange={(e) => set(row.key, { source: e.target.value as Row['source'] })}>
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.documentType')}</span>
                  <input className={input} value={row.documentType} onChange={(e) => set(row.key, { documentType: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.originalNumber')}</span>
                  <input className={input} value={row.originalNumber} onChange={(e) => set(row.key, { originalNumber: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.issueDate')}</span>
                  <input type="date" dir="ltr" className={input} value={row.issueDate} onChange={(e) => set(row.key, { issueDate: e.target.value })} />
                </label>
                <label className="col-span-2">
                  <span className={label}>{t('import.uploads.field.client')}</span>
                  <select
                    className={input}
                    value={row.clientId ?? ''}
                    onChange={(e) => set(row.key, { clientId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">{t('import.uploads.field.noClientMatch')}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {clientName(c, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.clientName')}</span>
                  <input className={input} value={row.clientName} onChange={(e) => set(row.key, { clientName: e.target.value })} />
                </label>
                <div className="flex items-end">
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => void createClient(row)} disabled={row.clientId !== null}>
                    {t('import.uploads.createClient')}
                  </button>
                </div>
                <label>
                  <span className={label}>{t('import.uploads.field.clientTaxId')}</span>
                  <input className={input} value={row.clientTaxId} onChange={(e) => set(row.key, { clientTaxId: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.currency')}</span>
                  <select className={input} value={row.currency} onChange={(e) => set(row.key, { currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.amountBeforeVat')}</span>
                  <input inputMode="decimal" className={input} value={row.amountBeforeVat} onChange={(e) => set(row.key, { amountBeforeVat: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.vatAmount')}</span>
                  <input inputMode="decimal" className={input} value={row.vatAmount} onChange={(e) => set(row.key, { vatAmount: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.total')}</span>
                  <input inputMode="decimal" className={input} value={row.total} onChange={(e) => set(row.key, { total: e.target.value })} />
                </label>
                <label>
                  <span className={label}>{t('import.uploads.field.paidStatus')}</span>
                  <select className={input} value={row.paidStatus} onChange={(e) => set(row.key, { paidStatus: e.target.value as Row['paidStatus'] })}>
                    {PAID_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {row.error && <p className="mt-2 text-sm text-danger">{row.error}</p>}
              <button
                type="button"
                className="mt-3 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
                disabled={row.busy || !row.originalNumber || !row.issueDate || !row.clientName || !row.total}
                onClick={() => void file(row)}
              >
                {t('import.uploads.fileButton')}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
