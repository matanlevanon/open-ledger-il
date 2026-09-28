import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { AuditActor } from '../../src/core/audit';
import { all, first, run } from '../../src/core/db';
import { ITA_PATHS } from '../../src/modules/ita/config';
import { allocationGate } from '../../src/modules/ita/gate';
import { REFUSED_CLIENT_VAT, insertDocumentRow, setupIta } from './helpers';

const OWNER: AuditActor = { userId: null, email: 'owner@example.com', role: 'owner', ip: '127.0.0.1', userAgent: 'vitest' };

async function allocation(documentId: number) {
  return first<Record<string, unknown>>(env.DB, 'SELECT * FROM ita_allocations WHERE document_id = ?', documentId);
}

describe('allocation rule: Approval', () => {
  it('approved: stores the full number, the short number, and moves the document to final', async () => {
    const { service, addInvoice, docs, mock } = await setupIta();
    const doc = await addInvoice();
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'approved', outcome: 'approved' });
    expect(result.confirmation_number).toMatch(/^\d{26}$/);
    expect(result.short_number).toBe(result.confirmation_number!.slice(-9));
    const stored = docs.docs.get(doc.id)!;
    expect(stored.status).toBe('final');
    expect(stored.allocationNumber).toBe(result.confirmation_number);
    const sent = mock.apiCalls(ITA_PATHS.approval)[0]!.body as Record<string, unknown>;
    expect(sent.invoice_reference_number).toBe(String(doc.number));
    expect(sent.invoice_id).toBe((await allocation(doc.id))?.invoice_id);
    const audits = await all<{ action: string }>(env.DB, "SELECT action FROM audit_log WHERE entity = 'document' AND entity_id = ?", String(doc.id));
    expect(audits.map((a) => a.action)).toContain('ita.allocation.approved');
  });

  it('a second request for an approved document returns the same number without calling the ITA', async () => {
    const { service, addInvoice, mock } = await setupIta();
    const doc = await addInvoice();
    const first = await service.request(doc.id, OWNER);
    const calls = mock.calls.length;
    const again = await service.request(doc.id, OWNER);
    expect(again.confirmation_number).toBe(first.confirmation_number);
    expect(mock.calls).toHaveLength(calls);
  });

  it('a granted number never changes (trigger)', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    await expect(run(env.DB, "UPDATE ita_allocations SET confirmation_number = '999999999999' WHERE document_id = ?", doc.id)).rejects.toThrow();
    await expect(run(env.DB, "UPDATE ita_allocations SET status = 'pending' WHERE document_id = ?", doc.id)).rejects.toThrow();
    await expect(run(env.DB, 'DELETE FROM ita_allocations WHERE document_id = ?', doc.id)).rejects.toThrow();
  });

  it('refuses a document that is not waiting for a number', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice({ status: 'final' });
    await expect(service.request(doc.id, OWNER)).rejects.toMatchObject({ code: 'not_awaiting_allocation' });
  });

  it('460: refused, the document waits for one of the four choices, the number stays used', async () => {
    const { service, addInvoice, mock, docs } = await setupIta();
    mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const doc = await addInvoice({ customerVatNumber: REFUSED_CLIENT_VAT });
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'refused', outcome: 'refused', error_code: '460' });
    expect(docs.docs.get(doc.id)).toMatchObject({ status: 'allocation_refused', number: doc.number });
    await expect(service.request(doc.id, OWNER)).rejects.toMatchObject({ code: 'choice_required' });
  });

  it('461: refused earlier without a decision also asks for a choice', async () => {
    const { service, addInvoice, mock } = await setupIta();
    // The ITA refused this invoice_id earlier and got no decision.
    const next = await addInvoice();
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment) VALUES (?, 'pre-refused', 'sandbox')", next.id);
    mock.invoices.set('pre-refused', { state: 'refused', customer: next.customerVatNumber });
    const result = await service.request(next.id, OWNER);
    expect(result).toMatchObject({ status: 'refused', error_code: '461' });
  });

  it('462: a decision was already sent, no action', async () => {
    const { service, addInvoice, mock } = await setupIta();
    const doc = await addInvoice();
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment) VALUES (?, 'pre-decided', 'sandbox')", doc.id);
    mock.invoices.set('pre-decided', { state: 'decided', decision: 'cancel', customer: doc.customerVatNumber });
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'decided', outcome: 'already_decided', error_code: '462' });
  });

  it('431: wrong VAT number, fix the client record and send again', async () => {
    const { service, addInvoice, docs } = await setupIta();
    const doc = await addInvoice({ customerVatNumber: '514713289' });
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'failed', error_code: '431', fix: 'client_vat' });
    expect(docs.docs.get(doc.id)?.status).toBe('awaiting_allocation');
    docs.docs.get(doc.id)!.customerVatNumber = '514713288';
    expect((await service.request(doc.id, OWNER)).status).toBe('approved');
  });

  it('434: invoice date more than a year back', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice({ date: '2026-01-15' });
    expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'failed', error_code: '434', fix: 'date' });
  });

  it('435: invoice date more than 30 days ahead', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice({ date: '2027-04-15' });
    expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'failed', error_code: '435', fix: 'date' });
  });

  it('446: user_id missing is a config error', async () => {
    const { service, addInvoice, mock } = await setupIta();
    const doc = await addInvoice();
    mock.forceNext(400, (await import('../fixtures/ita/spec-examples')).APPROVAL_446);
    expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'failed', error_code: '446', fix: 'config' });
  });

  it('5xx: ITA down, the document is queued for retry', async () => {
    const { service, addInvoice, docs, mock, clock } = await setupIta();
    const doc = await addInvoice();
    mock.forceNext(500);
    const result = await service.request(doc.id, OWNER);
    expect(result).toMatchObject({ status: 'pending', outcome: 'unavailable' });
    expect(docs.docs.get(doc.id)?.status).toBe('allocation_pending');
    const row = (await allocation(doc.id))!;
    expect(row.next_attempt_at).toBe(new Date(clock.now().getTime() + 15 * 60_000).toISOString());
    expect(row.deadline_at).toBe(new Date(clock.now().getTime() + 24 * 3_600_000).toISOString());
    expect(row.attempts).toBe(1);
  });

  it('network failure or timeout queues the same way', async () => {
    const { service, addInvoice, mock, clock } = await setupIta();
    const doc = await addInvoice();
    await service.tokens.accessToken();
    mock.down = true;
    expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'pending', outcome: 'unavailable' });
    mock.down = false;
    clock.advance(16 * 60_000);
    expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'approved' });
    const attempts = await all<{ outcome: string }>(
      env.DB,
      'SELECT outcome FROM ita_allocation_attempts WHERE allocation_id = (SELECT id FROM ita_allocations WHERE document_id = ?) ORDER BY id',
      doc.id,
    );
    expect(attempts.map((a) => a.outcome)).toEqual(['unavailable', 'approved']);
  });

  it('403, 404, 406 and 422 are config errors', async () => {
    const { service, addInvoice, mock } = await setupIta();
    for (const status of [403, 404, 406, 422]) {
      const doc = await addInvoice();
      mock.forceNext(status);
      expect(await service.request(doc.id, OWNER)).toMatchObject({ status: 'failed', error_code: `http_${status}`, fix: 'config' });
    }
  });

  it('the attempt log keeps no request body and no ID number', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    const rows = await all<Record<string, unknown>>(env.DB, 'SELECT * FROM ita_allocation_attempts');
    const audits = await all<Record<string, unknown>>(env.DB, 'SELECT details FROM audit_log');
    expect(JSON.stringify(rows)).not.toContain('123456782');
    expect(JSON.stringify(audits)).not.toContain('123456782');
  });
});

describe('allocation rule: MultiApproval', () => {
  it('one call for many documents, each gets its own outcome', async () => {
    const { service, addInvoice, mock } = await setupIta();
    mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const a = await addInvoice();
    const b = await addInvoice({ customerVatNumber: REFUSED_CLIENT_VAT });
    const c = await addInvoice({ date: '2025-01-01' });
    const results = await service.requestMany([a.id, b.id, c.id], OWNER);
    expect(mock.apiCalls(ITA_PATHS.multiApproval)).toHaveLength(1);
    expect(mock.apiCalls(ITA_PATHS.approval)).toHaveLength(0);
    const byDoc = new Map(results.map((r) => [r.document_id, r]));
    expect(byDoc.get(a.id)).toMatchObject({ status: 'approved' });
    expect(byDoc.get(b.id)).toMatchObject({ status: 'refused', error_code: '460' });
    expect(byDoc.get(c.id)).toMatchObject({ status: 'failed', error_code: '434' });
    expect((await allocation(a.id))?.source).toBe('multi_api');
  });

  it('a batch where every invoice has wrong data fails each one (400)', async () => {
    const { service, addInvoice, mock } = await setupIta();
    const a = await addInvoice({ date: '2025-01-01' });
    const b = await addInvoice({ date: '2027-12-01' });
    const results = await service.requestMany([a.id, b.id], OWNER);
    expect(mock.apiCalls(ITA_PATHS.multiApproval)[0]!.status).toBe(400);
    expect(results.map((r) => r.error_code).sort()).toEqual(['434', '435']);
  });

  it('5xx on the batch queues every document', async () => {
    const { service, addInvoice, mock } = await setupIta();
    const a = await addInvoice();
    const b = await addInvoice();
    mock.forceNext(503);
    const results = await service.requestMany([a.id, b.id], OWNER);
    expect(results.every((r) => r.status === 'pending')).toBe(true);
  });
});

describe('allocation rule: the four choices after a refusal', () => {
  async function refused() {
    const ctx = await setupIta();
    ctx.mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const doc = await ctx.addInvoice({ customerVatNumber: REFUSED_CLIENT_VAT });
    await ctx.service.request(doc.id, OWNER);
    return { ...ctx, doc };
  }

  it('choice 1 cancel: sends Cancel, cancels the document, records the decision', async () => {
    const { service, doc, docs, mock } = await refused();
    const result = await service.decide(doc.id, 'cancel', OWNER);
    expect(result).toMatchObject({ status: 'decided', decision: 'cancel', outcome: 'decision_sent' });
    expect(mock.apiCalls(ITA_PATHS.decisionCancel)[0]).toMatchObject({ status: 200 });
    expect(docs.docs.get(doc.id)?.status).toBe('cancelled');
  });

  it('choice 2 continue: sends Continue, the document is final without a number and prints the note', async () => {
    const { service, doc, docs, mock } = await refused();
    await service.decide(doc.id, 'continue', OWNER);
    expect(mock.apiCalls(ITA_PATHS.decisionContinue)[0]).toMatchObject({ status: 200 });
    expect(docs.docs.get(doc.id)).toMatchObject({ status: 'final', allocationNumber: null });
    // After Continue a new request asks the owner not to.
    await expect(service.request(doc.id, OWNER)).rejects.toMatchObject({ code: 'not_awaiting_allocation' });
  });

  it('choice 3 reverse charge: zero-VAT copy with action 3 and the same invoice_id, original cancelled', async () => {
    const { service, doc, docs, mock } = await refused();
    const original = await allocation(doc.id);
    const result = await service.decide(doc.id, 'reverse_charge', OWNER);
    expect(result).toMatchObject({ status: 'approved', decision: 'reverse_charge' });
    const call = mock.apiCalls(ITA_PATHS.approval).at(-1)!.body as Record<string, unknown>;
    expect(call).toMatchObject({ action: 3, vat_amount: 0, invoice_id: original?.invoice_id });
    expect(call.invoice_reference_number).not.toBe(String(doc.number));
    const replacement = docs.docs.get(result.replacement_document_id!)!;
    expect(replacement).toMatchObject({ status: 'final', vatAmountMinor: 0, allocationNumber: result.confirmation_number });
    expect(docs.docs.get(doc.id)?.status).toBe('cancelled');
  });

  it('choice 3 is not offered for a 332 advance approval', async () => {
    const ctx = await setupIta();
    ctx.mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const doc = await ctx.addInvoice({ type: '332', customerVatNumber: REFUSED_CLIENT_VAT });
    await ctx.service.request(doc.id, OWNER);
    await expect(ctx.service.decide(doc.id, 'reverse_charge', OWNER)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('choice 4 further objection: sends FurtherObjection, then requests again with the same invoice_id after the hearing', async () => {
    const { service, doc, docs, mock } = await refused();
    const result = await service.decide(doc.id, 'further_objection', OWNER);
    expect(result).toMatchObject({ status: 'decided', decision: 'further_objection' });
    expect(result.hearing_url).toMatch(/^https:\/\/www\.gov\.il\//);
    expect(docs.docs.get(doc.id)?.status).toBe('allocation_refused');
    const invoiceId = String((await allocation(doc.id))?.invoice_id);

    // Hearing not won yet: 462.
    expect(await service.request(doc.id, OWNER)).toMatchObject({ error_code: '462' });
    mock.winHearing(invoiceId);
    const again = await service.request(doc.id, OWNER);
    expect(again).toMatchObject({ status: 'approved' });
    expect((await allocation(doc.id))?.source).toBe('after_hearing');
    expect((mock.apiCalls(ITA_PATHS.approval).at(-1)!.body as Record<string, unknown>).invoice_id).toBe(invoiceId);
  });

  it('463: the ITA has no matching refused invoice', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment, status) VALUES (?, 'unknown-id', 'sandbox', 'refused')", doc.id);
    await expect(service.decide(doc.id, 'cancel', OWNER)).rejects.toMatchObject({ code: 'ita_decision_rejected' });
  });

  it('a choice without a refusal is refused', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    await expect(service.decide(doc.id, 'cancel', OWNER)).rejects.toMatchObject({ code: 'no_refusal' });
  });
});

describe('manual entry from the ITA web app', () => {
  it('saves the number with its source and moves the document to final', async () => {
    const { service, addInvoice, docs, mock } = await setupIta();
    const doc = await addInvoice();
    mock.forceNext(500);
    await service.request(doc.id, OWNER);
    const result = await service.enterManual(doc.id, '2027 0301 1234 5678 9012 34', 'Web app, ITA outage 1 Mar', OWNER);
    expect(result).toMatchObject({ status: 'approved', outcome: 'manual', short_number: '678901234' });
    const row = (await allocation(doc.id))!;
    expect(row).toMatchObject({ source: 'manual_web_app', source_note: 'Web app, ITA outage 1 Mar', confirmation_number: '2027030112345678901234' });
    expect(row.short_number).toBe('678901234');
    expect(docs.docs.get(doc.id)?.status).toBe('final');
    const audit = await first<{ details: string }>(env.DB, "SELECT details FROM audit_log WHERE action = 'ita.allocation.manual' AND entity_id = ?", String(doc.id));
    expect(JSON.parse(audit!.details)).toMatchObject({ source: 'manual_web_app', short_number: '678901234' });
  });

  it('refuses a number with fewer than 9 digits', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await expect(service.enterManual(doc.id, '12345', '', OWNER)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('refuses a second number for an approved document', async () => {
    const { service, addInvoice } = await setupIta();
    const doc = await addInvoice();
    await service.request(doc.id, OWNER);
    await expect(service.enterManual(doc.id, '123456789', '', OWNER)).rejects.toMatchObject({ code: 'not_awaiting_allocation' });
  });
});

describe('rule 3: no PDF before a number or a recorded decision', () => {
  it('blocks documents waiting for a number or a choice, allows granted and continued ones', async () => {
    const waiting = await insertDocumentRow('awaiting_allocation');
    expect(await allocationGate(env.DB, waiting)).toMatchObject({ allowed: false, reason: 'waiting_for_number' });
    const pending = await insertDocumentRow('allocation_pending');
    expect(await allocationGate(env.DB, pending)).toMatchObject({ allowed: false, reason: 'waiting_for_number' });
    const refused = await insertDocumentRow('allocation_refused');
    expect(await allocationGate(env.DB, refused)).toMatchObject({ allowed: false, reason: 'waiting_for_choice' });

    // Final rows cannot be built without R11's migration, so the allocation row stands in.
    const granted = await insertDocumentRow('draft');
    await run(
      env.DB,
      "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, confirmation_number, short_number) VALUES (?, 'g', 'sandbox', 'approved', '20270301000000000123456789', '123456789')",
      granted,
    );
    expect(await allocationGate(env.DB, granted)).toMatchObject({ allowed: true, reason: 'number_granted', short_number: '123456789' });

    const continued = await insertDocumentRow('draft');
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, decision) VALUES (?, 'c', 'sandbox', 'decided', 'continue')", continued);
    expect(await allocationGate(env.DB, continued)).toMatchObject({ allowed: true, print_note: 'no_input_vat' });

    const objected = await insertDocumentRow('draft');
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, decision) VALUES (?, 'o', 'sandbox', 'decided', 'further_objection')", objected);
    expect(await allocationGate(env.DB, objected)).toMatchObject({ allowed: false, reason: 'waiting_for_choice' });

    const queued = await insertDocumentRow('draft');
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment, status) VALUES (?, 'q', 'sandbox', 'stalled')", queued);
    expect(await allocationGate(env.DB, queued)).toMatchObject({ allowed: false, reason: 'waiting_for_number' });
  });

  it('a reverse-charge replacement is released with the reverse charge note', async () => {
    const original = await insertDocumentRow('draft');
    const replacement = await insertDocumentRow('draft');
    await run(
      env.DB,
      `INSERT INTO ita_allocations (document_id, invoice_id, environment, status, decision, confirmation_number, short_number, replacement_document_id)
       VALUES (?, 'r', 'sandbox', 'approved', 'reverse_charge', '20270301000000000987654321', '987654321', ?)`,
      original,
      replacement,
    );
    expect(await allocationGate(env.DB, replacement)).toMatchObject({ allowed: true, print_note: 'reverse_charge', short_number: '987654321' });
  });
});
