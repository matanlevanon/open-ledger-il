import type { ModuleDef } from '../../core/module';
import type { DocumentsModuleOptions } from '../documents';
import { legalModeRoutes } from './routes';
import type { SwitchDeps } from './service';

/**
 * The עוסק מורשה switch (`runs/R11-murshe.md`). Owns `POST /api/legal-mode/switch`: the
 * ceiling-crossing screen's "Confirm switch" action, and the same action from the Settings tax
 * screen. `documentsServices` is the same `DocumentsModuleOptions` src/modules/index.ts passes to
 * `createDocumentsModule`, so re-pricing open payment requests uses the real fx source, ceiling
 * guard and ITA allocation request rather than a second, divergent set of defaults.
 */
export function createLegalModeModule(deps: Partial<SwitchDeps> = {}): ModuleDef {
  const documentsOptions: DocumentsModuleOptions = deps.documentsOptions ?? {};
  return {
    name: 'legal-mode',
    basePath: '/legal-mode',
    routes: legalModeRoutes({ documentsOptions, itaConnectionCheck: deps.itaConnectionCheck }),
  };
}

export const legalModeModule = createLegalModeModule();
