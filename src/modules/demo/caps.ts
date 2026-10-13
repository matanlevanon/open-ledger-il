import { first, nowIso, run } from '../../core/db';
import { DomainError } from '../../core/errors';
import type { Env } from '../../env';
import type { Notifier } from '../ita/notify';
import { type DemoCaps, demoCaps, demoDay } from './config';

/**
 * R26 task 7: daily caps. Per sandbox: documents, PDFs, uploads, contracts, businesses. Per whole
 * demo: PDFs and new sandboxes. A cap reached answers with a plain message and alerts Slack once a
 * day per cap.
 */

export type CapKind = 'documents' | 'pdfs' | 'uploads' | 'contracts' | 'businesses' | 'sandboxes';

const MESSAGES: Record<CapKind, string> = {
  documents: 'This demo copy reached its documents for today. It resets tonight at 03:00.',
  pdfs: 'The demo reached its PDFs for today. Try again tomorrow.',
  uploads: 'This demo copy reached its uploads for today. It resets tonight at 03:00.',
  contracts: 'This demo copy reached its contracts for today. It resets tonight at 03:00.',
  businesses: 'A demo copy holds at most 3 businesses.',
  sandboxes: 'The demo is full for today. Try again tomorrow.',
};

export class DemoCapError extends DomainError {
  constructor(kind: CapKind) {
    super('demo_cap', MESSAGES[kind], 429, { kind });
  }
}

export async function usage(db: D1Database, day: string, scope: string, kind: CapKind): Promise<number> {
  return (await first<{ count: number }>(db, 'SELECT count FROM demo_usage WHERE day = ? AND scope = ? AND kind = ?', day, scope, kind))?.count ?? 0;
}

export async function bump(db: D1Database, day: string, scope: string, kind: CapKind, by = 1): Promise<void> {
  await run(
    db,
    'INSERT INTO demo_usage (day, scope, kind, count) VALUES (?, ?, ?, ?) ON CONFLICT (day, scope, kind) DO UPDATE SET count = count + excluded.count',
    day,
    scope,
    kind,
    by,
  );
}

function limitOf(caps: DemoCaps, kind: CapKind, scope: string): number {
  if (scope === 'global') return kind === 'pdfs' ? caps.dailyPdfs : kind === 'sandboxes' ? caps.dailySandboxes : Number.POSITIVE_INFINITY;
  return kind === 'documents' ? caps.documents : kind === 'pdfs' ? caps.pdfs : kind === 'uploads' ? caps.uploads : kind === 'contracts' ? caps.contracts : Number.POSITIVE_INFINITY;
}

async function alertOnce(db: D1Database, notifier: Notifier, day: string, scope: string, kind: CapKind): Promise<void> {
  await run(db, 'INSERT OR IGNORE INTO demo_usage (day, scope, kind, count) VALUES (?, ?, ?, 0)', day, scope, kind);
  const res = await run(db, 'UPDATE demo_usage SET alerted_at = ? WHERE day = ? AND scope = ? AND kind = ? AND alerted_at IS NULL', nowIso(), day, scope, kind);
  if (res.changes > 0) await notifier.send(`:warning: Demo cap reached: ${kind} (${scope}) on ${day}.`);
}

/** Throws DemoCapError when the sandbox or the whole demo used its share of `kind` today. */
export async function checkCap(env: Env, notifier: Notifier, kind: CapKind, sandboxId: number | null, now = new Date()): Promise<void> {
  const caps = demoCaps(env);
  const day = demoDay(now);
  const scopes = [...(sandboxId !== null ? [`sandbox:${sandboxId}`] : []), 'global'];
  for (const scope of scopes) {
    const limit = limitOf(caps, kind, scope);
    if (!Number.isFinite(limit)) continue;
    if ((await usage(env.DB, day, scope, kind)) >= limit) {
      await alertOnce(env.DB, notifier, day, scope, kind);
      throw new DemoCapError(kind);
    }
  }
}

export async function countUse(env: Env, kind: CapKind, sandboxId: number | null, now = new Date()): Promise<void> {
  const day = demoDay(now);
  if (sandboxId !== null) await bump(env.DB, day, `sandbox:${sandboxId}`, kind);
  await bump(env.DB, day, 'global', kind);
}
