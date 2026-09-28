import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, issue, line, makeClient, ok } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

/**
 * R17 task 4 introduced PF as a separate proforma type; R18 task 10 merged it into 300, since the
 * two were the same document in practice. 300 keeps its own series and numbering and takes PF's
 * behaviour; PF is disabled for new documents (document_types.enabled = 0) but an already-final
 * one stays exactly as issued (CLAUDE.md rule 1) and still behaves the same way when converted.
 */
describe('pro forma invoice (type 300, merged with PF in R18 task 10)', () => {
  it('issues in foreign currency with no ILS by default, like a payment request', async () => {
    const client = await makeClient({ currency: 'USD' });
    const pf = await issue('300', { clientId: client, lines: [line(120000, 'Retainer, October')] });
    expect(pf.document.type).toBe('300');
    expect(pf.document.currency).toBe('USD');
    expect(pf.document.total_ils_minor).toBeNull();
    expect(pf.document.allocation_number).toBeNull();
  });

  it('shows ILS when asked, same as a payment request', async () => {
    const client = await makeClient({ currency: 'USD' });
    const draft = await ok('POST', '/documents', { type: '300', clientId: client, lines: [line(120000)], showIls: true });
    expect(draft.document.total_ils_minor).not.toBeNull();
  });

  it('converts to a receipt as a payment, closing its balance', async () => {
    const client = await makeClient();
    const pf = await issue('300', { clientId: client, lines: [line(80000)] });
    const receiptDraft = await ok('POST', `/documents/${pf.document.id}/convert`, { type: '400' });
    expect(receiptDraft.payments[0].amount_minor).toBe(80000);
    await ok('POST', `/documents/${receiptDraft.document.id}/finalize`, {});
    expect((await ok('GET', `/documents/${pf.document.id}`)).document.state).toBe('paid');
  });

  it('never needs an allocation number even above the threshold, unlike a tax invoice', async () => {
    const client = await makeClient({ vatNumber: '123456789' });
    const pf = await issue('300', { clientId: client, lines: [line(10_000_000, 'Large project')] });
    expect(pf.document.status).toBe('final');
    expect(pf.document.allocation_number).toBeNull();
  });

  it('is not a bookkeeping type, so quoting it is not blocked by legal mode', async () => {
    const client = await makeClient();
    const draft = await ok('POST', '/documents', { type: '300', clientId: client, lines: [line(1000)] });
    expect(draft.document.legal_mode).toBe('patur');
  });

  it('rejects an unknown document type the same way it always has', async () => {
    const bad = await api('POST', '/documents', { type: 'ZZ', lines: [line(1000)] });
    expect(bad.status).toBe(404);
  });
});

/**
 * R18 task 10: PF is disabled for new documents. An already-final PF stays exactly as issued and
 * still renders and converts correctly (test/pdf/render.test.ts and CONVERSIONS.PF in
 * src/modules/documents/types.ts, both untouched by this run); constructing one through the full
 * validated create-then-finalize HTTP path is not possible any more by design, so that guarantee
 * is not re-proven here as an end-to-end test.
 */
describe('PF, disabled for new documents (R18 task 10)', () => {
  it('refuses a new PF draft', async () => {
    const client = await makeClient();
    const bad = await api('POST', '/documents', { type: 'PF', clientId: client, lines: [line(1000)] });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('type_disabled');
  });

  it('also refuses finalizing a draft that somehow still names PF', async () => {
    const client = await makeClient();
    const draft = await ok('POST', '/documents', { type: '300', clientId: client, lines: [line(50000)] });
    const { env } = await import('cloudflare:workers');
    const { run } = await import('../../src/core/db');
    await run(env.DB, `UPDATE documents SET type = 'PF' WHERE id = ?`, draft.document.id);
    const bad = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('type_disabled');
  });
});
