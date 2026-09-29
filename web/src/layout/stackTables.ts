import { type RefObject, useEffect } from 'react';

/**
 * Phone layout for every table in the app. Each body and footer cell gets a `data-label` copied
 * from its column header, and the table gets the `stack-table` class. On a narrow screen
 * (src/styles/index.css) each row then shows as a card of label and value lines instead of a
 * table that scrolls sideways. A table opts out with `data-no-stack`.
 *
 * A MutationObserver re-labels when rows change. It watches child lists only, so the labels it
 * writes (attributes) never trigger it again.
 */
export function labelTables(root: ParentNode): void {
  root.querySelectorAll('table').forEach((table) => {
    if (table.hasAttribute('data-no-stack')) return;
    const headRow = table.querySelector('thead tr:last-child');
    if (!headRow) return;
    const heads: string[] = [];
    headRow.querySelectorAll('th, td').forEach((th) => {
      const span = (th as HTMLTableCellElement).colSpan || 1;
      const text = (th.textContent ?? '').trim();
      for (let i = 0; i < span; i += 1) heads.push(i === 0 ? text : '');
    });
    if (!table.classList.contains('stack-table')) table.classList.add('stack-table');
    const wrap = table.parentElement;
    if (wrap && wrap.classList.contains('overflow-x-auto') && !wrap.classList.contains('stack-wrap')) wrap.classList.add('stack-wrap');
    table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
      let col = 0;
      Array.from(tr.children).forEach((cell) => {
        const span = (cell as HTMLTableCellElement).colSpan || 1;
        const label = span > 1 ? '' : (heads[col] ?? '');
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        col += span;
      });
    });
  });
}

export function useStackTables(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    let frame = 0;
    const run = () => {
      frame = 0;
      labelTables(root);
    };
    run();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
