import { beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_VAT, REFUSED_CLIENT_VAT } from '../ita/helpers';
import { buildE2eApp, connectIta, makeClient, ok } from './helpers';

/**
 * The real עוסק מורשה + ITA allocation flow end to end: `POST /documents/:id/finalize` (real
 * documents module) auto-opens the allocation request through a REAL `ItaAllocationService`
 * against a fake ITA server (`MockIta`), and the four refusal choices are exercised through the
 * real `POST /ita/allocations/:id/decision` HTTP route, not by calling the service class
 * directly the way test/ita/allocation.test.ts does with a synthetic, directly-inserted document
 * row. This is what docs/israel-invoices-api.md section 6's "four choices" and R15's own brief
 * ("refused allocation with each of the four choices") ask for as end-to-end coverage.
 *
 * One shared app for the whole file: the עוסק מורשה switch (PLAN.md decision 2) and the ITA
 * connection each happen once, ever, against the D1 instance this test file owns.
 */

const TODAY = '2026-11-20';

const app = buildE2eApp({ today: () => TODAY });

beforeAll(async () => {
  await ok(app, 'POST', '/legal-mode/switch', { effectiveDate: TODAY, reason: 'test setup' });
  await connectIta(app);
});

async function refusedDocument(): Promise<number> {
  app.mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
  const client = await makeClient(app, { vatNumber: REFUSED_CLIENT_VAT });
  const draft = await ok(app, 'POST', '/documents', { type: '305', clientId: client, lines: [{ description: 'Refused invoice', unitPriceMinor: 700000 }] });
  const out = await ok(app, 'POST', `/documents/${draft.document.id}/finalize`, {});
  // The auto-request inside finalize is awaited synchronously (src/modules/documents/service.ts),
  // so a refusal is already reflected by the time finalize returns, not left at awaiting_allocation.
  expect(out.document.status).toBe('allocation_refused');
  return out.document.id as number;
}

describe('a real above-threshold 305 auto-requests, and the ITA approves it', () => {
  it('finalize opens the request automatically and the document ends up final with the granted number', async () => {
    const client = await makeClient(app, { vatNumber: CLIENT_VAT });
    const draft = await ok(app, 'POST', '/documents', { type: '305', clientId: client, lines: [{ description: 'Large retainer', unitPriceMinor: 600000 }] });
    const out = await ok(app, 'POST', `/documents/${draft.document.id}/finalize`, {});

    // The auto-request already ran inside finalize (src/modules/documents/service.ts awaits it),
    // so the document is already final with a real granted allocation number by the time the
    // HTTP call returns -- no polling needed.
    expect(out.document.status).toBe('final');
    expect(out.document.allocation_number).toMatch(/^\d+$/);

    const overview = await ok(app, 'GET', '/ita/allocations/' + draft.document.id);
    expect(overview.allocation).toMatchObject({ status: 'approved' });
    expect(overview.gate).toMatchObject({ allowed: true, reason: 'number_granted' });
  });
});

describe('a refused allocation: the real four choices through POST /ita/allocations/:id/decision', () => {
  it('choice 1, cancel: the document is really cancelled through the documents module', async () => {
    const documentId = await refusedDocument();

    const result = await ok(app, 'POST', `/ita/allocations/${documentId}/decision`, { choice: 'cancel' });
    expect(result.result).toMatchObject({ status: 'decided', decision: 'cancel' });

    const doc = await ok(app, 'GET', `/documents/${documentId}`);
    expect(doc.document.status).toBe('cancelled');
    // CLAUDE.md rule 1: cancel marks it, never deletes it. The number stays used, no gap.
    expect(doc.document.number).not.toBeNull();
  });

  it('choice 2, continue: final with no allocation number, and the allocation gate prints the no-input-VAT note', async () => {
    const documentId = await refusedDocument();

    const result = await ok(app, 'POST', `/ita/allocations/${documentId}/decision`, { choice: 'continue' });
    expect(result.result).toMatchObject({ status: 'decided', decision: 'continue' });

    const doc = await ok(app, 'GET', `/documents/${documentId}`);
    expect(doc.document.status).toBe('final');
    expect(doc.document.allocation_number).toBeNull();

    const overview = await ok(app, 'GET', `/ita/allocations/${documentId}`);
    expect(overview.gate).toMatchObject({ allowed: true, print_note: 'no_input_vat' });

    // A fresh request after Continue is refused: the choice already closed this document's case.
    const again = await app.instance.request(
      `/api/ita/allocations/${documentId}/request`,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      { ...app.ienv, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(again.status).toBe(409);
  });

  it('choice 3, reverse charge: known gap -- D1AllocationDocuments.createReverseChargeReplacement is not yet wired to the real documents module (docs/progress.md, R13 follow-ups)', async () => {
    const documentId = await refusedDocument();

    const raw = await app.instance.request(
      `/api/ita/allocations/${documentId}/decision`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'reverse_charge' }) },
      { ...app.ienv, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    // Today this is a 409 reverse_charge_unavailable, not a working replacement invoice: the real
    // builder is still a tracked follow-up (docs/progress.md: "Build the reverse-charge
    // replacement builder and wire it into D1AllocationDocuments.createReverseChargeReplacement").
    // This test pins that known behaviour so a future run's fix shows up as a test change, not a
    // silent regression either way.
    expect(raw.status).toBe(409);
    const body = await raw.json<any>();
    expect(body.error.code).toBe('reverse_charge_unavailable');

    // The document is left exactly where it was: still awaiting the owner's choice, not cancelled
    // or half-migrated.
    const doc = await ok(app, 'GET', `/documents/${documentId}`);
    expect(doc.document.status).toBe('allocation_refused');
  });

  it('choice 4, further objection: hearing_url is returned, and a won hearing lets a fresh request succeed', async () => {
    const documentId = await refusedDocument();

    const result = await ok(app, 'POST', `/ita/allocations/${documentId}/decision`, { choice: 'further_objection' });
    expect(result.result).toMatchObject({ status: 'decided', decision: 'further_objection' });
    expect(result.result.hearing_url).toMatch(/^https:\/\/www\.gov\.il\//);

    const stillRefused = await ok(app, 'GET', `/documents/${documentId}`);
    expect(stillRefused.document.status).toBe('allocation_refused');

    const overview = await ok(app, 'GET', `/ita/allocations/${documentId}`);
    const invoiceId = overview.allocation.invoice_id as string;
    app.mock.winHearing(invoiceId);

    const retried = await ok(app, 'POST', `/ita/allocations/${documentId}/request`, {});
    expect(retried.result).toMatchObject({ status: 'approved' });
    const won = await ok(app, 'GET', `/documents/${documentId}`);
    expect(won.document.status).toBe('final');
    expect(won.document.allocation_number).toMatch(/^\d+$/);
  });
});
