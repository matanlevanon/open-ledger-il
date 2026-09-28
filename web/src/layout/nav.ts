import type { MessageKey } from '../i18n';

/** Sidebar map per docs/ui-direction.md. `run` names the build run that fills the screen.
 * `label` is a message-catalog key (R16 task 16), not display text: render it with `useT()`. */

export interface NavItem {
  label: MessageKey;
  path: string;
  run: string;
  /** Feature an accountant needs to see the item. Undefined means owner only. */
  feature?: string;
}

export interface NavSection {
  label: MessageKey;
  path: string;
  run: string;
  feature?: string;
  children?: NavItem[];
}

export const NAV: NavSection[] = [
  { label: 'nav.dashboard', path: '/', run: 'R05' },
  { label: 'nav.clients', path: '/clients', run: 'R01', feature: 'clients' },
  {
    label: 'nav.income',
    path: '/income',
    run: 'R01',
    feature: 'income_documents',
    children: [
      { label: 'nav.incomeQuotes', path: '/income/quotes', run: 'R01' },
      { label: 'nav.incomePaymentRequests', path: '/income/payment-requests', run: 'R01', feature: 'income_documents' },
      { label: 'nav.incomeProformas', path: '/income/proformas', run: 'R17', feature: 'income_documents' },
      { label: 'nav.incomeDocuments', path: '/income/documents', run: 'R01', feature: 'income_documents' },
      { label: 'nav.incomeRecurring', path: '/income/recurring', run: 'a later run' },
      { label: 'nav.incomeStatements', path: '/income/statements', run: 'R01', feature: 'clients' },
    ],
  },
  { label: 'nav.services', path: '/services', run: 'R17', feature: 'income_documents' },
  { label: 'nav.expenses', path: '/expenses', run: 'R07', feature: 'expenses' },
  { label: 'nav.ita', path: '/ita', run: 'R12' },
  { label: 'nav.reports', path: '/reports', run: 'R08', feature: 'reports' },
  { label: 'nav.accountant', path: '/accountant', run: 'R09', feature: 'monthly_pack' },
  { label: 'nav.import', path: '/import', run: 'R10' },
  { label: 'nav.settings', path: '/settings', run: 'R14' },
  { label: 'nav.about', path: '/about', run: 'R22' },
];

/**
 * Static placeholder-route source for the עוסק פטור create-new paths (R18 task 10: 300 is the one
 * proforma type now). R19 task 7: the sidebar's actual "Create new" menu no longer reads this
 * list — it reads `/api/documents/types` at runtime (`offeredDocumentTypes`, `web/src/features/
 * documents/format.ts`), the same as the client page's "New document" dropdown, so both follow
 * the legal mode with no separate list to keep in sync. This array only feeds `allNavPaths` below,
 * so every create-new path still gets a placeholder route before its real page is registered; 305
 * and 320 need no entry of their own here since they share `/income/documents/new`, already
 * registered by the 400 row.
 */
export const CREATE_NEW_PATUR: NavItem[] = [
  { label: 'nav.createQuote', path: '/income/quotes/new', run: 'R01' },
  { label: 'nav.createPaymentRequest', path: '/income/payment-requests/new', run: 'R01' },
  { label: 'nav.createProforma', path: '/income/proformas/new', run: 'R17' },
  { label: 'nav.createReceipt', path: '/income/documents/new?type=400', run: 'R01' },
  { label: 'nav.createCreditReceipt', path: '/income/documents/new?type=405', run: 'R01' },
];

/** Title-case labels for the sidebar's dynamic "Create new" menu (R19 task 7), keyed by document_types.code. */
export const CREATE_NEW_LABEL_KEYS: Record<string, MessageKey> = {
  QT: 'nav.createQuote',
  PR: 'nav.createPaymentRequest',
  '300': 'nav.createProforma',
  '400': 'nav.createReceipt',
  '405': 'nav.createCreditReceipt',
  '305': 'nav.createInvoice',
  '320': 'nav.createInvoiceReceipt',
};

export function canSee(item: { feature?: string }, role: 'owner' | 'accountant' | undefined, features: string[]): boolean {
  if (role !== 'accountant') return true;
  return item.feature !== undefined && features.includes(item.feature);
}

/** Every path the shell knows, with the run that owns it. Used for placeholder routes. */
export function allNavPaths(): NavItem[] {
  const out: NavItem[] = [];
  for (const s of NAV) {
    out.push({ label: s.label, path: s.path, run: s.run, feature: s.feature });
    for (const c of s.children ?? []) out.push(c);
  }
  for (const c of CREATE_NEW_PATUR) out.push({ ...c, path: c.path.split('?')[0]! });
  return out;
}
