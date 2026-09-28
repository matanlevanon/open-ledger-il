import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { db } from '../helpers';
import { api, clock, issue, line, makeAccountant, makeClient, ok, pay } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('links: create from source', () => {
  it('quote to request to receipt copies the client and lines and closes each source', async () => {
    const client = await makeClient({ currency: 'EUR', clientCopyLang: 'bilingual' });
    const qt = await issue('QT', { clientId: client, lines: [line(120000, 'Growth audit'), line(30000, 'Workshop', 500)] });
    expect(qt.document.currency).toBe('EUR');
    expect(qt.document.lang_variant).toBe('bilingual');
    expect(qt.document.total_minor).toBe(135000);

    const prDraft = await ok('POST', `/documents/${qt.document.id}/convert`, { type: 'PR' });
    expect(prDraft.document.status).toBe('draft');
    expect(prDraft.document.client_id).toBe(client);
    expect(prDraft.lines.map((l: any) => l.description_en)).toEqual(['Growth audit', 'Workshop']);
    expect(prDraft.source.id).toBe(qt.document.id);
    // No link until the target is final, so a draft can still be deleted.
    expect(prDraft.links.incoming).toEqual([]);

    const pr = await ok('POST', `/documents/${prDraft.document.id}/finalize`, {});
    expect(pr.links.incoming.map((l: any) => [l.kind, l.other_id])).toEqual([['converted', qt.document.id]]);
    const closedQt = await ok('GET', `/documents/${qt.document.id}`);
    expect(closedQt.document.state).toBe('converted');
    expect(closedQt.events.map((e: any) => e.kind)).toContain('converted');

    const again = await api('POST', `/documents/${qt.document.id}/convert`, { type: 'PR' });
    expect(again.body.error.code).toBe('source_converted');

    const receiptDraft = await ok('POST', `/documents/${pr.document.id}/convert`, { type: '400' });
    expect(receiptDraft.payments[0].amount_minor).toBe(135000);
    expect(receiptDraft.lines).toHaveLength(2);
    const receipt = await ok('POST', `/documents/${receiptDraft.document.id}/finalize`, {});
    expect(receipt.document.total_minor).toBe(135000);
    expect((await ok('GET', `/documents/${pr.document.id}`)).document.state).toBe('paid');
  });

  it('refuses conversions outside the flow and changing the client of a linked draft', async () => {
    const client = await makeClient();
    const receipt = await issue('400', { clientId: client, payments: [pay(100)] });
    const bad = await api('POST', `/documents/${receipt.document.id}/convert`, { type: 'PR' });
    expect(bad.status).toBe(400);
    const pr = await issue('PR', { clientId: client, lines: [line(1000)] });
    const draft = await ok('POST', `/documents/${pr.document.id}/convert`, { type: '400' });
    const other = await makeClient();
    const r = await api('PATCH', `/documents/${draft.document.id}`, { clientId: other });
    expect(r.body.error.code).toBe('client_locked');
    await ok('DELETE', `/documents/${draft.document.id}`);
  });

  it('a request converted to a transaction invoice hands over its balance', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(50000)] });
    const inv = await ok('POST', `/documents/${(await ok('POST', `/documents/${pr.document.id}/convert`, { type: '300' })).document.id}/finalize`, {});
    expect((await ok('GET', `/documents/${pr.document.id}`)).document.state).toBe('converted');
    expect((await ok('GET', `/clients/${client}`)).balances).toEqual({ ILS: 50000 });
    await ok('POST', `/documents/${inv.document.id}/record-payment`, { payments: [pay(50000)] });
    expect((await ok('GET', `/clients/${client}`)).balances).toEqual({});
  });
});

describe('quotes and payment requests stay editable until converted', () => {
  it('a revision replaces the original, which is cancelled with a pointer to the new number', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(10000)] });
    const rev = await ok('POST', `/documents/${pr.document.id}/revise`);
    expect(rev.meta.revises_id).toBe(pr.document.id);
    await ok('PATCH', `/documents/${rev.document.id}`, { lines: [line(12000)] });
    const done = await ok('POST', `/documents/${rev.document.id}/finalize`, {});
    const old = await ok('GET', `/documents/${pr.document.id}`);
    expect(old.document.status).toBe('cancelled');
    expect(old.document.cancel_reason).toBe(`Replaced by ${done.document.display_number}`);
    expect(done.document.total_minor).toBe(12000);
  });

  it('refuses a revision once the request has a payment, or when the setting is off', async () => {
    const client = await makeClient();
    const pr = await issue('PR', { clientId: client, lines: [line(10000)] });
    await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(100)] });
    expect((await api('POST', `/documents/${pr.document.id}/revise`)).body.error.code).toBe('not_revisable');
    const qt = await issue('QT', { clientId: client, lines: [line(10000)] });
    await run(db(), "UPDATE settings SET value = 'false' WHERE key = 'documents.qt_pr_editable_until_converted'");
    expect((await api('POST', `/documents/${qt.document.id}/revise`)).body.error.code).toBe('not_revisable');
    await run(db(), "UPDATE settings SET value = 'true' WHERE key = 'documents.qt_pr_editable_until_converted'");
    const receipt = await issue('400', { clientId: client, payments: [pay(100)] });
    expect((await api('POST', `/documents/${receipt.document.id}/revise`)).body.error.code).toBe('not_revisable');
  });
});

describe('rule 6: role and feature checks', () => {
  it('an accountant reads income documents, never quotes, and never issues', async () => {
    await makeAccountant('cpa-docs@example.com', ['income_documents']);
    const client = await makeClient();
    const qt = await issue('QT', { clientId: client, lines: [line(100)] });
    const pr = await issue('PR', { clientId: client, lines: [line(100)] });
    const list = await api('GET', '/documents', undefined, 'cpa-docs@example.com');
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: any) => i.type === 'QT')).toBe(false);
    expect((await api('GET', `/documents/${qt.document.id}`, undefined, 'cpa-docs@example.com')).status).toBe(403);
    expect((await api('GET', `/documents/${pr.document.id}`, undefined, 'cpa-docs@example.com')).status).toBe(200);
    const write = await api('POST', '/documents', { type: 'PR', clientId: client, lines: [line(1)] }, 'cpa-docs@example.com');
    expect(write.status).toBe(403);
    const logged = await db()
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE user_email = 'cpa-docs@example.com' AND action = 'request'")
      .first<{ n: number }>();
    expect(logged!.n).toBe(4);
  });
});
