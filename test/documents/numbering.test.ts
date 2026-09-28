import { beforeEach, describe, expect, it } from 'vitest';
import { all } from '../../src/core/db';
import { db } from '../helpers';
import { api, ceiling, clock, issue, line, makeClient, ok, pay } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
  ceiling.block = false;
  ceiling.calls = [];
});

async function numbers(type: string): Promise<number[]> {
  const rows = await all<{ number: number }>(db(), 'SELECT number FROM documents WHERE type = ? AND number IS NOT NULL ORDER BY number', type);
  return rows.map((r) => r.number);
}

describe('rule 2: series continuity', () => {
  it('numbers each type in its own series, strictly +1, with no gaps', async () => {
    const client = await makeClient();
    for (let i = 0; i < 3; i++) await issue('400', { clientId: client, payments: [pay(10000)] });
    for (let i = 0; i < 2; i++) await issue('PR', { clientId: client, lines: [line(5000)] });
    expect(await numbers('400')).toEqual([1, 2, 3]);
    expect(await numbers('PR')).toEqual([1, 2]);
  });

  it('a draft has no number and deleting it leaves no gap', async () => {
    const client = await makeClient();
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(10000)] });
    expect(draft.document.number).toBeNull();
    expect(draft.document.display_number).toBeNull();
    await ok('DELETE', `/documents/${draft.document.id}`);
    const before = await numbers('400');
    const next = await issue('400', { clientId: client, payments: [pay(10000)] });
    expect(next.document.number).toBe(before.length + 1);
  });

  it('a finalize the ceiling guard blocks consumes no number', async () => {
    const client = await makeClient();
    const before = await numbers('400');
    ceiling.block = true;
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(20000)] });
    const blocked = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CEILING_CROSSING');
    expect(await numbers('400')).toEqual(before);
    ceiling.block = false;
    const done = await ok('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(done.document.number).toBe(before.length + 1);
  });

  it('calls the ceiling guard with the ILS amount before a receipt is finalized', async () => {
    const client = await makeClient({ currency: 'USD' });
    await issue('400', { clientId: client, payments: [pay(10000, '2026-10-05')] });
    expect(ceiling.calls).toEqual([{ amountIls: 37250, date: '2026-10-06' }]);
    await issue('PR', { clientId: client, lines: [line(5000)] });
    expect(ceiling.calls).toHaveLength(1);
  });
});

describe('finalize idempotency', () => {
  it('finalizing twice returns the same number and consumes one', async () => {
    const client = await makeClient();
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(10000)] });
    const first = await ok('POST', `/documents/${draft.document.id}/finalize`, {});
    const second = await ok('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(second.document.number).toBe(first.document.number);
    expect(second.already_final).toBe(true);
    expect(second.document.hash).toBe(first.document.hash);
    const next = await issue('400', { clientId: client, payments: [pay(10000)] });
    expect(next.document.number).toBe(first.document.number + 1);
  });

  it('two concurrent finalize calls on one draft share one number', async () => {
    const client = await makeClient();
    const draft = await ok('POST', '/documents', { type: '400', clientId: client, payments: [pay(10000)] });
    const [a, b] = await Promise.all([
      api('POST', `/documents/${draft.document.id}/finalize`, {}),
      api('POST', `/documents/${draft.document.id}/finalize`, {}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.document.number).toBe(b.body.document.number);
    const rows = await all(db(), 'SELECT * FROM finalizations WHERE document_id = ?', draft.document.id);
    expect(rows).toHaveLength(1);
  });

  it('finalize writes the hash chain and a timeline event', async () => {
    const client = await makeClient();
    const doc = await issue('PR', { clientId: client, lines: [line(5000)] });
    expect(doc.document.status).toBe('final');
    expect(doc.document.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.document.issuance_date).toBe('2026-10-06');
    expect(doc.events.map((e: any) => e.kind)).toEqual(['created', 'finalized']);
  });
});

describe('document types', () => {
  it('offers the פטור types and keeps 305, 320, 330 and 332 disabled', async () => {
    const { types } = await ok('GET', '/documents/types');
    const enabled = types.filter((t: any) => t.enabled === 1).map((t: any) => t.code);
    const disabled = types.filter((t: any) => t.enabled === 0).map((t: any) => t.code);
    // R18 task 10: PF is disabled, merged into 300.
    expect(enabled).toEqual(['QT', 'PR', '300', '400', '405']);
    // R19: types are listed by menu order (sort_order), so compare the set, not the order.
    expect([...disabled].sort()).toEqual(['305', '320', '330', '332', 'PF']);
    const client = await makeClient();
    const r = await api('POST', '/documents', { type: '305', clientId: client, lines: [line(100)] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('type_disabled');
  });

  it('a credit receipt is created only from the receipt it credits', async () => {
    const client = await makeClient();
    const r = await api('POST', '/documents', { type: '405', clientId: client, payments: [pay(-100)] });
    expect(r.status).toBe(400);
  });
});
