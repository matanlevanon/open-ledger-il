import { type ReactNode, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { EmptyState } from './EmptyState';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export interface DataTableTab<T> {
  key: string;
  label: string;
  predicate: (row: T) => boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Strings matched against the search box, case-insensitive. */
  searchText?: (row: T) => string[];
  searchPlaceholder?: string;
  tabs?: DataTableTab<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
}

/** A list table with a tab strip and a search filter, per docs/ui-direction.md. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  searchText,
  searchPlaceholder,
  tabs,
  emptyTitle,
  emptyDescription,
}: DataTableProps<T>) {
  const t = useT();
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('dataTable.search');
  const resolvedEmptyTitle = emptyTitle ?? t('dataTable.nothingHereYet');
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.key);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const tab = tabs?.find((t) => t.key === activeTab);
    const byTab = tab ? rows.filter(tab.predicate) : rows;
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return byTab;
    return byTab.filter((row) => searchText(row).some((v) => v.toLowerCase().includes(q)));
  }, [rows, tabs, activeTab, query, searchText]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        {tabs && tabs.length > 0 && (
          <div role="tablist" className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-full px-3 py-1 text-sm ${
                  activeTab === tab.key ? 'bg-band font-semibold text-brand' : 'text-muted hover:bg-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {searchText && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={resolvedSearchPlaceholder}
            aria-label={resolvedSearchPlaceholder}
            className="w-full max-w-xs rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-6">
          <EmptyState title={resolvedEmptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`border-b border-line py-2 text-xs font-semibold uppercase tracking-wide text-muted ${
                    col.align === 'right' ? 'text-end' : 'text-start'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className={`py-2 ${col.align === 'right' ? 'text-end' : 'text-start'}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
