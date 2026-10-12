import { SYSTEM_ACTOR, auditAs } from '../../core/audit';
import { first, nowIso, run } from '../../core/db';
import type { Env } from '../../env';
import { APP_VERSION } from '../../version';
import { type Notifier, slackNotifier } from '../ita/notify';

/**
 * Update check. The Ledger asks GitHub for the latest release of the repo in UPDATE_REPO and
 * compares it to its own version. It only reads and tells. It never downloads or installs
 * anything, and it holds no Cloudflare token: the owner updates by running the new installer.
 */

export const LAST_CHECK_KEY = 'updates.last_check';
export const NOTIFIED_KEY = 'updates.notified_version';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type CheckStatus = 'up_to_date' | 'update_available' | 'off' | 'no_releases' | 'error';

export interface UpdateCheck {
  status: CheckStatus;
  current: string;
  latest: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: string;
  message: string;
}

/** Parses "v1.2.3" or "1.2.3". Pre-release tags such as "1.4.0-beta" are not offered. */
export function parseVersion(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a is older than b, zero when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function updateRepo(env: Env): string | null {
  const repo = (env.UPDATE_REPO ?? '').trim();
  return REPO_PATTERN.test(repo) ? repo : null;
}

export async function checkForUpdate(env: Env, fetcher: typeof fetch = fetch, current = APP_VERSION): Promise<UpdateCheck> {
  const checkedAt = nowIso();
  const base = { current, latest: null, releaseUrl: null, releaseName: null, publishedAt: null, checkedAt };
  const repo = updateRepo(env);
  if (!repo) return { ...base, status: 'off', message: 'The update check is off. Set UPDATE_REPO to owner/name of the repo this Ledger comes from.' };

  let res: Response;
  try {
    res = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'open-ledger-il-update-check' },
    });
  } catch (err) {
    return { ...base, status: 'error', message: `Could not reach GitHub (${err instanceof Error ? err.name : 'Error'}). Try again later.` };
  }
  if (res.status === 404) return { ...base, status: 'no_releases', message: `${repo} has no published release yet.` };
  if (!res.ok) return { ...base, status: 'error', message: `GitHub answered HTTP ${res.status}. Try again later.` };

  const body = (await res.json().catch(() => null)) as { tag_name?: string; html_url?: string; name?: string; published_at?: string } | null;
  const tag = body?.tag_name ?? '';
  if (!parseVersion(tag)) return { ...base, status: 'error', message: 'The latest release has no version number in its tag.' };
  const latest = tag.replace(/^v/, '');
  const newer = compareVersions(latest, current) > 0;
  return {
    ...base,
    status: newer ? 'update_available' : 'up_to_date',
    latest,
    releaseUrl: body?.html_url ?? null,
    releaseName: body?.name ?? null,
    publishedAt: body?.published_at ?? null,
    message: newer ? `Version ${latest} is available. This Ledger runs ${current}.` : `This Ledger runs ${current}, the latest version.`,
  };
}

export async function saveCheck(db: D1Database, check: UpdateCheck): Promise<void> {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    LAST_CHECK_KEY,
    JSON.stringify(check),
    check.checkedAt,
  );
}

export async function lastCheck(db: D1Database): Promise<UpdateCheck | null> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', LAST_CHECK_KEY);
  if (!row) return null;
  try {
    const saved = JSON.parse(row.value) as UpdateCheck;
    // A check saved before an update can name the version now running. Re-judge it against this build.
    if (saved.latest && saved.status === 'update_available' && compareVersions(saved.latest, APP_VERSION) <= 0) {
      return { ...saved, current: APP_VERSION, status: 'up_to_date', message: `This Ledger runs ${APP_VERSION}, the latest version.` };
    }
    return { ...saved, current: APP_VERSION };
  } catch {
    return null;
  }
}

/** Monthly: on the 1st, check, save, and post to Slack once per new version. */
export const UPDATE_CHECK_CRON = '0 7 * * *';

export interface UpdateCronDeps {
  fetcher?: typeof fetch;
  notifier?: Notifier;
  /** The date the cron treats as today, YYYY-MM-DD. Defaults to the scheduled time. */
  today?: string;
}

export async function updatesScheduled(controller: ScheduledController, env: Env, deps: UpdateCronDeps = {}): Promise<void> {
  if (controller.cron !== UPDATE_CHECK_CRON) return;
  const today = deps.today ?? new Date(controller.scheduledTime).toISOString().slice(0, 10);
  if (!today.endsWith('-01')) return;
  const fetcher = deps.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const check = await checkForUpdate(env, fetcher);
  await saveCheck(env.DB, check);
  await auditAs(env.DB, SYSTEM_ACTOR, 'updates.check', 'updates', null, { status: check.status, current: check.current, latest: check.latest });
  if (check.status !== 'update_available' || !check.latest) return;
  const notified = await first<{ value: string }>(env.DB, 'SELECT value FROM settings WHERE key = ?', NOTIFIED_KEY);
  if (notified?.value === check.latest) return;
  const notifier = deps.notifier ?? slackNotifier(env.SLACK_WEBHOOK_URL, fetcher);
  const sent = await notifier.send(
    `:arrow_up: Open Ledger IL ${check.latest} is available. This Ledger runs ${check.current}. ` +
      `Release notes: ${check.releaseUrl ?? 'see the repo releases'}. Update by running the new installer.`,
  );
  if (sent) {
    await run(
      env.DB,
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      NOTIFIED_KEY,
      check.latest,
      nowIso(),
    );
  }
}
