import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { FakePdfEngine } from '../../src/modules/pdf/engine';
import { assertClientCopyMayRelease, loadRenderDocument, renderAndStore } from '../../src/modules/pdf/store';
import { insertClient, insertDocument } from '../fixtures/pdf/db';
import { OWNER_ACTOR, makeSeries } from '../helpers';
import { insertDocumentRow } from '../ita/helpers';

/**
 * CLAUDE.md rule 3: no PDF of a qualifying tax invoice leaves the system before an allocation
 * number or a recorded refusal decision. The client-copy check calls R12's `allocationGate`.
 */
describe('rule 3: the client copy goes through R12 allocationGate', () => {
  it('refuses the client copy while the invoice waits for its allocation number', async () => {
    const waiting = await insertDocumentRow('awaiting_allocation');
    await expect(assertClientCopyMayRelease(env.DB, waiting, 'client')).rejects.toMatchObject({
      code: 'allocation_required',
      status: 409,
      details: { reason: 'waiting_for_number' },
    });
    const pending = await insertDocumentRow('allocation_pending');
    await expect(assertClientCopyMayRelease(env.DB, pending, 'client')).rejects.toMatchObject({ details: { reason: 'waiting_for_number' } });
  });

  it('refuses the client copy after a refusal until a decision is recorded', async () => {
    const refused = await insertDocumentRow('allocation_refused');
    await expect(assertClientCopyMayRelease(env.DB, refused, 'client')).rejects.toMatchObject({ details: { reason: 'waiting_for_choice' } });
  });

  it('allows the client copy once an allocation number is on record', async () => {
    const granted = await insertDocumentRow('draft');
    await run(
      env.DB,
      "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, confirmation_number, short_number) VALUES (?, 'pdf-g', 'sandbox', 'approved', '20270301000000000123456789', '123456789')",
      granted,
    );
    expect(await assertClientCopyMayRelease(env.DB, granted, 'client')).toMatchObject({ allowed: true, reason: 'number_granted' });
  });

  it('allows the client copy once the decision to continue is on record', async () => {
    const continued = await insertDocumentRow('draft');
    await run(
      env.DB,
      "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, decision) VALUES (?, 'pdf-c', 'sandbox', 'decided', 'continue')",
      continued,
    );
    expect(await assertClientCopyMayRelease(env.DB, continued, 'client')).toMatchObject({ allowed: true, print_note: 'no_input_vat' });
  });

  it('never blocks the filed copy, the internal audit record', async () => {
    const waiting = await insertDocumentRow('awaiting_allocation');
    expect(await assertClientCopyMayRelease(env.DB, waiting, 'filed')).toBeNull();
  });

  it('allows a document with no allocation request', async () => {
    const plain = await insertDocumentRow('draft', '300', { vat: 0 });
    expect(await assertClientCopyMayRelease(env.DB, plain, 'client')).toMatchObject({ allowed: true, reason: 'not_requested' });
  });

  it('renderAndStore refuses the client copy of a final document the gate holds, and stores the filed copy', async () => {
    const seriesId = await makeSeries();
    const draftId = await insertDocument(seriesId, { clientId: await insertClient() });
    await finalizeDocument(env.DB, draftId, { actor: OWNER_ACTOR });
    await run(env.DB, "INSERT INTO ita_allocations (document_id, invoice_id, environment, status) VALUES (?, 'pdf-p', 'sandbox', 'pending')", draftId);

    const engine = new FakePdfEngine();
    await expect(renderAndStore(env.DB, env.FILES, engine, draftId, 'client', { ownerTaxId: null })).rejects.toMatchObject({
      code: 'allocation_required',
    });
    const filed = await renderAndStore(env.DB, env.FILES, engine, draftId, 'filed', { ownerTaxId: null });
    expect(filed.key).toMatch(/-filed\.pdf$/);
  });

  /**
   * R11 (docs/israel-invoices-api.md §7): a qualifying tax invoice is numbered but not yet
   * `final` while it waits for its allocation number. The filed copy, the internal audit record,
   * is still allowed to render and store, the same as it always was for a `final` document.
   */
  it('stores the filed copy of a numbered document that is still awaiting_allocation', async () => {
    const seriesId = await makeSeries();
    const waiting = await insertDocument(seriesId, { clientId: await insertClient() });
    await finalizeDocument(env.DB, waiting, { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const engine = new FakePdfEngine();
    const filed = await renderAndStore(env.DB, env.FILES, engine, waiting, 'filed', { ownerTaxId: null });
    expect(filed.key).toMatch(/-filed\.pdf$/);
    await expect(renderAndStore(env.DB, env.FILES, engine, waiting, 'client', { ownerTaxId: null })).rejects.toMatchObject({
      code: 'allocation_required',
    });
  });

  it('loadRenderDocument carries the gate print_note through to the render', async () => {
    const continued = await insertDocumentRow('draft');
    await run(
      env.DB,
      "INSERT INTO ita_allocations (document_id, invoice_id, environment, status, decision) VALUES (?, 'pdf-note', 'sandbox', 'decided', 'continue')",
      continued,
    );
    const doc = await loadRenderDocument(env.DB, continued, 'client', { ownerTaxId: null });
    expect(doc.printNote).toBe('no_input_vat');
  });
});
