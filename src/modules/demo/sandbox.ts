import { first, run } from '../../core/db';
import type { Env } from '../../env';
import type { DocumentsModuleOptions } from '../documents';
import type { Notifier } from '../ita/notify';
import { checkCap, countUse } from './caps';
import { DEMO_USER_DOMAIN, demoDay } from './config';
import { copySandbox } from './sample';

/**
 * R26 task 4: a sandbox is a group of businesses owned by a synthetic demo user, tied to a lead.
 * One per lead per day. The visitor's user owns its sandbox businesses and nothing else.
 */

export interface SandboxRow {
  id: number;
  lead_id: number | null;
  user_id: number;
  day: string;
  business_ids: string;
  copy_ms: number | null;
}

export async function sandboxToday(db: D1Database, leadId: number, now = new Date()): Promise<SandboxRow | null> {
  return first<SandboxRow>(db, 'SELECT * FROM demo_sandboxes WHERE lead_id = ? AND day = ? ORDER BY id DESC LIMIT 1', leadId, demoDay(now));
}

export async function openSandbox(
  env: Env,
  deps: { documentsOptions?: DocumentsModuleOptions; notifier: Notifier; now?: () => Date },
  leadId: number | null,
): Promise<SandboxRow> {
  const now = deps.now ? deps.now() : new Date();
  await checkCap(env, deps.notifier, 'sandboxes', null, now);
  const email = `visitor-${crypto.randomUUID()}@${DEMO_USER_DOMAIN}`;
  const user = await run(env.DB, "INSERT INTO users (email, role) VALUES (?, 'owner')", email);
  const userId = user.lastRowId;
  const started = Date.now();
  const ids = await copySandbox({ env, documentsOptions: deps.documentsOptions, now: deps.now }, { userId, email });
  const copyMs = Date.now() - started;
  // The visitor owns its sandbox and nothing else.
  await run(env.DB, `DELETE FROM user_businesses WHERE user_id = ? AND business_id NOT IN (${ids.map(() => '?').join(',')})`, userId, ...ids);
  const res = await run(env.DB, 'INSERT INTO demo_sandboxes (lead_id, user_id, day, business_ids, copy_ms) VALUES (?, ?, ?, ?, ?)', leadId, userId, demoDay(now), JSON.stringify(ids), copyMs);
  if (leadId !== null) await run(env.DB, 'UPDATE demo_leads SET sandbox_id = ? WHERE id = ?', res.lastRowId, leadId);
  await countUse(env, 'sandboxes', null, now);
  return (await first<SandboxRow>(env.DB, 'SELECT * FROM demo_sandboxes WHERE id = ?', res.lastRowId))!;
}
