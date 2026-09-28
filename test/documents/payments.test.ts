import { beforeEach, describe, expect, it } from 'vitest';
import { all, run } from '../../src/core/db';
import { db } from '../helpers';
import { api, clock, fxHistory, issue, line, makeClient, ok, pay } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('partial payment math per currency', () => {
  it('keeps a USD and a EUR request open with separate balances until each is paid', async () => {
    const client = await makeClient({ currency: 'USD' });
    const usd = await issue('PR', { clientId: client, lines: [line(60000, 'Strategy', 2000)] }); // 2 x 600.00 = 1,200.00
    const eur = await issue('PR', { clientId: client, currency: 'EUR', lines: [line(50000)] });
    expect(usd.document.total_minor).toBe(120000);
    expect(usd.document.total_ils_minor).toBeNull();

    let detail = await ok('GET', `/clients/${client}`);
    expect(detail.balances).toEqual({ USD: 120000, EUR: 50000 });

    const r1 = await ok('POST', `/documents/${usd.document.id}/record-payment`, { payments: [pay(45000, '2026-10-05')] });
    expect(r1.document.type).toBe('400');
    expect(r1.document.status).toBe('final');
    expect(r1.document.currency).toBe('USD');
    expect(r1.document.total_minor).toBe(45000);

    let pr = await ok('GET', `/documents/${usd.document.id}`);
    expect(pr.document.state).toBe('partial');
    expect(pr.document.paid_minor).toBe(45000);
    expect(pr.document.remaining_minor).toBe(75000);
    detail = await ok('GET', `/clients/${client}`);
    expect(detail.balances).toEqual({ USD: 75000, EUR: 50000 });

    await ok('POST', `/documents/${usd.document.id}/record-payment`, { payments: [pay(25000, '2026-10-06'), pay(50000, '2026-10-06', 'card')] });
    pr = await ok('GET', `/documents/${usd.document.id}`);
    expect(pr.document.state).toBe('paid');
    expect(pr.document.remaining_minor).toBe(0);
    expect(pr.events.map((e: any) => e.kind)).toEqual(['created', 'finalized', 'payment', 'payment', 'paid']);

    detail = await ok('GET', `/clients/${client}`);
    expect(detail.balances).toEqual({ EUR: 50000 });
    const unpaid = await ok('GET', `/documents?tab=unpaid&clientId=${client}`);
    expect(unpaid.items.map((i: any) => i.id)).toEqual([eur.document.id]);
  });

  it('refuses a payment above the open balance', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(10000)] });
    await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(6000)] });
    const over = await api('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(4001)] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('payment_exceeds_balance');
  });

  it('the database refuses a payment link above the demand total', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(10000)] });
    const receipt = await issue('400', { clientId: client, payments: [pay(20000)] });
    await expect(
      run(db(), "INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 20000, 'ILS')", pr.document.id, receipt.document.id),
    ).rejects.toThrow(/payment_exceeds_balance/);
  });

  it('a receipt in foreign currency takes the BOI rate of the payment date, or the last rate before it', async () => {
    const client = await makeClient({ currency: 'USD' });
    clock.today = '2026-10-06';
    // 2026-10-04 is a Sunday with no rate in the fixture: the Friday rate applies.
    const r = await issue('400', { clientId: client, payments: [pay(10000, '2026-10-04')] });
    const p = r.payments[0];
    expect(p.fx_rate).toBe('3.712000');
    expect(p.fx_rate_date).toBe('2026-10-02');
    expect(p.fx_source).toBe('boi');
    expect(p.amount_ils_minor).toBe(37120);
    expect(r.document.total_ils_minor).toBe(37120);
    expect(r.document.fx_rate).toBe('3.712000');
    // The rate came through R04's rateOn, which backfilled the BOI series before the Sunday.
    expect(fxHistory.calls).toContainEqual({ currency: 'USD', from: '2026-09-20', to: '2026-10-04' });
  });
});

describe('carried rate', () => {
  it('a receipt from a request that carries its agreed rate uses that rate, not the payment-date rate', async () => {
    const client = await makeClient({ currency: 'USD' });
    const pr = await issue('PR', { clientId: client, lines: [line(100000)], overrideRate: '3.5', carryRate: true });
    expect(pr.document.fx_rate).toBe('3.500000');
    expect(pr.document.fx_source).toBe('agreed');
    expect(pr.document.total_ils_minor).toBe(350000);

    const r = await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(40000, '2026-10-05')] });
    expect(r.payments[0].fx_rate).toBe('3.500000');
    expect(r.payments[0].fx_source).toBe('carried');
    expect(r.payments[0].amount_ils_minor).toBe(140000);
    expect(r.document.fx_source).toBe('carried');
    expect(r.links.incoming.map((l: any) => l.kind).sort()).toEqual(['carried_rate', 'payment']);

    // The second partial payment carries the same rate.
    const r2 = await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(60000, '2026-10-06')] });
    expect(r2.payments[0].amount_ils_minor).toBe(210000);
  });

  it('without carry the receipt uses the payment-date rate even when the request shows ILS', async () => {
    const client = await makeClient({ currency: 'USD' });
    const pr = await issue('PR', { clientId: client, lines: [line(100000)], showIls: true });
    expect(pr.document.fx_source).toBe('indicative');
    expect(pr.document.fx_rate).toBe('3.731500');
    const r = await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(100000, '2026-10-05')] });
    expect(r.payments[0].fx_rate).toBe('3.725000');
    expect(r.payments[0].fx_source).toBe('boi');
    expect(r.payments[0].amount_ils_minor).toBe(372500);
  });

  it('refuses carry without a rate', async () => {
    const client = await makeClient({ currency: 'USD' });
    const r = await api('POST', '/documents', { type: 'PR', clientId: client, lines: [line(100)], carryRate: true });
    expect(r.status).toBe(400);
  });
});

describe('instruction 18ב(ד): payment-method restriction under a secured signature', () => {
  it('refuses cash and an uncrossed cheque, allows card, bank transfer and a crossed cheque', async () => {
    const client = await makeClient();
    for (const method of ['cash', 'other']) {
      const r = await api('POST', '/documents', { type: '400', clientId: client, payments: [pay(100, clock.today, method)] });
      expect(r.status, method).toBe(409);
      expect(r.body.error.code).toBe('payment_method_not_allowed');
    }
    const cheque = await api('POST', '/documents', { type: '400', clientId: client, payments: [pay(100, clock.today, 'cheque')] });
    expect(cheque.body.error.code).toBe('payment_method_not_allowed');
    const crossed = await issue('400', { clientId: client, payments: [pay(100, clock.today, 'cheque', { chequeCrossed: true })] });
    expect(crossed.payments[0].cheque_crossed).toBe(1);
    await issue('400', { clientId: client, payments: [pay(100, clock.today, 'card'), pay(100)] });
  });

  it('checks again at finalize when the mode turned secured after the draft', async () => {
    const client = await makeClient();
    await run(db(), "INSERT INTO settings (key, value) VALUES ('signature_mode', 'none')");
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(100, clock.today, 'cash')] });
    await run(db(), "UPDATE settings SET value = 'secured' WHERE key = 'signature_mode'");
    const r = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(r.body.error.code).toBe('payment_method_not_allowed');
    await run(db(), "UPDATE settings SET value = 'none' WHERE key = 'signature_mode'");
    await ok('POST', `/documents/${draft.document.id}/finalize`, {});
    await run(db(), "DELETE FROM settings WHERE key = 'signature_mode'");
  });

  it('keeps payment details frozen once the receipt is final', async () => {
    const client = await makeClient();
    const r = await issue('400', { clientId: client, payments: [pay(100, clock.today, 'cheque', { chequeCrossed: true })] });
    const rows = await all<{ payment_id: number }>(db(), 'SELECT payment_id FROM payment_details WHERE payment_id = ?', r.payments[0].id);
    expect(rows).toHaveLength(1);
    await expect(run(db(), 'UPDATE payment_details SET cheque_crossed = 0 WHERE payment_id = ?', r.payments[0].id)).rejects.toThrow();
    await expect(run(db(), 'DELETE FROM document_meta WHERE document_id = ?', r.document.id)).rejects.toThrow();
  });
});
