import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { BACKUP_CRON, backupScheduled } from './backup';
import { GAP_CHECK_CRON, opsGapScheduled } from './cron';
import { opsRoutes } from './routes';

export function createOpsModule(): ModuleDef {
  return {
    name: 'ops',
    basePath: '/ops',
    routes: opsRoutes(),
    // Both run on the nightly cron. The backup only acts on the first day of a quarter.
    crons: [...new Set([GAP_CHECK_CRON, BACKUP_CRON])],
    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
      if (controller.cron === GAP_CHECK_CRON) await opsGapScheduled(controller, env, ctx);
      if (controller.cron === BACKUP_CRON) await backupScheduled(controller, env, ctx);
    },
  };
}

export const opsModule = createOpsModule();

export { GAP_CHECK_CRON, opsGapScheduled } from './cron';
export { BACKUP_CRON, backupScheduled, isQuarterStart, runBackup, restoreAndVerify } from './backup';
export { GoogleDriveBackupUploader, quarterLabel, type DriveBackupUploader } from './drive-backup';
export { runGapCheck, checkSeriesGaps, findGaps } from './checks';
