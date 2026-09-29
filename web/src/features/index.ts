import type { ComponentType } from 'react';

/**
 * Feature screen registry. Each run replaces its own slot line with one entry, for example
 *   { path: '/clients/*', component: ClientsRoutes },
 * after importing its screen in the matching import slot. Keep the blank lines between slots
 * so parallel PRs merge without conflicts. A registered path replaces the placeholder.
 */
export interface FeatureRoute {
  /** Router path, relative to the app root. Use a trailing /* for nested routes. */
  path: string;
  component: ComponentType;
}

import { documentsRoutes } from './documents';

import { DashboardPage } from './dashboard';
import { QuickPage } from './quick';

import { ExpensesRoutes } from './expenses';

import { ReportsPage } from './reports';
import { UnifiedFilePage } from './exports/UnifiedFilePage';

import { AccessPage } from './access';

import { ImportPage } from './import';

// R11 legal-mode: import { ... } from './legal-mode';

import { ItaScreen } from './ita/ItaScreen';

import { ServicesPage } from './settings/ServicesTab';
import { SettingsPage } from './settings/SettingsPage';

import { AboutPage } from './about/AboutPage';

export const featureRoutes: FeatureRoute[] = [
  ...documentsRoutes,

  { path: '/', component: DashboardPage },
  { path: '/quick', component: QuickPage },

  { path: '/expenses/*', component: ExpensesRoutes },

  { path: '/reports', component: ReportsPage },
  { path: '/unified-file', component: UnifiedFilePage },

  { path: '/accountant', component: AccessPage },

  { path: '/import', component: ImportPage },

  { path: '/services', component: ServicesPage },

  // R11 legal-mode

  { path: '/ita', component: ItaScreen },

  { path: '/settings', component: SettingsPage },

  { path: '/about', component: AboutPage },
];
