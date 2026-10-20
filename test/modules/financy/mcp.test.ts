import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { FakeFinancy, TODAY, call as callFinancy, connect, fenv, financyApp, resetFinancy } from './helpers';

/** R40 task 8: the MCP tools bank_activity and bank_balances. */

const TOKEN = 'test-mcp-token';
const app = createApp();

async function tool(name: string, args: unknown = {}) {
  const res = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    },
    { ...fenv, MCP_TOKEN: TOKEN },
  );
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content[0]!.text;
  return { isError: body.result.isError === true, data: body.result.isError ? text : (JSON.parse(text) as any) };
}

describe('R40: MCP bank tools', () => {
  beforeEach(resetFinancy);

  it('both refuse plainly when Financy is not connected', async () => {
    for (const name of ['bank_activity', 'bank_balances']) {
      const res = await tool(name);
      expect(res.isError).toBe(true);
      expect(res.data).toContain('Financy is not connected');
    }
  });

  it('bank_balances returns the accounts, never an owner name or full number', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    const { isError, data } = await tool('bank_balances');
    expect(isError).toBe(false);
    expect(data.map((a: any) => [a.type, a.last4, a.balanceMinor])).toEqual([
      ['CHECKING', '8901', 1410025],
      ['CARD', '9012', -231040],
    ]);
    expect(JSON.stringify(data)).not.toContain('Test Owner Fullname');
  });

  it('bank_activity returns pulled rows with their match status, by month, and only unmatched on request', async () => {
    const { app: fapp } = financyApp(new FakeFinancy());
    await connect(fapp);
    const first = (await callFinancy(fapp, '/transactions')).body.transactions[0];
    await callFinancy(fapp, `/transactions/${first.id}/ignore`, { method: 'POST' });

    const month = await tool('bank_activity', { month: TODAY.slice(0, 7) });
    expect(month.isError).toBe(false);
    expect(month.data.length).toBeGreaterThan(0);
    expect(month.data.every((r: any) => r.date.startsWith(TODAY.slice(0, 7)))).toBe(true);
    expect(month.data.find((r: any) => r.id === first.id).matchStatus).toBe('ignored');

    const open = await tool('bank_activity', { onlyUnmatched: true });
    expect(open.data.every((r: any) => r.matchStatus === 'unmatched')).toBe(true);
    expect(open.data.some((r: any) => r.id === first.id)).toBe(false);
    expect((await tool('bank_activity', { month: '2026-13' })).isError).toBe(true);
  });

  it('R42: bank_activity says the flow of each row, and bank_summary gives the month', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    const rows = (await tool('bank_activity', {})).data;
    expect(rows.every((r: any) => ['normal', 'own_transfer', 'card_payment'].includes(r.flow))).toBe(true);
    const summary = await tool('bank_summary', {});
    expect(summary.isError).toBe(false);
    expect(summary.data.month).toBe(TODAY.slice(0, 7));
    expect(summary.data.liquidity).toEqual({ cash: 1410025, cardsCurrent: 231040, net: 1410025 - 231040 });
    expect(summary.data.notCounted).toEqual({ sum: 0, ownTransfer: 0, cardPayment: 0 });
    expect((await tool('bank_summary', { month: 'not-a-month' })).isError).toBe(true);
  });
});
