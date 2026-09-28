import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { type DocListItem, docsApi } from './api';
import { clientName, money, totalsText } from './format';
import { ImportedDocuments, type ImportedKind } from './ImportedDocuments';
import { Card, ErrorNote, Loading, PageTitle, StatusChip, btnPrimary, useLoad } from './ui';

/** Which imported past documents belong on a list, by the list's type codes. */
function importedKindsFor(types: string): ImportedKind[] {
  const codes = types.split(',');
  const kinds: ImportedKind[] = [];
  if (codes.some((c) => ['400', '405', '305', '320', '330'].includes(c))) kinds.push('receipt');
  if (codes.some((c) => ['300', 'PF'].includes(c))) kinds.push('proforma');
  if (codes.includes('QT')) kinds.push('quote');
  if (codes.includes('PR')) kinds.push('request');
  return kinds;
}

const TABS: { key: 'unpaid' | 'draft' | 'all'; label: MessageKey }[] = [
  { key: 'unpaid', label: 'documents.list.tabUnpaid' },
  { key: 'draft', label: 'documents.list.tabDraft' },
  { key: 'all', label: 'documents.list.tabAll' },
];

type Tab = (typeof TABS)[number]['key'];

interface ListPageProps {
  title: string;
  /** Comma list of type codes. */
  types: string;
  newPath: string;
  newLabel: string;
  /** Quotes never owe money, so they have no Unpaid tab. */
  hasUnpaid?: boolean;
}

export function DocumentListPage({ title, types, newPath, newLabel, hasUnpaid = true }: ListPageProps) {
  const t = useT();
  const tabs = hasUnpaid ? TABS : TABS.filter((t) => t.key !== 'unpaid');
  const [tab, setTab] = useState<Tab>(hasUnpaid ? 'unpaid' : 'all');
  const { data, error } = useLoad(() => docsApi.list({ tab, type: types }), [tab, types]);

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-6xl">
      <PageTitle
        actions={
          <Link to={newPath} className={btnPrimary}>
            {newLabel}
          </Link>
        }
      >
        {title}
      </PageTitle>
      {hasUnpaid && data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryTile label={t('documents.list.overdueTile')} value={totalsText(data.summary.overdue)} tone="text-danger" />
          <SummaryTile label={t('documents.list.dueSoonTile')} value={totalsText(data.summary.due_soon)} />
          <SummaryTile label={t('documents.list.openTile')} value={totalsText(data.summary.open)} />
        </div>
      )}
      <div role="tablist" aria-label={t('documents.list.filterAriaLabel')} className="mb-4 flex gap-2 border-b border-line">
        {tabs.map((tb) => (
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
      <ErrorNote error={error} />
      {!data ? !error && <Loading /> : <Rows items={data.items} />}
      {tab === 'all' && importedKindsFor(types).length > 0 && (
        <div className="mt-6">
          <ImportedDocuments kinds={importedKindsFor(types)} />
        </div>
      )}
    </section>
  );
}

function SummaryTile({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-card border border-line bg-band p-4">
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className={`ltr-nums mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/** Documents of one client, for the client page. */
export function DocumentTable({ clientId }: { clientId: number }) {
  const t = useT();
  const { data, error } = useLoad(() => docsApi.list({ tab: 'all', clientId }), [clientId]);
  return (
    <>
      <Card title={t('documents.list.documentsTitle')}>
        <ErrorNote error={error} />
        {!data ? !error && <Loading /> : <Rows items={data.items} />}
      </Card>
      <div className="mt-6">
        <ImportedDocuments clientId={clientId} />
      </div>
    </>
  );
}

const hasIls = (d: DocListItem) => ['receipt', 'credit'].includes(d.kind) && d.currency !== 'ILS' && d.total_ils_minor !== null;

function Rows({ items }: { items: DocListItem[] }) {
  const t = useT();
  const { locale } = usePreferences();
  if (items.length === 0) return <p className="py-6 text-center text-muted">{t('documents.list.noDocuments')}</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-band text-start text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2">{t('documents.list.colStatus')}</th>
            <th className="px-3 py-2">{t('documents.list.colDate')}</th>
            <th className="px-3 py-2">{t('documents.list.colNumber')}</th>
            <th className="px-3 py-2">{t('documents.list.colClient')}</th>
            <th className="px-3 py-2">{t('documents.list.colRelated')}</th>
            <th className="px-3 py-2 text-end">{t('documents.list.colAmount')}</th>
            <th className="px-3 py-2 text-end">{t('documents.list.colOpen')}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className="border-t border-line">
              <td className="px-3 py-2">
                <StatusChip state={d.state} overdue={d.overdue} />
              </td>
              <td className="ltr-nums px-3 py-2 tabular-nums">{d.date}</td>
              <td className="px-3 py-2">
                <Link to={`/income/documents/${d.id}`} className="text-brand hover:underline">
                  {d.display_number ?? t('documents.page.draftFallbackTitle', { typeName: d.type_name_en })}
                </Link>
                <span className="block text-xs text-muted">{d.type_name_en}</span>
              </td>
              <td className="px-3 py-2">{clientName({ name_en: d.client_name_en, name_he: d.client_name_he }, locale) || t('documents.noClient')}</td>
              <td className="px-3 py-2">
                {(d.related ?? []).map((r) => (
                  <Link key={r.id} to={`/income/documents/${r.id}`} className="block text-brand hover:underline">
                    {locale === 'he' ? r.name_he : r.name_en} / {r.number ?? t('documents.list.relatedDraft')}
                  </Link>
                ))}
              </td>
              <td className="ltr-nums px-3 py-2 text-end tabular-nums">
                {money(d.total_minor, d.currency)}
                {hasIls(d) && <span className="block text-xs text-muted">{money(d.total_ils_minor!, 'ILS')}</span>}
              </td>
              <td className="ltr-nums px-3 py-2 text-end tabular-nums">{d.remaining_minor ? money(d.remaining_minor, d.currency) : ''}</td>
              <td className="px-3 py-2 text-end">
                <RowAction doc={d} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowAction({ doc }: { doc: DocListItem }) {
  const t = useT();
  const to = `/income/documents/${doc.id}`;
  let text = t('documents.list.actionView');
  if (doc.state === 'draft') text = t('documents.list.actionFinishDraft');
  else if (doc.kind === 'demand' && (doc.remaining_minor ?? 0) > 0) text = t('documents.list.actionRecordPayment');
  return (
    <Link to={to} className="text-sm font-semibold text-brand hover:underline">
      {text}
    </Link>
  );
}
