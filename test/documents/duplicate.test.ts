import { describe, expect, it } from 'vitest';
import { api, clock, issue, line, makeClient, ok, pay } from './helpers';

describe('duplicate a document', () => {
  it('copies client, lines, currency and payment details into a new draft dated today, with no number', async () => {
    const client = await makeClient({ currency: 'USD' });
    const pr = await issue('PR', {
      clientId: client,
      currency: 'USD',
      dueDate: clock.today,
      notes: 'Monthly retainer',
      paymentInstructions: 'Wire to account 123',
      lines: [line(150000, 'Retainer'), line(20000, 'Ads setup', 2000)],
    });
    const copy = await ok('POST', `/documents/${pr.document.id}/duplicate`);
    expect(copy.document).toMatchObject({
      type: 'PR',
      status: 'draft',
      number: null,
      client_id: client,
      currency: 'USD',
      date: clock.today,
      due_date: clock.today,
      notes: 'Monthly retainer',
      payment_instructions: 'Wire to account 123',
      total_minor: pr.document.total_minor,
    });
    expect(copy.document.id).not.toBe(pr.document.id);
    expect(copy.lines.map((l: any) => [l.description_en ?? l.description, l.quantity_milli, l.unit_price_minor])).toEqual(
      pr.lines.map((l: any) => [l.description_en ?? l.description, l.quantity_milli, l.unit_price_minor]),
    );
  });

  it('copies a receipt with its payment moved to the new date', async () => {
    const client = await makeClient();
    const receipt = await issue('400', { clientId: client, lines: [line(50000)], payments: [pay(50000)] });
    const copy = await ok('POST', `/documents/${receipt.document.id}/duplicate`);
    expect(copy.document.status).toBe('draft');
    expect(copy.payments).toHaveLength(1);
    expect(copy.payments[0]).toMatchObject({ amount_minor: 50000, paid_on: clock.today });
  });

  it('refuses a credit', async () => {
    const client = await makeClient();
    const receipt = await issue('400', { clientId: client, lines: [line(50000)], payments: [pay(50000)] });
    const credit = await ok('POST', `/documents/${receipt.document.id}/credit`, { mode: 'full', reason: 'Refund' });
    const r = await api('POST', `/documents/${credit.document.id}/duplicate`);
    expect(r.status).toBe(409);
  });
});
