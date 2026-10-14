import { describe, expect, it } from 'vitest';
import { renderDocument } from '../../src/modules/pdf/render';
import type { RenderDocument } from '../../src/modules/pdf/types';
import { sampleRenderDocument } from '../fixtures/pdf/sample';

/**
 * A shekel document carries totalIlsMinor too, equal to its total. It used to print "Total (₪)"
 * twice. The shekel column and the two-column totals print only on a foreign-currency document.
 */

function doc(currency: 'ILS' | 'USD' | 'EUR', langVariant: 'en' | 'bilingual'): RenderDocument {
  const ils = currency === 'ILS';
  return sampleRenderDocument({
    currency,
    langVariant,
    kind: 'receipt',
    totalIlsMinor: ils ? 100000 : 371200,
    fxRate: ils ? null : '3.712000',
    payments: [{ method: 'card', methodDetail: null, paidOn: '2026-10-05', reference: null, amountMinor: 100000, amountIlsMinor: ils ? 100000 : 371200, currency }],
  });
}

/** The header cells of the first table with this class. */
function headerCells(html: string, cls: string): number {
  const table = new RegExp(`<table class="${cls}">[\\s\\S]*?</thead>`).exec(html)?.[0] ?? '';
  return (table.match(/<th[\s>]/g) ?? []).length;
}

const VIEWS = [
  ['English', 'en', 'client'],
  ['bilingual', 'en', 'filed'],
  ['Hebrew', 'bilingual', 'client'],
] as const;

describe('shekel columns on the PDF', () => {
  for (const [name, langVariant, variant] of VIEWS) {
    it(`an ILS document in ${name} has one total column, in the line and payment tables, and no second totals column`, () => {
      const html = renderDocument(doc('ILS', langVariant), variant);
      expect(headerCells(html, 'items')).toBe(4);
      expect(headerCells(html, 'payments-table')).toBe(2);
      expect(html).not.toContain('<tfoot>');
      expect((html.match(/<tr class="grand">/g) ?? []).length).toBe(1);
    });

    for (const currency of ['USD', 'EUR'] as const) {
      it(`a ${currency} document in ${name} still shows both total columns`, () => {
        const html = renderDocument(doc(currency, langVariant), variant);
        expect(headerCells(html, 'items')).toBe(5);
        expect(headerCells(html, 'payments-table')).toBe(3);
        expect(html).toContain('<tfoot>');
        expect(html).toContain('3.712');
      });
    }
  }
});
