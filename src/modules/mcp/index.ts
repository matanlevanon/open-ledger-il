import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { AuditActor } from '../../core/audit';
import { DomainError, mapDbError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { MCP_TOOLS, type McpEnv, findTool } from './tools';

/**
 * MCP endpoint (PLAN.md's `MCP` module, runs/R14-ops.md): streamable HTTP transport, one tool
 * call per POST, JSON response (no SSE; this server never needs to push a message on its own).
 * Authenticates with the `MCP_TOKEN` bearer secret, never Cloudflare Access, so it is mounted at
 * the top-level `/mcp` path in src/index.ts rather than through the `/api` registry.
 */

/** Constant-time comparison so a wrong MCP_TOKEN guess never leaks timing information. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  // Compare a fixed-length digest of each side instead of the raw (possibly different-length)
  // strings, so the loop below never itself reveals the length of the secret.
  let diff = bufA.length ^ bufB.length;
  const len = Math.max(bufA.length, bufB.length);
  for (let i = 0; i < len; i++) diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  return diff === 0;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'open-ledger-il', version: '1.3.0' };

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
    const token = c.env.MCP_TOKEN;
    const header = c.req.header('Authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !timingSafeEqual(provided, token)) {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'A valid bearer token is required.' } }, 401);
    }
    await next();
  });

  app.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }, 400);
    }
    const env: McpEnv = { db: c.env.DB, actor: mcpActor(c.req.raw.headers) };
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
