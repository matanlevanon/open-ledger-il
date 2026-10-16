import type { ModuleDef } from '../core/module';

// Module registry. Each run replaces its own two slot lines: the import and the entry.
// Keep the blank lines between slots so parallel PRs merge without conflicts.

import { clientsModule } from './clients';

import { createDocumentsModule } from './documents';

import { pdfModule } from './pdf';

import { signingModule } from './signing';

import { fxModule } from './fx';

import { dashboardModule } from './dashboard';

import { sendingModule } from './sending';

import { expensesModule } from './expenses';

import { ceilingGuard, ceilingModule } from './ceiling';

import { reportsModule } from './reports';

import { accessModule } from './access';

import { importModule } from './import';

// R11 murshe extends this stub (runs/R11-murshe.md): src/modules/legal-mode/routes.ts.
// R11 murshe also wires src/modules/documents's `allocation` hook below, to R12's real
// AllocationService (docs/israel-invoices-api.md §7).
import { createLegalModeModule } from './legal-mode';

import { itaModule } from './ita';

import { exportsModule } from './exports';

import { opsModule } from './ops';

import { paymentMethodsModule } from './payment-methods';

import { servicesModule } from './services';

import { createRecurringModule } from './recurring';
// Update check: Settings > Updates and a monthly check on the 1st.
import { updatesModule } from './updates';

// R24 Phase B: businesses, brands and Add business.
import { createBusinessesModule } from './businesses';

// R24 Phase C: business documents (certificates), share links and the expiry alert.
import { businessDocumentsModule } from './business-documents';

// R25: contracts and work orders, Fill & Sign. The public signing link mounts under /sending/public/c.
import { createContractsModule, createContractsPublicModule } from './contracts';

// R26: demo mode for the public Sample Ledger. Every route answers 404 unless DEMO_MODE=1.
import { createDemoAppModule, createDemoModule } from './demo';

// R35: POST /api/inbox, receipts forwarded by email. Signed by the gateway, outside Access.
import { defaultDeps as expensesDeps } from './expenses';
import { createInboxModule } from './expenses/inbox-routes';

// R34: Settings > MCP, the address, a token the Ledger keeps, and MCP on or off. Owner only.
import { mcpSettingsModule } from './mcp/settings-routes';

// R14 mcp: `mcpModule` mounts at the top-level `/mcp` path in src/index.ts, not under /api. It
// authenticates with the MCP_TOKEN bearer secret, not Cloudflare Access, and owns no cron, so it
// does not belong in this registry.

// Ceiling guard (R08) and the ITA allocation request (R11/R12) are passed into the documents
// module here rather than built as `documentsModule` at R01's own module scope, since only
// this file wires cross-module dependencies together. legal-mode's switch reuses the same
// options to build its own documents Ctx for re-pricing open payment requests.
import { createAllocationService } from './ita';
import type { ItaEnv } from './ita/config';
import type { DocumentsModuleOptions } from './documents';

const documentsServiceOptions: DocumentsModuleOptions = {
  ceiling: ceilingGuard,
  allocation: (env) => createAllocationService(env as ItaEnv),
};
const documentsModule = createDocumentsModule(documentsServiceOptions);
const legalModeModule = createLegalModeModule({
  documentsOptions: documentsServiceOptions,
  // docs/legal-requirements.md, "Switch from פטור to מורשה", point 4: "ITA connection check"
  // after the switch is confirmed. Reuses R12's own token status, never a second ITA client.
  itaConnectionCheck: async (env, businessId) => {
    const status = await createAllocationService(env as ItaEnv, undefined, businessId).tokens.status();
    return { connected: status.connected };
  },
});

export const modules: ModuleDef[] = [
  clientsModule,

  documentsModule,

  pdfModule,

  signingModule,

  fxModule,

  dashboardModule,

  sendingModule,

  expensesModule,

  ceilingModule,

  reportsModule,

  accessModule,

  importModule,

  legalModeModule,

  itaModule,

  exportsModule,

  opsModule,

  paymentMethodsModule,

  servicesModule,

  createRecurringModule({ documentsOptions: documentsServiceOptions }),
  updatesModule,

  createBusinessesModule(documentsServiceOptions),

  businessDocumentsModule,

  createContractsModule({ documentsOptions: documentsServiceOptions }),
  createContractsPublicModule(),

  createDemoModule({ documentsOptions: documentsServiceOptions }),
  createDemoAppModule(),

  mcpSettingsModule,

  createInboxModule(expensesDeps),
];
