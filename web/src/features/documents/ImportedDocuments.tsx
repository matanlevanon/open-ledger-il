import { apiGet } from '../../api/client';
import { useT } from '../../i18n';
import { money } from './format';
import { Card, ErrorNote, Loading, useLoad } from './ui';

export interface ImportedDocument {
  id: number;
  doc_type: string;
  original_number: string;
  issue_date: string;
  client_id: number | null;
  client_name_text: string;
  currency: string;
  total_minor: number;
  paid_status: string;
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

/**
 * Documents issued in another system before the ledger and filed under Import (R17 task 7).
 * They keep their original numbers, outside the ledger's own series, so they list separately.
 */
export function ImportedDocuments({ kinds, clientId }: { kinds?: ImportedKind[]; clientId?: number }) {
  const t = useT();
  const { data, error } = useLoad(
    () => apiGet<{ documents: ImportedDocument[] }>(`/import/external-documents${clientId ? `?clientId=${clientId}` : ''}`),
    [clientId],
  );
  const rows = (data?.documents ?? [])
    .filter((d) => !kinds || kinds.includes(importedKind(d.doc_type) as ImportedKind))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.id - a.id);
  if (data && rows.length === 0) return null;
  return (
    <Card title={t('documents.imported.title')}>
      <p className="mb-3 text-sm text-muted">{t('documents.imported.hint')}</p>
      <ErrorNote error={error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[720px] text-sm">
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
              {rows.map((d) => (
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
                    {d.paid_status === 'paid'
                      ? t('documents.imported.paid.paid')
                      : d.paid_status === 'unpaid'
                        ? t('documents.imported.paid.unpaid')
                        : t('documents.imported.paid.unknown')}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <a href={`/api/import/external-documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand hover:underline">
                      {t('documents.imported.viewPdf')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
