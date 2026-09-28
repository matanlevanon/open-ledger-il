import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createReportsModule } from '../../../src/modules/reports';

function app() {
  return createApp({ modules: [createReportsModule()] });
}

async function api(method: string, path: string, asEmail = 'owner@example.com', body?: unknown) {
  return app().request(
    `/api/reports${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: asEmail },
  );
}

describe('reports routes', () => {
  it('returns the income report as JSON for the owner', async () => {
    const res = await api('GET', '/income?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
    const body = await res.json<{ rows: unknown[] }>();
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('downloads income as CSV with the right content type', async () => {
    const res = await api('GET', '/income.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('downloads expenses as XLSX with the right content type', async () => {
    const res = await api('GET', '/expenses.xlsx');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('rejects a range where "from" is after "to"', async () => {
    const res = await api('GET', '/income?from=2026-12-31&to=2026-01-01');
    expect(res.status).toBe(400);
  });

  it('refuses an accountant with every feature on from running a pack manually', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) SELECT id, 'reports', 1 FROM users WHERE email = ?`, email);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) SELECT id, 'monthly_pack', 1 FROM users WHERE email = ?`, email);

    const res = await api('POST', '/packs/run', email, { period: '2026-10' });
    expect(res.status).toBe(403);
  });

  it('refuses a request with no reports feature', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    const res = await api('GET', '/income', email);
    expect(res.status).toBe(403);
  });

  it('returns the client ledgers report as JSON, CSV and XLSX, gated by the reports feature', async () => {
    const json = await api('GET', '/client-ledgers?from=2026-01-01&to=2026-12-31');
    expect(json.status).toBe(200);
    const body = await json.json<{ clients: unknown[] }>();
    expect(Array.isArray(body.clients)).toBe(true);

    const csv = await api('GET', '/client-ledgers.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv');

    const xlsx = await api('GET', '/client-ledgers.xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    expect((await api('GET', '/client-ledgers', email)).status).toBe(403);
  });
});
