import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { run, todayIsrael } from '../../../src/core/db';

const TOKEN = 'test-mcp-token';
const app = createApp();
const testEnv = { ...env, MCP_TOKEN: TOKEN };
const today = todayIsrael();

async function call(name: string, args: unknown) {
  const res = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    },
    testEnv,
  );
  const body = (await res.json()) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
  const text = body.result.content[0]!.text;
  return { isError: body.result.isError === true, data: body.result.isError ? text : (JSON.parse(text) as any) };
}

async function makeClient(nameEn: string): Promise<number> {
  const { lastRowId } = await run(env.DB, "INSERT INTO clients (name_en, currency) VALUES (?, 'ILS')", nameEn);
  return lastRowId;
}

describe('MCP tools (runs/R14-ops.md)', () => {
  it('list_clients finds a client by name and reports its balances', async () => {
    const id = await makeClient(`MCP Client ${crypto.randomUUID().slice(0, 8)}`);
    const { isError, data } = await call('list_clients', { query: `MCP Client` });
    expect(isError).toBe(false);
    expect(data.some((c: any) => c.id === id)).toBe(true);
  });

  it('client_balance reports the open balance for a payment request', async () => {
    const clientId = await makeClient('Balance Test Client');
    const draft = await call('create_draft', {
      type: 'PR',
      clientId,
      lines: [{ description: 'Consulting', unitPriceMinor: 100000 }],
    });
    expect(draft.isError).toBe(false);
    await call('finalize_document', { documentId: draft.data.documentId, confirm: true });

    const balance = await call('client_balance', { clientId });
    expect(balance.isError).toBe(false);
    expect(balance.data.balances.ILS).toBeGreaterThanOrEqual(100000);
  });

  it('create_draft creates a draft with no number', async () => {
    const { isError, data } = await call('create_draft', {
      type: 'PR',
      lines: [{ description: 'Design', unitPriceMinor: 50000 }],
    });
    expect(isError).toBe(false);
    expect(data.status).toBe('draft');
    expect(data.totalMinor).toBe(50000);
  });

  it('finalize_document refuses without confirm: true, and assigns a number with it', async () => {
    const clientId = await makeClient('Finalize Test Client');
    const draft = await call('create_draft', { type: 'PR', clientId, lines: [{ description: 'X', unitPriceMinor: 1000 }] });

    const refused = await call('finalize_document', { documentId: draft.data.documentId });
    expect(refused.isError).toBe(true);
    expect(refused.data).toMatch(/confirm/i);

    const done = await call('finalize_document', { documentId: draft.data.documentId, confirm: true });
    expect(done.isError).toBe(false);
    expect(done.data.number).toBeGreaterThan(0);
  });

  it('record_payment refuses without confirm: true, and finalizes the receipt with it', async () => {
    const clientId = await makeClient('Payment Test Client');
    const draft = await call('create_draft', { type: 'PR', clientId, lines: [{ description: 'Retainer', unitPriceMinor: 200000 }] });
    await call('finalize_document', { documentId: draft.data.documentId, confirm: true });

    const refused = await call('record_payment', {
      documentId: draft.data.documentId,
      payments: [{ method: 'bank_transfer', paidOn: today, amountMinor: 200000 }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.data).toMatch(/confirm/i);

    const done = await call('record_payment', {
      documentId: draft.data.documentId,
      confirm: true,
      payments: [{ method: 'bank_transfer', paidOn: today, amountMinor: 200000 }],
    });
    expect(done.isError).toBe(false);
    expect(done.data.finalized.number).toBeGreaterThan(0);

    const balance = await call('client_balance', { clientId });
    expect(balance.data.balances.ILS ?? 0).toBe(0);
  });

  it('income_report totals final receipts and tax invoices between two dates', async () => {
    const receiptDraft = await call('create_draft', {
      type: '400',
      payments: [{ method: 'cash', paidOn: today, amountMinor: 30000 }],
    });
    await call('finalize_document', { documentId: receiptDraft.data.documentId, confirm: true });

    const { isError, data } = await call('income_report', { from: today, to: today });
    expect(isError).toBe(false);
    const ils = data.byCurrency.find((r: any) => r.currency === 'ILS');
    expect(ils.total_minor).toBeGreaterThanOrEqual(30000);
  });

  it('ceiling_status reports the legal mode', async () => {
    const { isError, data } = await call('ceiling_status', {});
    expect(isError).toBe(false);
    expect(['patur', 'murshe']).toContain(data.legalMode);
  });
});
