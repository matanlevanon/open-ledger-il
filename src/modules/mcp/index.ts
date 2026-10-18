import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { AuditActor } from '../../core/audit';
import { DomainError, mapDbError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { checkMcpToken } from './tokens';
import { MCP_TOOLS, type McpEnv, findTool } from './tools';
import { APP_VERSION } from '../../version';

/**
 * MCP endpoint (PLAN.md's `MCP` module, runs/R14-ops.md): streamable HTTP transport, one tool
 * call per POST, JSON response (no SSE; this server never needs to push a message on its own).
 * Authenticates with a bearer token, never Cloudflare Access, so it is mounted at the top-level
 * `/mcp` path in src/index.ts rather than through the `/api` registry. R34: the token made in
 * Settings > MCP wins over the installer's `MCP_TOKEN` (tokens.ts).
 */

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'open-ledger-il', version: APP_VERSION };

function mcpActor(headers: { get(name: string): string | null }): AuditActor {
  return {
    userId: null,
    email: 'mcp',
    role: 'owner',
    ip: headers.get('CF-Connecting-IP'),
    userAgent: headers.get('User-Agent')?.slice(0, 300) ?? null,
  };
}

function toolErrorMessage(err: unknown): string {
  const mapped = mapDbError(err);
  if (mapped instanceof DomainError) return mapped.message;
  if (mapped instanceof ZodError) return mapped.issues.map((i) => i.message).join('; ') || 'Some fields are not valid.';
  return mapped instanceof Error ? mapped.message : 'Something went wrong.';
}

/** Handles one JSON-RPC message. Returns null for a notification (no id), which gets no reply. */
export async function handleMcpMessage(env: McpEnv, msg: JsonRpcMessage): Promise<Record<string, unknown> | null> {
  const hasId = msg.id !== undefined && msg.id !== null;
  const reply = (result: unknown) => (hasId ? { jsonrpc: '2.0' as const, id: msg.id, result } : null);
  const fail = (code: number, message: string) => (hasId ? { jsonrpc: '2.0' as const, id: msg.id, error: { code, message } } : null);

  switch (msg.method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case 'ping':
      return reply({});
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return reply({ tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: string; arguments?: unknown };
      const tool = params.name ? findTool(params.name) : undefined;
      if (!tool) return fail(-32602, `Unknown tool "${params.name ?? ''}".`);
      try {
        const result = await tool.handler(env, params.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: toolErrorMessage(err) }], isError: true });
      }
    }
    default:
      return fail(-32601, `Unknown method "${msg.method}".`);
  }
}

export function mcpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // R34: one body for every refusal. It never says which check failed.
    if (!provided || !(await checkMcpToken(c.env.DB, c.env.MCP_TOKEN, provided))) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'A valid bearer token is required.' } }, 401);
    }
    await next();
  });

  app.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }, 400);
    }
    // R24: one token, one business per call. X-Business-Id names it, business 1 by default.
    const wanted = Number(c.req.header('X-Business-Id') ?? '1');
    const businessId = Number.isSafeInteger(wanted) && wanted > 0 ? wanted : 1;
    const known = await c.env.DB.prepare('SELECT id FROM businesses WHERE id = ?').bind(businessId).first();
    if (!known) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32602, message: 'Unknown business.' } }, 400);
    const env: McpEnv = { db: c.env.DB, actor: mcpActor(c.req.raw.headers), businessId, bindings: c.env };
    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map((m) => handleMcpMessage(env, m as JsonRpcMessage)))).filter((r) => r !== null);
      return results.length > 0 ? c.json(results) : c.body(null, 202);
    }
    const result = await handleMcpMessage(env, body as JsonRpcMessage);
    return result ? c.json(result) : c.body(null, 202);
  });

  return app;
}

export const mcpModule = { name: 'mcp', basePath: '/mcp', routes: mcpRoutes() };
