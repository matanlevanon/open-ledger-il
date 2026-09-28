import type { ModuleDef } from '../../core/module';
import type { ItaEnv } from './config';
import { ITA_CRONS, runRetryQueue, runTokenCheck } from './jobs';
import { itaRoutes } from './routes';
import { type ItaDeps, defaultDeps } from './service';

/** ITA Israel Invoices module (R12). Routes under /api/ita, owner only. */
export function createItaModule(overrides: Partial<ItaDeps> = {}): ModuleDef {
  const deps: ItaDeps = { ...defaultDeps(), ...overrides };
  return {
    name: 'ita',
    basePath: '/ita',
    routes: itaRoutes(deps),
    crons: [ITA_CRONS.retryQueue, ITA_CRONS.tokenCheck],
    async scheduled(controller, env) {
      if (controller.cron === ITA_CRONS.retryQueue) await runRetryQueue(env as ItaEnv, deps);
      if (controller.cron === ITA_CRONS.tokenCheck) await runTokenCheck(env as ItaEnv, deps);
    },
  };
}

export const itaModule = createItaModule();

export { allocationGate } from './gate';
export { type AllocationService, type AllocationResult, type RefusalChoice, createAllocationService } from './service';
export { ALLOCATION_STATUSES, type AllocationDocStatus, type AllocationDocumentStore, D1AllocationDocuments } from './documents';
export { MemoryAllocationDocuments } from './fake-documents';
export { supplierCheckRequired, supplierConfirmationNumber, supplierInvoiceDetails } from './buyer';
export { shortAllocationNumber } from './responses';
