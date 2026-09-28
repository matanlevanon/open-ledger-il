import type { ModuleDef } from '../../core/module';
import { CEILING_ALERT_CRON, ceilingScheduled } from './cron';
import { ceilingRoutes } from './routes';

export function createCeilingModule(): ModuleDef {
  return {
    name: 'ceiling',
    basePath: '/ceiling',
    routes: ceilingRoutes(),
    crons: [CEILING_ALERT_CRON],
    scheduled: ceilingScheduled,
  };
}

export const ceilingModule = createCeilingModule();

export { ceilingGuard, createCeilingGuard, CeilingCrossingError, type CeilingCrossingDetails } from './guard';
export { ceilingMeter, meterPercent, type CeilingMeterResult } from './meter';
export { evaluateCeilingAlerts, CEILING_ALERT_THRESHOLDS, type FiredCeilingAlert } from './alerts';
export { CEILING_ALERT_CRON, ceilingScheduled } from './cron';
