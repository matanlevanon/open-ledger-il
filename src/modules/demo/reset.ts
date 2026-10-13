import { all, first, nowIso, run } from '../../core/db';
import type { Notifier } from '../ita/notify';

/**
 * R26 task 9: the nightly reset. Removes every visitor sandbox and keeps everything else exactly.
 *
 * One D1 batch, which is one transaction:
 *   1. read every trigger's SQL from sqlite_master (before the batch)
 *   2. drop the triggers
 *   3. delete every row of a sandbox business, child tables first, in every business-scoped table
 *   4. delete the sandbox businesses, their sessions and their synthetic users
 *   5. recreate every trigger from the saved SQL, exactly
 *   6. check inside the transaction that the triggers and every master row are byte for byte what
 *      they were: a failed check breaks a CHECK constraint, and the whole batch rolls back
 * Then the sandbox files go from the bucket, and the result goes to demo_resets.
 *
 * Never touched: demo_leads, demo_consents, demo_lead_events, demo_codes, demo_usage, demo_resets,
 * the master businesses and everything in them, business 1, and every shared table.
 */

/** Tables a reset never deletes from, whatever their columns. */
const KEEP = new Set([
  'businesses',
  'demo_master_businesses',
  'demo_leads',
  'demo_consents',
  'demo_lead_events',
  'demo_codes',
  'demo_usage',
  'demo_resets',
  'demo_reset_guard',
  'demo_sessions',
  'demo_sandboxes',
  'users',
  'settings',
  'd1_migrations',
  '_cf_KV',
  'sqlite_sequence',
]);

interface TableInfo {
  name: string;
  columns: string[];
  hasBusinessId: boolean;
  /** Foreign keys to other tables: [column, parent table, parent column]. */
  fks: [string, string, string][];
}

async function tables(db: D1Database): Promise<TableInfo[]> {
  const names = (await all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map((r) => r.name);
  const out: TableInfo[] = [];
  for (const name of names) {
    const columns = (await all<{ name: string }>(db, `SELECT name FROM pragma_table_info('${name}')`)).map((c) => c.name);
    const fks = (await all<{ from: string; table: string; to: string | null }>(db, `SELECT "from", "table", "to" FROM pragma_foreign_key_list('${name}')`)).map(
      (f) => [f.from, f.table, f.to ?? 'id'] as [string, string, string],
    );
    out.push({ name, columns, hasBusinessId: columns.includes('business_id'), fks });
  }
  return out;
}

/**
 * The SQL condition that picks a table's sandbox rows, or null when the table holds none. A table
 * with business_id picks by it. A child table without one picks by its parent's condition.
 */
function conditionFor(t: TableInfo, byName: Map<string, TableInfo>, ids: string, seen = new Set<string>()): string | null {
  if (KEEP.has(t.name)) return null;
  if (t.hasBusinessId) return `business_id IN (${ids})`;
  if (seen.has(t.name)) return null;
  seen.add(t.name);
  const parts: string[] = [];
  for (const [col, parent, to] of t.fks) {
    const p = byName.get(parent);
    if (!p || p.name === t.name) continue;
    const cond = parent === 'businesses' ? `id IN (${ids})` : conditionFor(p, byName, ids, new Set(seen));
    if (cond) parts.push(`${col} IN (SELECT ${to} FROM ${parent} WHERE ${cond})`);
  }
  return parts.length ? parts.join(' OR ') : null;
}

/** Depth from a business-scoped root: children delete before their parents. */
function depthOf(t: TableInfo, byName: Map<string, TableInfo>, seen = new Set<string>()): number {
  if (seen.has(t.name)) return 0;
  seen.add(t.name);
  let d = 0;
  for (const [, parent] of t.fks) {
    const p = byName.get(parent);
    if (p && p.name !== t.name && conditionFor(p, byName, '0')) d = Math.max(d, depthOf(p, byName, new Set(seen)) + 1);
  }
  return d;
}

/** A text snapshot of every master row, column by column, in rowid order. Compared inside the batch. */
function masterSnapshotSql(t: TableInfo, masterIds: string): string | null {
  if (!t.hasBusinessId || masterIds === '') return null;
  const cols = t.columns.map((c) => `quote("${c}")`).join(" || ',' || ");
  return `SELECT COALESCE(group_concat(r, '|'), '') AS s FROM (SELECT ${cols} AS r FROM "${t.name}" WHERE business_id IN (${masterIds}) ORDER BY rowid)`;
}

export interface ResetResult {
  ok: boolean;
  sandboxesRemoved: number;
  businessesRemoved: number[];
  triggersBefore: number;
  triggersAfter: number;
  mastersUnchanged: boolean;
  filesRemoved: number;
  message: string;
}

export interface ResetDeps {
  db: D1Database;
  files: R2Bucket;
  notifier?: Notifier;
  trigger?: 'cron' | 'admin' | 'test';
  /** Tests only: a statement that fails in the middle of the batch, to prove the rollback. */
  failInside?: boolean;
}

export async function runReset(deps: ResetDeps): Promise<ResetResult> {
  const { db } = deps;
  const startedAt = nowIso();
  const masters = (await all<{ business_id: number }>(db, 'SELECT business_id FROM demo_master_businesses')).map((r) => r.business_id);
  const keepIds = [1, ...masters];
  const sandboxIds = (await all<{ id: number }>(db, `SELECT id FROM businesses WHERE id NOT IN (${keepIds.join(',')}) ORDER BY id`)).map((r) => r.id);
  const sandboxCount = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM demo_sandboxes'))!.n;
  const triggers = await all<{ name: string; sql: string }>(db, "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
  const triggerFingerprint = triggers.map((t) => `${t.name}\u0001${t.sql}`).join('\u0002');
  const info = await tables(db);
  const byName = new Map(info.map((t) => [t.name, t]));
  const masterList = masters.join(',');

  // Snapshot every master row now, to compare inside the transaction.
  const snapshots: { sql: string; value: string }[] = [];
  for (const t of info) {
    const sql = masterSnapshotSql(t, masterList);
    if (!sql) continue;
    snapshots.push({ sql, value: (await first<{ s: string }>(db, sql))!.s });
  }

  const result: ResetResult = { ok: false, sandboxesRemoved: 0, businessesRemoved: sandboxIds, triggersBefore: triggers.length, triggersAfter: triggers.length, mastersUnchanged: true, filesRemoved: 0, message: '' };
  const synthetic = await all<{ id: number }>(
    db,
    `SELECT DISTINCT u.id FROM users u WHERE u.email LIKE '%@sandbox.invalid' AND u.email <> 'sample-owner@sandbox.invalid'
       AND NOT EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id IN (${keepIds.join(',')}))`,
  );
  const userIds = synthetic.map((u) => u.id).join(',') || '0';

  const statements: D1PreparedStatement[] = [db.prepare('PRAGMA defer_foreign_keys = ON')];
  for (const t of triggers) statements.push(db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`));
  if (sandboxIds.length > 0) {
    const ids = sandboxIds.join(',');
    const deletable = info
      .map((t) => ({ t, cond: conditionFor(t, byName, ids) }))
      .filter((x): x is { t: TableInfo; cond: string } => x.cond !== null)
      .sort((a, b) => depthOf(b.t, byName) - depthOf(a.t, byName));
    for (const { t, cond } of deletable) statements.push(db.prepare(`DELETE FROM "${t.name}" WHERE ${cond}`));
    for (const id of sandboxIds) statements.push(db.prepare("DELETE FROM settings WHERE key LIKE ?").bind(`b${id}:%`));
    statements.push(db.prepare(`DELETE FROM businesses WHERE id IN (${ids})`));
  }
  statements.push(db.prepare(`DELETE FROM demo_sessions WHERE sandbox_id IS NOT NULL OR user_id IN (${userIds})`));
  statements.push(db.prepare('DELETE FROM demo_sandboxes'));
  statements.push(db.prepare(`DELETE FROM user_businesses WHERE user_id IN (${userIds})`));
  statements.push(db.prepare(`DELETE FROM users WHERE id IN (${userIds})`));
  if (deps.failInside) statements.push(db.prepare('INSERT INTO demo_reset_guard (check_name, ok) VALUES (?, 0)').bind('test failure'));
  for (const t of triggers) statements.push(db.prepare(t.sql));
  // The checks. A wrong count or a changed row inserts ok = 0, which the CHECK refuses.
  statements.push(
    db.prepare(
      `INSERT INTO demo_reset_guard (check_name, ok) SELECT 'triggers', (SELECT COALESCE(group_concat(f, char(2)), '') FROM (SELECT name || char(1) || sql AS f FROM sqlite_master WHERE type = 'trigger' ORDER BY name)) = ?`,
    ).bind(triggerFingerprint),
  );
  for (const s of snapshots) statements.push(db.prepare(`INSERT INTO demo_reset_guard (check_name, ok) SELECT 'masters', (${s.sql}) = ?`).bind(s.value));
  statements.push(db.prepare('DELETE FROM demo_reset_guard'));

  try {
    await db.batch(statements);
  } catch (err) {
    result.message = `Rolled back: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`;
    result.mastersUnchanged = true;
    await run(db, 'INSERT INTO demo_resets (started_at, finished_at, ok, trigger_by, sandboxes_removed, triggers_before, triggers_after, masters_unchanged, message) VALUES (?, ?, 0, ?, 0, ?, ?, 1, ?)', startedAt, nowIso(), deps.trigger ?? 'cron', triggers.length, triggers.length, result.message);
    await deps.notifier?.send(`:rotating_light: Demo reset failed and rolled back. ${result.message}`);
    return result;
  }

  // After the commit: the same checks again, read back.
  const after = await all<{ name: string; sql: string }>(db, "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
  result.triggersAfter = after.length;
  const triggersSame = after.map((t) => `${t.name}\u0001${t.sql}`).join('\u0002') === triggerFingerprint;
  for (const s of snapshots) if ((await first<{ s: string }>(db, s.sql))!.s !== s.value) result.mastersUnchanged = false;

  // Then the sandbox files. Keys are content-addressed under business/<id>/.
  for (const id of sandboxIds) {
    let cursor: string | undefined;
    do {
      const listed = await deps.files.list({ prefix: `business/${id}/`, cursor });
      const keys = listed.objects.map((o) => o.key);
      if (keys.length) await deps.files.delete(keys);
      result.filesRemoved += keys.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  result.ok = triggersSame && result.mastersUnchanged;
  result.sandboxesRemoved = sandboxCount;
  result.message = result.ok
    ? `${sandboxCount} sandboxes removed, sample set unchanged, locks restored (${after.length} of ${triggers.length}).`
    : `Check failed after the reset: triggers ${triggersSame ? 'same' : 'differ'}, masters ${result.mastersUnchanged ? 'same' : 'differ'}.`;
  await run(
    db,
    'INSERT INTO demo_resets (started_at, finished_at, ok, trigger_by, sandboxes_removed, triggers_before, triggers_after, masters_unchanged, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    startedAt,
    nowIso(),
    result.ok ? 1 : 0,
    deps.trigger ?? 'cron',
    sandboxCount,
    triggers.length,
    after.length,
    result.mastersUnchanged ? 1 : 0,
    result.message,
  );
  if (!result.ok) await deps.notifier?.send(`:rotating_light: Demo reset: ${result.message}`);
  return result;
}

export async function lastReset(db: D1Database) {
  return first<{ started_at: string; finished_at: string | null; ok: number; sandboxes_removed: number; triggers_before: number; triggers_after: number; masters_unchanged: number; message: string; trigger_by: string }>(
    db,
    'SELECT * FROM demo_resets ORDER BY id DESC LIMIT 1',
  );
}
