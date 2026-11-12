import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { all } from './db';
import { DomainError } from './errors';

/**
 * R24 Phase B: more than one business in one Ledger. Business 1 is the data that existed before,
 * and every name below keeps business 1's values exactly as they were, so nothing renumbers.
 */
export const FIRST_BUSINESS = 1;

/** The business the current request acts on. Set by `authenticate` from X-Business-Id. */
export function businessIdOf(c: Context<AppEnv>): number {
  return c.get('user')?.businessId ?? FIRST_BUSINESS;
}

/**
 * A series id inside a business. Business 1 keeps the bare ids ('400', '305', '400-M'). Another
 * business prefixes them ('b2-400'), so series ids stay unique and its numbers start on their own.
 */
export function seriesIdFor(businessId: number, baseId: string): string {
  return businessId === FIRST_BUSINESS ? baseId : `b${businessId}-${baseId}`;
}

/** A per-business key in the `settings` table. Business 1 keeps the bare keys. */
export function settingKey(businessId: number, key: string): string {
  return businessId === FIRST_BUSINESS ? key : `b${businessId}:${key}`;
}

/** Every business, for cron jobs that run once per business. */
export async function listBusinessIds(db: D1Database): Promise<number[]> {
  return (await all<{ id: number }>(db, 'SELECT id FROM businesses ORDER BY id')).map((r) => r.id);
}

/**
 * R48: runs a cron job once per business. One business that throws never stops the rest: the
 * failure is logged as `business_job_failed` with the job and the business id, and the loop goes
 * on. Returns the ids that failed.
 */
export async function forEachBusiness(
  db: D1Database,
  job: string,
  fn: (businessId: number) => Promise<void>,
  ids?: number[],
): Promise<number[]> {
  const failed: number[] = [];
  for (const businessId of ids ?? (await listBusinessIds(db))) {
    // R48 task 5: a moved-out business is read-only. No recurring run, reminder or sync.
    if (await isMovedOut(db, businessId).catch(() => false)) continue;
    try {
      await fn(businessId);
    } catch (err) {
      failed.push(businessId);
      console.error('business_job_failed', job, businessId, err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
    }
  }
  return failed;
}

/** R48 task 5: true when the business was marked as moved out. It is read-only from then on. */
export async function isMovedOut(db: D1Database, businessId: number): Promise<boolean> {
  const row = await db.prepare('SELECT status FROM businesses WHERE id = ?').bind(businessId).first<{ status: string }>();
  return row?.status === 'moved_out';
}

/** R48 task 5: refuses any change to a moved-out business with 409 business_moved_out. */
export async function assertBusinessActive(db: D1Database, businessId: number): Promise<void> {
  if (await isMovedOut(db, businessId)) {
    throw new DomainError('business_moved_out', 'This business moved to its own Ledger. Its books here are read-only.', 409);
  }
}

/** R2 key prefix for files of a business. Business 1 keeps the keys it had. */
export function r2Prefix(businessId: number): string {
  return businessId === FIRST_BUSINESS ? '' : `business/${businessId}/`;
}

/**
 * A business setting: the business's own key wins, else the shared key, which is also business 1's.
 * Reads for business 1 are exactly what they were before businesses existed.
 */
export async function readBusinessSetting(db: D1Database, businessId: number, key: string, inherit = true): Promise<string | null> {
  const own = settingKey(businessId, key);
  if (!inherit) {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(own).first<{ value: string }>();
    return row?.value ?? null;
  }
  const row = await db
    .prepare('SELECT value FROM settings WHERE key IN (?, ?) ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END LIMIT 1')
    .bind(own, key, own)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** The series id without its business prefix: 'b2-400' reads as '400'. Business 1's ids are bare already. */
export function baseSeriesId(seriesId: string): string {
  return seriesId.replace(/^b\d+-/, '');
}
