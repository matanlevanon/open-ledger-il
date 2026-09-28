import { todayIsrael } from '../../core/db';
import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { type AllocationRequester, passThroughAllocationRequester } from './allocation';
import { type CeilingGuard, passThroughCeilingGuard } from './ceiling';
import { type RateSource, boiRateSource } from '../fx';
import { type ServiceFactory, documentRoutes } from './routes';
import type { Services } from './service';

export interface DocumentsModuleOptions {
  /** Rate source. Default: R04's `rateOn` over `fx_rates`, with Bank of Israel backfill. */
  fx?: (db: D1Database) => RateSource;
  /** Ceiling hook. Default: pass-through until R08 ships the guard. */
  ceiling?: CeilingGuard;
  /** Business date. Default: today in Israel. */
  today?: () => string;
  /** Opens R12's ITA allocation request after finalize. Default: pass-through until wired in src/modules/index.ts. */
  allocation?: (env: Env) => AllocationRequester;
}

/**
 * Builds one request's `Services`. Exported so a module that needs the same documents-module
 * services outside a documents route can build one the same way (src/modules/legal-mode, for the
 * עוסק מורשה switch's re-pricing step) instead of constructing its own.
 */
export function buildDocumentsServices(options: DocumentsModuleOptions, env: Env): Services {
  return {
    fx: (options.fx ?? boiRateSource)(env.DB),
    ceiling: options.ceiling ?? passThroughCeilingGuard,
    today: options.today ?? (() => todayIsrael()),
    allocation: (options.allocation ?? (() => passThroughAllocationRequester))(env),
  };
}

export function createDocumentsModule(options: DocumentsModuleOptions = {}): ModuleDef {
  const services: ServiceFactory = (env) => buildDocumentsServices(options, env);
  return { name: 'documents', basePath: '/documents', routes: documentRoutes(services) };
}

export const documentsModule = createDocumentsModule();

export type { AllocationRequester } from './allocation';
export type { CeilingGuard } from './ceiling';
export type { RateSource, ResolvedRate } from './fx';
export type { Ctx, OpenPaymentRequestSummary, Services } from './service';
export { listOpenFinalPaymentRequests, repriceOpenDraftsForSwitch } from './service';
