import { all, first, nowIso, run } from '../../core/db';
import type { Notifier } from '../ita/notify';
import { MASTER_OWNER_EMAIL } from './config';
import { buildRunning, staleMasters } from './sample';

/**
 * R26, R29: removing visitor data from the shared sample Ledger.
 *
 * Two callers, one mechanism:
 *   - the sweep, every reset-Worker cron run: expired visitor sessions, their synthetic users, and
 *     every row and stored file tagged with their session key.
 *   - the nightly 03:00 reset: every session-tagged row whatever its session, every visitor
 *     session and user, every business not listed in demo_master_businesses, and a master that no
 *     longer matches the seed. The reset Worker then rebuilds what is missing.
 *
 * Each runs as one D1 batch, which is one transaction:
 *   1. read every trigger's SQL from sqlite_master (before the batch)
 *   2. drop the triggers
 *   3. delete the rows, child tables first. A table with demo_session_id picks by it, a table with
 *      business_id picks by it, a table with user_id picks the removed users, and a child table
 *      picks by its parent's rows through its foreign keys
 *   4. recreate every trigger from the saved SQL, exactly
 *   5. check inside the transaction that the triggers and every kept master row are exactly what
 *      they were: a failed check breaks a CHECK constraint, and the whole batch rolls back
 * Then the stored files no row points to any more go from the bucket.
 *
 * Never touched: demo_leads, demo_consents, demo_lead_events, demo_codes, demo_usage, demo_resets,
 * demo_sweeps, business 1, the kept masters' own rows, and every shared table.
 */

/** Tables never deleted from by the generic rules. Sessions, users and grants are handled by name. */
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
  'demo_sweeps',
  'demo_build_lock',
  'demo_sessions',
  'users',
  'user_businesses',
  'settings',
  'd1_migrations',
  '_cf_KV',
  'sqlite_sequence',
]);

interface TableInfo {
  name: string;
  columns: string[];
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
    out.push({ name, columns, fks });
  }
  return out;
}

/** What to remove. Session keys 'all' means every tagged row. */
export interface PurgeScope {
  sessionKeys: string[] | 'all';
  userIds: number[];
  businessIds: number[];
}

const list = (values: (string | number)[]) => values.map((v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)).join(',');

/** The SQL condition that picks a table's rows to remove, or null when it holds none. */
function conditionFor(t: TableInfo, byName: Map<string, TableInfo>, scope: PurgeScope, seen = new Set<string>()): string | null {
  if (KEEP.has(t.name) || seen.has(t.name)) return null;
  const next = new Set(seen).add(t.name);
  const parts: string[] = [];
  if (t.columns.includes('demo_session_id')) {
    if (scope.sessionKeys === 'all') parts.push('demo_session_id IS NOT NULL');
    else if (scope.sessionKeys.length) parts.push(`demo_session_id IN (${list(scope.sessionKeys)})`);
  }
  if (t.columns.includes('business_id') && scope.businessIds.length) parts.push(`business_id IN (${list(scope.businessIds)})`);
  if (t.columns.includes('user_id') && scope.userIds.length) parts.push(`user_id IN (${list(scope.userIds)})`);
  for (const [col, parent, to] of t.fks) {
    const p = byName.get(parent);
    if (!p || p.name === t.name) continue;
    // A row that points at a removed user goes with it, so the user's delete never breaks a key.
    if (parent === 'users') {
      if (scope.userIds.length) parts.push(`${col} IN (${list(scope.userIds)})`);
      continue;
    }
    const cond = parent === 'businesses' ? (scope.businessIds.length ? `id IN (${list(scope.businessIds)})` : null) : conditionFor(p, byName, scope, next);
    if (cond) parts.push(`${col} IN (SELECT ${to} FROM ${parent} WHERE ${cond})`);
  }
  return parts.length ? parts.map((p) => `(${p})`).join(' OR ') : null;
}

/** Depth from a root: children delete before their parents. */
function depthOf(t: TableInfo, byName: Map<string, TableInfo>, seen = new Set<string>()): number {
  if (seen.has(t.name)) return 0;
  seen.add(t.name);
  let d = 0;
  for (const [, parent] of t.fks) {
    const p = byName.get(parent);
    if (p && p.name !== t.name) d = Math.max(d, depthOf(p, byName, new Set(seen)) + 1);
  }
  return d;
}

export interface PurgeResult {
  ok: boolean;
  rowsRemoved: number;
  filesRemoved: number;
  triggersBefore: number;
  triggersAfter: number;
  mastersUnchanged: boolean;
  message: string;
}

/**
 * Removes everything the scope names in one transaction, with the checks above, then the files
 * no remaining row points to. `extra` statements run inside the batch, before the triggers return.
 */
export async function purge(db: D1Database, files: R2Bucket, scope: PurgeScope, opts: { keepMasters: number[]; extra?: D1PreparedStatement[]; failInside?: boolean }): Promise<PurgeResult> {
  const triggers = await all<{ name: string; sql: string }>(db, "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
  const triggerFingerprint = triggers.map((t) => `${t.name}\u0001${t.sql}`).join('\u0002');
  const info = await tables(db);
  const byName = new Map(info.map((t) => [t.name, t]));
  const deletable = info
    .map((t) => ({ t, cond: conditionFor(t, byName, scope) }))
    .filter((x): x is { t: TableInfo; cond: string } => x.cond !== null)
    .sort((a, b) => depthOf(b.t, byName) - depthOf(a.t, byName));
  const condOf = new Map(deletable.map((d) => [d.t.name, d.cond]));

  // The stored files the removed rows point to. Deleted after the commit, unless a kept row still points there.
  const keys = new Set<string>();
  let rowsRemoved = 0;
  for (const { t, cond } of deletable) {
    rowsRemoved += (await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "${t.name}" WHERE ${cond}`))!.n;
    for (const col of t.columns.filter((c) => /r2_key$/.test(c))) {
      for (const r of await all<{ k: string | null }>(db, `SELECT "${col}" AS k FROM "${t.name}" WHERE (${cond}) AND "${col}" IS NOT NULL`)) if (r.k) keys.add(r.k);
    }
  }

  // Every kept master row, as text, to compare inside the transaction. A row the scope removes is not kept.
  const masterList = list(opts.keepMasters);
  const snapshots: { sql: string; value: string }[] = [];
  if (opts.keepMasters.length) {
    for (const t of info) {
      if (!t.columns.includes('business_id') || KEEP.has(t.name)) continue;
      const cols = t.columns.map((c) => `quote("${c}")`).join(" || ',' || ");
      const removed = condOf.get(t.name);
      const where = `business_id IN (${masterList})${removed ? ` AND COALESCE((${removed}), 0) = 0` : ''}`;
      const sql = `SELECT COALESCE(group_concat(r, '|'), '') AS s FROM (SELECT ${cols} AS r FROM "${t.name}" WHERE ${where} ORDER BY rowid)`;
      snapshots.push({ sql, value: (await first<{ s: string }>(db, sql))!.s });
    }
  }

  const statements: D1PreparedStatement[] = [db.prepare('PRAGMA defer_foreign_keys = ON')];
  for (const t of triggers) statements.push(db.prepare(`DROP TRIGGER IF EXISTS "${t.name}"`));
  for (const { t, cond } of deletable) statements.push(db.prepare(`DELETE FROM "${t.name}" WHERE ${cond}`));
  if (scope.businessIds.length) {
    for (const id of scope.businessIds) statements.push(db.prepare('DELETE FROM settings WHERE key LIKE ?').bind(`b${id}:%`));
    statements.push(db.prepare(`DELETE FROM user_businesses WHERE business_id IN (${list(scope.businessIds)})`));
    statements.push(db.prepare(`DELETE FROM businesses WHERE id IN (${list(scope.businessIds)})`));
  }
  if (scope.userIds.length) {
    statements.push(db.prepare(`DELETE FROM demo_sessions WHERE user_id IN (${list(scope.userIds)})`));
    statements.push(db.prepare(`DELETE FROM user_businesses WHERE user_id IN (${list(scope.userIds)})`));
    statements.push(db.prepare(`DELETE FROM users WHERE id IN (${list(scope.userIds)})`));
  }
  statements.push(...(opts.extra ?? []));
  if (opts.failInside) statements.push(db.prepare('INSERT INTO demo_reset_guard (check_name, ok) VALUES (?, 0)').bind('test failure'));
  for (const t of triggers) statements.push(db.prepare(t.sql));
  // The checks. A wrong trigger or a changed kept row inserts ok = 0, which the CHECK refuses.
  statements.push(
    db.prepare(
      `INSERT INTO demo_reset_guard (check_name, ok) SELECT 'triggers', (SELECT COALESCE(group_concat(f, char(2)), '') FROM (SELECT name || char(1) || sql AS f FROM sqlite_master WHERE type = 'trigger' ORDER BY name)) = ?`,
    ).bind(triggerFingerprint),
  );
  for (const s of snapshots) statements.push(db.prepare(`INSERT INTO demo_reset_guard (check_name, ok) SELECT 'masters', (${s.sql}) = ?`).bind(s.value));
  statements.push(db.prepare('DELETE FROM demo_reset_guard'));

  const result: PurgeResult = { ok: false, rowsRemoved: 0, filesRemoved: 0, triggersBefore: triggers.length, triggersAfter: triggers.length, mastersUnchanged: true, message: '' };
  try {
    await db.batch(statements);
  } catch (err) {
    result.message = `Rolled back: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`;
    return result;
  }

  // After the commit: the same checks again, read back.
  const after = await all<{ name: string; sql: string }>(db, "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name");
  result.triggersAfter = after.length;
  const triggersSame = after.map((t) => `${t.name}\u0001${t.sql}`).join('\u0002') === triggerFingerprint;
  for (const s of snapshots) if ((await first<{ s: string }>(db, s.sql))!.s !== s.value) result.mastersUnchanged = false;
  result.rowsRemoved = rowsRemoved;

  // The files. Keys are content-addressed, so a key a kept row still names stays.
  const keyColumns = info.flatMap((t) => t.columns.filter((c) => /r2_key$/.test(c)).map((c) => ({ table: t.name, col: c })));
  for (const key of keys) {
    let used = false;
    for (const { table, col } of keyColumns) {
      if (await first(db, `SELECT 1 FROM "${table}" WHERE "${col}" = ? LIMIT 1`, key)) {
        used = true;
        break;
      }
    }
    if (!used) {
      await files.delete(key);
      result.filesRemoved++;
    }
  }
  for (const id of scope.businessIds) {
    let cursor: string | undefined;
    do {
      const listed = await files.list({ prefix: `business/${id}/`, cursor });
      const names = listed.objects.map((o) => o.key);
      if (names.length) await files.delete(names);
      result.filesRemoved += names.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  result.ok = triggersSame && result.mastersUnchanged;
  return result;
}

/** Synthetic visitor users: the demo's domain, never the sample set's owner. */
async function visitorUsers(db: D1Database, where = '1 = 1', ...params: (string | number)[]): Promise<number[]> {
  return (
    await all<{ id: number }>(db, `SELECT id FROM users WHERE email LIKE '%@sandbox.invalid' AND email <> ? AND (${where})`, MASTER_OWNER_EMAIL, ...params)
  ).map((u) => u.id);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface SweepResult {
  ok: boolean;
  sessionsRemoved: number;
  rowsRemoved: number;
  filesRemoved: number;
  message: string;
}

/** Removes expired visitor sessions and everything tagged with them. Logged in demo_sweeps. */
export async function runSweep(deps: { db: D1Database; files: R2Bucket; notifier?: Notifier; now?: Date }): Promise<SweepResult> {
  const { db } = deps;
  const startedAt = nowIso();
  const now = (deps.now ?? new Date()).toISOString();
  const expired = await all<{ session_key: string | null; user_id: number }>(db, 'SELECT session_key, user_id FROM demo_sessions WHERE admin = 0 AND expires_at <= ?', now);
  const keys = expired.map((s) => s.session_key).filter((k): k is string => Boolean(k));
  // A user goes with its last session. A visitor who still has a live session keeps its user.
  const candidates = [...new Set(expired.map((s) => s.user_id))];
  const userIds = candidates.length
    ? await visitorUsers(db, `id IN (${candidates.join(',')}) AND NOT EXISTS (SELECT 1 FROM demo_sessions s WHERE s.user_id = users.id AND (s.admin = 1 OR s.expires_at > ?))`, now)
    : [];
  let result: SweepResult = { ok: true, sessionsRemoved: 0, rowsRemoved: 0, filesRemoved: 0, message: 'Nothing to sweep.' };
  if (expired.length > 0) {
    const masters = (await all<{ business_id: number }>(db, 'SELECT business_id FROM demo_master_businesses')).map((r) => r.business_id);
    const purged = await purge(db, deps.files, { sessionKeys: keys, userIds, businessIds: [] }, {
      keepMasters: masters,
      extra: [db.prepare(`DELETE FROM demo_sessions WHERE admin = 0 AND expires_at <= ?`).bind(now)],
    });
    result = {
      ok: purged.ok,
      sessionsRemoved: purged.ok || !purged.message.startsWith('Rolled back') ? expired.length : 0,
      rowsRemoved: purged.rowsRemoved,
      filesRemoved: purged.filesRemoved,
      message: purged.ok ? `${expired.length} sessions swept, ${purged.rowsRemoved} rows and ${purged.filesRemoved} files removed.` : purged.message || 'Check failed after the sweep.',
    };
    if (!purged.ok) await deps.notifier?.send(`:rotating_light: Demo sweep: ${result.message}`);
  }
  await run(
    db,
    'INSERT INTO demo_sweeps (started_at, finished_at, ok, sessions_removed, rows_removed, files_removed, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    startedAt,
    nowIso(),
    result.ok ? 1 : 0,
    result.sessionsRemoved,
    result.rowsRemoved,
    result.filesRemoved,
    result.message,
  );
  // Seven days of sweep history is enough for the admin page.
  await run(db, 'DELETE FROM demo_sweeps WHERE started_at < ?', new Date(Date.parse(startedAt) - 7 * 86_400_000).toISOString());
  return result;
}

export async function lastSweep(db: D1Database) {
  return first<{ started_at: string; finished_at: string | null; ok: number; sessions_removed: number; rows_removed: number; files_removed: number; message: string }>(
    db,
    'SELECT * FROM demo_sweeps ORDER BY id DESC LIMIT 1',
  );
}

// ---------------------------------------------------------------------------
// The nightly reset
// ---------------------------------------------------------------------------

export interface ResetResult {
  ok: boolean;
  /** Visitor sessions removed. */
  sandboxesRemoved: number;
  businessesRemoved: number[];
  /** Sample keys whose master no longer matched the seed and was removed for a rebuild. */
  mastersRebuilt: string[];
  rowsRemoved: number;
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
  const log = async (r: ResetResult) =>
    run(
      db,
      'INSERT INTO demo_resets (started_at, finished_at, ok, trigger_by, sandboxes_removed, triggers_before, triggers_after, masters_unchanged, message, masters_rebuilt, businesses_removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      startedAt,
      nowIso(),
      r.ok ? 1 : 0,
      deps.trigger ?? 'cron',
      r.sandboxesRemoved,
      r.triggersBefore,
      r.triggersAfter,
      r.mastersUnchanged ? 1 : 0,
      r.message,
      r.mastersRebuilt.length,
      r.businessesRemoved.length,
    );
  const result: ResetResult = { ok: false, sandboxesRemoved: 0, businessesRemoved: [], mastersRebuilt: [], rowsRemoved: 0, triggersBefore: 0, triggersAfter: 0, mastersUnchanged: true, filesRemoved: 0, message: '' };

  // A build in progress is half a business. Leave it alone and try at the next run.
  if (await buildRunning(db)) {
    result.message = 'Skipped: the sample data is being built.';
    await log(result);
    return result;
  }

  const stale = await staleMasters(db);
  const staleIds = stale.map((s) => s.businessId).filter((id): id is number => id !== null);
  const keep = (await all<{ business_id: number }>(db, 'SELECT business_id FROM demo_master_businesses')).map((r) => r.business_id).filter((id) => !staleIds.includes(id));
  const businessIds = (await all<{ id: number }>(db, `SELECT id FROM businesses WHERE id NOT IN (${[1, ...keep].join(',')}) ORDER BY id`)).map((r) => r.id);
  const sessions = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM demo_sessions WHERE admin = 0'))!.n;
  const userIds = await visitorUsers(db);

  const purged = await purge(db, deps.files, { sessionKeys: 'all', userIds, businessIds }, {
    keepMasters: keep,
    failInside: deps.failInside,
    extra: [
      db.prepare('DELETE FROM demo_sessions WHERE admin = 0'),
      ...(staleIds.length ? [db.prepare(`DELETE FROM demo_master_businesses WHERE business_id IN (${staleIds.join(',')})`)] : []),
    ],
  });
  Object.assign(result, {
    ok: purged.ok,
    rowsRemoved: purged.rowsRemoved,
    triggersBefore: purged.triggersBefore,
    triggersAfter: purged.triggersAfter,
    mastersUnchanged: purged.mastersUnchanged,
    filesRemoved: purged.filesRemoved,
  });
  if (purged.message.startsWith('Rolled back')) {
    result.message = purged.message;
    await log(result);
    await deps.notifier?.send(`:rotating_light: Demo reset failed and rolled back. ${result.message}`);
    return result;
  }
  result.sandboxesRemoved = sessions;
  result.businessesRemoved = businessIds;
  result.mastersRebuilt = stale.map((s) => s.key);
  result.message = result.ok
    ? `${sessions} visitor sessions and ${purged.rowsRemoved} rows removed, ${businessIds.length} businesses removed, ${stale.length ? `sample set to rebuild: ${stale.map((s) => s.key).join(', ')}` : 'sample set unchanged'}, locks restored (${purged.triggersAfter} of ${purged.triggersBefore}).`
    : `Check failed after the reset: triggers ${purged.triggersAfter === purged.triggersBefore ? 'same count' : 'differ'}, masters ${purged.mastersUnchanged ? 'same' : 'differ'}.`;
  await log(result);
  if (!result.ok) await deps.notifier?.send(`:rotating_light: Demo reset: ${result.message}`);
  return result;
}

export async function lastReset(db: D1Database) {
  return first<{ started_at: string; finished_at: string | null; ok: number; sandboxes_removed: number; triggers_before: number; triggers_after: number; masters_unchanged: number; message: string; trigger_by: string }>(
    db,
    'SELECT * FROM demo_resets ORDER BY id DESC LIMIT 1',
  );
}
