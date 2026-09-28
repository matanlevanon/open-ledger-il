import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';

const TOKEN = 'test-mcp-token';
const app = createApp();
const testEnv = { ...env, MCP_TOKEN: TOKEN };

async function rpc(body: unknown, token: string | null = TOKEN) {
  const res = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token !== null ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    },
    testEnv,
  );
  return res;
}

describe('POST /mcp: auth (runs/R14-ops.md: bearer secret MCP_TOKEN)', () => {
  it('refuses a request with no bearer token', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, null);
    expect(res.status).toBe(401);
  });

  it('refuses a request with the wrong token', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'not-the-token');
    expect(res.status).toBe(401);
  });

  it('refuses every request when MCP_TOKEN is not configured', async () => {
    const res = await app.request(
      '/mcp',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) },
      { ...env, MCP_TOKEN: undefined },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /mcp: protocol', () => {
  it('answers initialize with the tools capability', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('open-ledger-il');
  });

  it('lists every tool from runs/R14-ops.md with a name, description and input schema', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const body = (await res.json()) as any;
    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      ['ceiling_status', 'client_balance', 'create_draft', 'finalize_document', 'income_report', 'list_clients', 'record_payment'].sort(),
    );
    for (const tool of body.result.tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('sends no reply to a notification (no id)', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('reports an unknown method as a JSON-RPC error', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'not/a/method' });
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32601);
  });

  it('reports an unknown tool as a JSON-RPC error', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } });
    const body = (await res.json()) as any;
    expect(body.error.code).toBe(-32602);
  });
});
