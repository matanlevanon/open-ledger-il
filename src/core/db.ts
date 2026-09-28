import { mapDbError } from './errors';

/** Values D1 accepts as bound parameters. */
export type SqlValue = string | number | null | ArrayBuffer;

/** Builds a prepared statement. Undefined parameters bind as NULL. */
export function stmt(db: D1Database, sql: string, ...params: (SqlValue | undefined | boolean)[]): D1PreparedStatement {
  const bound = params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  return db.prepare(sql).bind(...bound);
}

/** First row or null. */
export async function first<T>(db: D1Database, sql: string, ...params: (SqlValue | undefined | boolean)[]): Promise<T | null> {
  try {
    return await stmt(db, sql, ...params).first<T>();
  } catch (err) {
    throw mapDbError(err);
  }
}

/** All rows. */
export async function all<T>(db: D1Database, sql: string, ...params: (SqlValue | undefined | boolean)[]): Promise<T[]> {
  try {
    const result = await stmt(db, sql, ...params).all<T>();
    return result.results;
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Runs a write. Returns rows changed and the last row id. */
export async function run(
  db: D1Database,
  sql: string,
  ...params: (SqlValue | undefined | boolean)[]
): Promise<{ changes: number; lastRowId: number }> {
  try {
    const result = await stmt(db, sql, ...params).run();
    return { changes: result.meta.changes, lastRowId: result.meta.last_row_id };
  } catch (err) {
    throw mapDbError(err);
  }
}

/**
 * Runs statements as one transaction. D1 has no interactive transactions: `db.batch`
 * executes every statement atomically and rolls all of them back when one fails.
 * Checks that depend on current state go into the SQL itself (guarded inserts, triggers),
 * never into JS between two awaits.
 */
export async function transaction(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  try {
    return await db.batch(statements);
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Current UTC timestamp in ISO 8601, the format every *_at column uses. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date in Israel (YYYY-MM-DD). Business dates follow Israel time. */
export function todayIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a YYYY-MM-DD calendar date. */
export function assertDate(value: string, label = 'date'): string {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new RangeError(`${label} must be YYYY-MM-DD, got "${value}"`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  if (probe.getUTCMonth() !== m! - 1 || probe.getUTCDate() !== d!) {
    throw new RangeError(`${label} is not a real calendar date: "${value}"`);
  }
  return value;
}
