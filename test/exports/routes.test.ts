import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { createExportsModule } from '../../src/modules/exports';

function app() {
  return createApp({ modules: [createExportsModule()] });
}

async function api(method: string, path: string, asEmail = 'owner@example.com') {
  return app().request(`/api/exports${path}`, { method }, { ...env, DEV_AUTH_EMAIL: asEmail });
}

describe('exports routes (CLAUDE.md rule 6: every accountant request passes the feature check and writes audit_log)', () => {
  it('the owner can download the unified file as a zip and it logs an export run', async () => {
    const res = await api('GET', '/unified-file?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const runRow = await first<{ kind: string }>(env.DB, `SELECT kind FROM export_runs WHERE kind = 'unified_file' ORDER BY id DESC LIMIT 1`);
    expect(runRow?.kind).toBe('unified_file');
  });

  it('the owner can download the PCN874 export as text', async () => {
    const res = await api('GET', '/pcn874?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('returns the validation report as JSON without generating a download', async () => {
    const res = await api('GET', '/unified-file/report?from=2026-01-01&to=2026-12-31');
    expect(res.status).toBe(200);
    const body = await res.json<{ warnings: string[]; layoutStatus: string }>();
    expect(body.layoutStatus).toBe('stub');
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('an accountant with unified_file on can download it, and the request is audited (owner default features on)', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) SELECT id, 'unified_file', 1 FROM users WHERE email = ?`, email);

    const res = await api('GET', '/unified-file?from=2026-01-01&to=2026-12-31', email);
    expect(res.status).toBe(200);

    const auditRow = await first<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log WHERE user_email = ? AND action = 'exports.unified_file.generate' ORDER BY id DESC LIMIT 1`,
      email,
    );
    expect(auditRow?.action).toBe('exports.unified_file.generate');
  });

  it('refuses an accountant without the unified_file feature', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    const res = await api('GET', '/unified-file?from=2026-01-01&to=2026-12-31', email);
    expect(res.status).toBe(403);
  });

  it('refuses an accountant without the pcn874 feature, even with unified_file on', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) SELECT id, 'unified_file', 1 FROM users WHERE email = ?`, email);
    const res = await api('GET', '/pcn874?from=2026-01-01&to=2026-12-31', email);
    expect(res.status).toBe(403);
  });

  it('rejects a range where "from" is after "to"', async () => {
    const res = await api('GET', '/unified-file?from=2026-12-31&to=2026-01-01');
    expect(res.status).toBe(400);
  });
});
