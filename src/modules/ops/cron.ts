import { SYSTEM_ACTOR, auditAs } from '../../core/audit';
import type { Env } from '../../env';
import { type Notifier, slackNotifier } from '../ita/notify';
import { type GapCheckResult, runGapCheck } from './checks';

/** Must match the R14 entry in wrangler.toml's `[triggers] crons`. */
export const GAP_CHECK_CRON = '0 2 * * *';

export interface GapCheckDeps {
  notifier?: Notifier;
  /** Injectable so a test can force a failure without defeating the D1 triggers. */
  check?: () => Promise<GapCheckResult>;
}

function describe(result: GapCheckResult): string {
  const lines = [':rotating_light: Open Ledger IL nightly integrity check found a problem.'];
  const broken = result.series.filter((s) => !s.ok);
  if (broken.length > 0) {
    lines.push(`Number gaps: ${broken.map((s) => `${s.docType} (${s.seriesId}): ${s.problems.join(', ')}`).join('; ')}`);
  }
  if (!result.chain.ok) {
    lines.push(`Hash chain break at sequence ${result.chain.breaks.map((b) => b.seq).join(', ')}`);
  }
  return lines.join('\n');
}

/** Daily cron. Recomputes every series and the hash chain, alerts Slack and logs the outcome. */
export async function opsGapScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx?: ExecutionContext,
  deps: GapCheckDeps = {},
): Promise<void> {
  if (controller.cron !== GAP_CHECK_CRON) return;
  const notifier = deps.notifier ?? slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init));
  const check = deps.check ?? (() => runGapCheck(env.DB));
  const result = await check();
  await auditAs(env.DB, SYSTEM_ACTOR, 'ops.gap_check', 'ops', null, {
    ok: result.ok,
    seriesWithProblems: result.series.filter((s) => !s.ok).map((s) => s.seriesId),
    chainOk: result.chain.ok,
    checked: result.chain.checked,
  });
  if (!result.ok) await notifier.send(describe(result));
}
