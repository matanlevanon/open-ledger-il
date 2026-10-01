import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { db } from '../helpers';
import { api, clock, issue, line, makeClient, ok, pay } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('credit of a partial payment', () => {
  it('credits part of a USD receipt at the receipt rate, then the rest to the exact ILS remainder', async () => {
    const client = await makeClient({ currency: 'USD' });
    const pr = await issue('PR', { clientId: client, lines: [line(100000)] });
    // A typed rate keeps the credit math below on a known rate.
    const receipt = await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(33333, '2026-10-05')], overrideRate: '3.725' });
    expect(receipt.document.fx_rate).toBe('3.725000');
    expect(receipt.document.total_ils_minor).toBe(124165); // 333.33 x 3.725 = 1,241.654 -> 1,241.65

    const c1 = await ok('POST', `/documents/${receipt.document.id}/credit`, { mode: 'partial', amountMinor: 11111, reason: 'Scope cut' });
    expect(c1.document.type).toBe('405');
    expect(c1.document.status).toBe('final');
    expect(c1.document.total_minor).toBe(-11111);
    expect(c1.payments[0].fx_rate).toBe('3.725000');
    expect(c1.payments[0].fx_source).toBe('credited');
    expect(c1.document.total_ils_minor).toBe(-41388); // 111.11 x 3.725 = 413.88475 -> 413.88
    expect(c1.source.id).toBe(receipt.document.id);

    const partly = await ok('GET', `/documents/${receipt.document.id}`);
    expect(partly.document.state).toBe('partially_credited');

    const c2 = await ok('POST', `/documents/${receipt.document.id}/credit`, { mode: 'full' });
    expect(c2.document.total_minor).toBe(-22222);
    // The full remainder lands exactly on the receipt's ILS total.
    expect(c1.document.total_ils_minor + c2.document.total_ils_minor).toBe(-124165);

    const again = await api('POST', `/documents/${receipt.document.id}/credit`, { mode: 'full' });
    expect(again.body.error.code).toBe('fully_credited');
    expect((await ok('GET', `/documents/${receipt.document.id}`)).document.state).toBe('credited');

    // A credit reverses the payment and the charge together, so the request's open balance holds.
    const after = await ok('GET', `/documents/${pr.document.id}`);
    expect(after.document.remaining_minor).toBe(66667);
  });

  it('refuses a partial credit above what is left and credits of non-creditable types', async () => {
    const client = await makeClient();
    const receipt = await issue('400', { clientId: client, payments: [pay(10000)] });
    const over = await api('POST', `/documents/${receipt.document.id}/credit`, { mode: 'partial', amountMinor: 10001 });
    expect(over.body.error.code).toBe('credit_exceeds_document');
    const pr = await issue('PR', { clientId: client, lines: [line(100)] });
    const bad = await api('POST', `/documents/${pr.document.id}/credit`, { mode: 'full' });
    expect(bad.body.error.code).toBe('not_creditable');
  });

  it('numbers credit receipts in their own series', async () => {
    const client = await makeClient();
    const receipt = await issue('400', { clientId: client, payments: [pay(10000)] });
    const c = await ok('POST', `/documents/${receipt.document.id}/credit`, { mode: 'full' });
    expect(c.document.series_id).toBe('405');
    expect(c.document.display_number).toMatch(/^405-\d{4}$/);
    expect(c.lines[0].description_en).toContain(receipt.document.display_number);
  });
});

describe('cancel rules', () => {
  it('cancels an unsent final document with a reason and keeps its number', async () => {
    const client = await makeClient();
    const doc = await issue('300', { clientId: client, lines: [line(5000)] });
    const noReason = await api('POST', `/documents/${doc.document.id}/cancel`, { reason: ' ' });
    expect(noReason.status).toBe(400);
    const c = await ok('POST', `/documents/${doc.document.id}/cancel`, { reason: 'Wrong client' });
    expect(c.document.status).toBe('cancelled');
    expect(c.document.state).toBe('cancelled');
    expect(c.document.cancel_reason).toBe('Wrong client');
    expect(c.document.number).toBe(doc.document.number);
    const twice = await api('POST', `/documents/${doc.document.id}/cancel`, { reason: 'Again' });
    expect(twice.body.error.code).toBe('not_final');
    const next = await issue('300', { clientId: client, lines: [line(5000)] });
    expect(next.document.number).toBe(doc.document.number + 1);
  });

  it('refuses to cancel a sent document or a draft', async () => {
    const client = await makeClient();
    const doc = await issue('400', { clientId: client, payments: [pay(100)] });
    await ok('POST', `/documents/${doc.document.id}/sent`, { channel: 'email', to: 'a@example.com' });
    const r = await api('POST', `/documents/${doc.document.id}/cancel`, { reason: 'Oops' });
    expect(r.body.error.code).toBe('already_sent');
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(100)] });
    const d = await api('POST', `/documents/${draft.document.id}/cancel`, { reason: 'Oops' });
    expect(d.body.error.code).toBe('not_final');
  });

  it('refuses to cancel a request with live receipts, and a cancelled receipt reopens the balance', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(10000)] });
    const receipt = await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(10000)] });
    expect((await ok('GET', `/documents/${pr.document.id}`)).document.state).toBe('paid');
    const blocked = await api('POST', `/documents/${pr.document.id}/cancel`, { reason: 'Deal off' });
    expect(blocked.body.error.code).toBe('has_dependents');
    await ok('POST', `/documents/${receipt.document.id}/cancel`, { reason: 'Payment bounced' });
    const reopened = await ok('GET', `/documents/${pr.document.id}`);
    expect(reopened.document.state).toBe('open');
    expect(reopened.document.remaining_minor).toBe(10000);
    await ok('POST', `/documents/${pr.document.id}/cancel`, { reason: 'Deal off' });
    // The database refuses a payment link to a cancelled source.
    await expect(
      run(db(), "INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 100, 'ILS')", pr.document.id, receipt.document.id),
    ).rejects.toThrow(/source_not_open/);
  });

  it('never edits or deletes a final document', async () => {
    const client = await makeClient();
    const doc = await issue('400', { clientId: client, payments: [pay(100)] });
    const edit = await api('PATCH', `/documents/${doc.document.id}`, { notes: 'x' });
    expect(edit.body.error.code).toBe('not_draft');
    const del = await api('DELETE', `/documents/${doc.document.id}`);
    expect(del.body.error.code).toBe('not_draft');
    await expect(run(db(), 'DELETE FROM document_events WHERE document_id = ?', doc.document.id)).rejects.toThrow(/append-only/);
  });
});

describe('date rules', () => {
  it('refuses a final document dated before the last final document of the same series', async () => {
    clock.today = '2026-10-20';
    const client = await makeClient();
    await issue('300', { clientId: client, lines: [line(100)], date: '2026-10-20' });
    const draft = await ok('POST', '/documents', { type: '300', clientId: client, lines: [line(100)], date: '2026-10-19' });
    const r = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('date_before_last_in_series');
    // Another series is not affected.
    await issue('PR', { clientId: client, lines: [line(100)], date: '2026-10-19' });
  });

  it('the database refuses an out-of-order date even without the API check', async () => {
    const client = await makeClient();
    clock.today = '2026-10-21';
    await issue('PR', { clientId: client, lines: [line(100)], date: '2026-10-21' });
    const draft = await ok('POST', '/documents', { type: 'PR', clientId: client, lines: [line(100)], date: '2026-10-21' });
    await run(db(), 'UPDATE documents SET date = ? WHERE id = ?', '2026-10-20', draft.document.id);
    const { finalizeDocument } = await import('../../src/core/numbering');
    await expect(finalizeDocument(db(), draft.document.id, { actor: { userId: null, email: 't', role: 'owner', ip: null, userAgent: null } })).rejects.toThrow(
      /date_before_last_in_series/,
    );
  });

  it('back-dating more than 3 days needs the owner and a reason, and is logged', async () => {
    clock.today = '2026-11-10';
    const client = await makeClient();
    const within = await issue('400', { clientId: client, payments: [pay(100, '2026-11-07')], date: '2026-11-07' });
    expect(within.document.status).toBe('final');
    const early = await ok('POST', '/documents', { type: '300', clientId: client, lines: [line(100)], date: '2026-11-06' });
    const noReason = await api('POST', `/documents/${early.document.id}/finalize`, {});
    expect(noReason.body.error.code).toBe('backdate_reason_required');
    const done = await ok('POST', `/documents/${early.document.id}/finalize`, { backdateReason: 'Late paperwork' });
    expect(done.document.status).toBe('final');
    expect(done.meta.backdate_reason).toBe('Late paperwork');
    const log = await db()
      .prepare("SELECT details FROM audit_log WHERE action = 'document.backdate' AND entity_id = ?")
      .bind(String(early.document.id))
      .first<{ details: string }>();
    expect(JSON.parse(log!.details)).toEqual({ date: '2026-11-06', reason: 'Late paperwork' });
  });

  it('refuses bookkeeping documents dated in the future and payments after the receipt date', async () => {
    clock.today = '2026-11-10';
    const client = await makeClient();
    // R18 task 10 merged 300 into the (non-bookkeeping) proforma, so a receipt is the type used
    // here to exercise "a bookkeeping document cannot be dated in the future".
    const future = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(100, '2026-11-11')], date: '2026-11-11' });
    expect((await api('POST', `/documents/${future.document.id}/finalize`, {})).status).toBe(400);
    const late = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(100, '2026-11-10')], date: '2026-11-09' });
    expect((await api('POST', `/documents/${late.document.id}/finalize`, {})).status).toBe(400);
  });
});
