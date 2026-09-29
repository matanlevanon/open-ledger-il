import { describe, expect, it } from 'vitest';
import { labelTables } from './stackTables';

describe('labelTables', () => {
  it('copies column headers onto each cell, skips spanning cells and opted-out tables', () => {
    document.body.innerHTML = `
      <div class="overflow-x-auto"><table id="a">
        <thead><tr><th>Date</th><th>Client</th><th></th></tr></thead>
        <tbody><tr><td>1</td><td>Acme</td><td>View</td></tr><tr><td colspan="3">edit</td></tr></tbody>
      </table></div>
      <table id="b" data-no-stack><thead><tr><th>X</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
    labelTables(document.body);
    const a = document.getElementById('a')!;
    expect(a.classList.contains('stack-table')).toBe(true);
    expect(a.parentElement!.classList.contains('stack-wrap')).toBe(true);
    const cells = Array.from(a.querySelectorAll('tbody tr:first-child td')).map((td) => td.getAttribute('data-label'));
    expect(cells).toEqual(['Date', 'Client', '']);
    expect(a.querySelector('td[colspan]')!.getAttribute('data-label')).toBe('');
    const b = document.getElementById('b')!;
    expect(b.classList.contains('stack-table')).toBe(false);
    expect(b.querySelector('td')!.hasAttribute('data-label')).toBe(false);
  });
});
