import { useState } from 'react';
import { useT } from '../../i18n';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

type Value = string | number | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: Value, b: Value): number {
  // Empty values go last whichever way the column sorts.
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Column sorting for a table. A first click sorts a column newest or largest first for dates and
 * amounts (`descFirst`), A to Z for text, a second click flips it. `initial` null keeps the order
 * the rows came in until a header is clicked.
 */
export function useSort<K extends string>(initial: SortState<K> | null, descFirst: K[] = []) {
  const [sort, setSort] = useState<SortState<K> | null>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: descFirst.includes(key) ? 'desc' : 'asc' }));
  function apply<T extends { id: number }>(items: T[], value: Record<K, (item: T) => Value>): T[] {
    if (!sort) return items;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const get = value[sort.key];
    return [...items].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const empty = (v: Value) => v === null || v === undefined || v === '';
      // Empty values stay at the bottom in both directions.
      if (empty(va) || empty(vb)) return compare(va, vb);
      return sign * compare(va, vb) || sign * (a.id - b.id);
    });
  }
  return { sort, toggle, apply };
}

/** A table header cell that sorts its column on click. */
export function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = 'start',
}: {
  label: string;
  column: K;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
  align?: 'start' | 'end';
}) {
  const t = useT();
  const active = sort?.key === column;
  const arrow = active ? (sort!.dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th className={`px-3 py-2 ${align === 'end' ? 'text-end' : 'text-start'}`} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? 'text-ink' : ''}`}
        onClick={() => onSort(column)}
        title={t('documents.list.sortBy', { column: label })}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {arrow}
        </span>
      </button>
    </th>
  );
}
