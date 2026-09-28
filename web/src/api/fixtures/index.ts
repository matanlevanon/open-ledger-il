import { dashboardFixture } from './dashboard';
import { meFixture } from './me';
import { expensesByCategoryFixture } from './reports';

/**
 * Fixture registry for VITE_MOCK=1. Keyed by API path (without query string), each entry
 * is a function returning fresh data so a caller can never mutate the shared fixture.
 * Add a line here for every fetcher that should work before the Worker route exists.
 */
export const fixtures: Record<string, () => unknown> = {
  '/me': () => meFixture,
  '/dashboard': () => dashboardFixture,
  '/reports/r/expenses-by-category': expensesByCategoryFixture,
};
