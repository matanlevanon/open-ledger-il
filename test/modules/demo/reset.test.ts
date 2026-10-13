import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { recordConsent, upsertLead } from '../../../src/modules/demo/leads';
import { runReset } from '../../../src/modules/demo/reset';
import { ensureMasters } from '../../../src/modules/demo/sample';
import { openSandbox } from '../../../src/modules/demo/sandbox';
import { demoTestEnv } from './helpers';

/**
 * R26 task 9: the nightly reset against a local D1 with two sandboxes. Sandboxes go, masters stay
 * byte for byte, every trigger comes back exactly, leads and consents stay, and a failure in the
 * middle leaves everything as it was.
 */
const env = demoTestEnv();
const notifier = { messages: [] as string[], async send(t: string) { this.messages.push(t); return true; } };
let masters: number[] = [];

async function tablesWithBusinessId(): Promise<string[]> {
  const names = (await all<{ name: string }>(env.DB, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")).map((r) => r.name);
  const out: string[] = [];
  for (const n of names) if ((await all<{ name: string }>(env.DB, `SELECT name FROM pragma_table_info('${n}')`)).some((c) => c.name === 'business_id')) out.push(n);
  return out;
}

/** Every master row of every business-scoped table, as JSON, read independently of the reset code. */
async function masterRows(): Promise<string> {
  const parts: string[] = [];
  for (const t of await tablesWithBusinessId()) {
    const rows = await all(env.DB, `SELECT * FROM "${t}" WHERE business_id IN (${masters.join(',')}) ORDER BY rowid`);
    parts.push(`${t}:${JSON.stringify(rows)}`);
  }
  const businesses = await all(env.DB, `SELECT * FROM businesses WHERE id IN (${masters.join(',')}) ORDER BY id`);
  return `${parts.join('\n')}\nbusinesses:${JSON.stringify(businesses)}`;
}

const triggerList = async () => JSON.stringify(await all(env.DB, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name"));
const leadsAndConsents = async () => JSON.stringify([await all(env.DB, 'SELECT * FROM demo_leads ORDER BY id'), await all(env.DB, 'SELECT * FROM demo_consents ORDER BY id')]);

async function sandbox(email: string) {
  const lead = await upsertLead(env.DB, { name: email, email, ip: null, userAgent: null });
  await recordConsent(env, lead, true, 'en', null);
  const s = await openSandbox(env, { notifier }, lead.id);
  const ids = JSON.parse(s.business_ids) as number[];
  await env.FILES.put(`business/${ids[0]}/documents/visitor-file.pdf`, '%PDF-1.4 visitor');
  return ids;
}

beforeAll(async () => {
  masters = (await ensureMasters({ env })).businessIds;
}, 120_000);

describe('the nightly reset', () => {
  it('removes two sandboxes and keeps masters, triggers, leads and consents exactly', async () => {
    const a = await sandbox('one@example.com');
    const b = await sandbox('two@example.com');
    const sandboxIds = [...a, ...b];
    const beforeMasters = await masterRows();
    const beforeTriggers = await triggerList();
    const beforeLeads = await leadsAndConsents();
    const masterFiles = (await env.FILES.list({ prefix: `business/${masters[0]}/` })).objects.length;
    expect(masterFiles).toBeGreaterThan(0);

    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test', notifier });
    expect(result.message).toContain('sandboxes removed');
    expect(result).toMatchObject({ ok: true, sandboxesRemoved: 2, mastersUnchanged: true });
    expect(result.triggersAfter).toBe(result.triggersBefore);

    // Sandboxes gone, in every business-scoped table.
    expect((await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM businesses WHERE id IN (${sandboxIds.join(',')})`))!.n).toBe(0);
    for (const t of await tablesWithBusinessId()) {
      expect((await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM "${t}" WHERE business_id IN (${sandboxIds.join(',')})`))!.n, t).toBe(0);
    }
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sandboxes'))!.n).toBe(0);
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM users WHERE email LIKE 'visitor-%'"))!.n).toBe(0);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM document_lines WHERE document_id NOT IN (SELECT id FROM documents)'))!.n).toBe(0);
    expect((await env.FILES.list({ prefix: `business/${a[0]}/` })).objects).toHaveLength(0);

    // Masters byte for byte, triggers exactly, leads and consents untouched, master files kept.
    expect(await masterRows()).toBe(beforeMasters);
    expect(await triggerList()).toBe(beforeTriggers);
    expect(await leadsAndConsents()).toBe(beforeLeads);
    expect((await env.FILES.list({ prefix: `business/${masters[0]}/` })).objects.length).toBe(masterFiles);
    const last = (await first<{ ok: number; sandboxes_removed: number }>(env.DB, 'SELECT ok, sandboxes_removed FROM demo_resets ORDER BY id DESC LIMIT 1'))!;
    expect(last).toEqual({ ok: 1, sandboxes_removed: 2 });
    // The locks work again after the reset.
    const doc = (await first<{ id: number }>(env.DB, `SELECT id FROM documents WHERE business_id = ? AND status = 'final' LIMIT 1`, masters[0]))!.id;
    await expect(run(env.DB, 'DELETE FROM documents WHERE id = ?', doc)).rejects.toThrow();
  });

  it('a failure in the middle rolls everything back, alerts Slack and records the failure', async () => {
    const ids = await sandbox('three@example.com');
    const beforeMasters = await masterRows();
    const beforeTriggers = await triggerList();
    const beforeSandboxRows = JSON.stringify(await all(env.DB, `SELECT id FROM documents WHERE business_id IN (${ids.join(',')}) ORDER BY id`));
    notifier.messages = [];

    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test', notifier, failInside: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Rolled back');
    expect(notifier.messages.some((m) => m.includes('rolled back'))).toBe(true);

    expect(await masterRows()).toBe(beforeMasters);
    expect(await triggerList()).toBe(beforeTriggers);
    expect(JSON.stringify(await all(env.DB, `SELECT id FROM documents WHERE business_id IN (${ids.join(',')}) ORDER BY id`))).toBe(beforeSandboxRows);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sandboxes'))!.n).toBe(1);
    expect((await env.FILES.list({ prefix: `business/${ids[0]}/` })).objects.length).toBeGreaterThan(0);
    expect((await first<{ ok: number }>(env.DB, 'SELECT ok FROM demo_resets ORDER BY id DESC LIMIT 1'))!.ok).toBe(0);
  });
});
