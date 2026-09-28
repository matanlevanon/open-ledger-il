import type { MessageKey } from '../../i18n';
import type { AccessFeatures } from './api';

/**
 * Order and labels from docs/accountant-access.md. Kept in sync with src/core/auth.ts by hand.
 * Message-catalog keys, not display text (R16 task 16): render with `t(FEATURE_LABEL_KEYS[key])`.
 */
export const FEATURE_LABEL_KEYS: Record<keyof AccessFeatures, MessageKey> = {
  income_documents: 'access.feature.incomeDocuments',
  expenses: 'access.feature.expenses',
  clients: 'access.feature.clients',
  reports: 'access.feature.reports',
  monthly_pack: 'access.feature.monthlyPack',
  unified_file: 'access.feature.unifiedFile',
  pcn874: 'access.feature.pcn874',
  bank_matches: 'access.feature.bankMatches',
  notes: 'access.feature.notes',
};

export const FEATURE_KEYS = Object.keys(FEATURE_LABEL_KEYS) as (keyof AccessFeatures)[];

export const DEFAULT_FEATURES: AccessFeatures = {
  income_documents: true,
  expenses: true,
  clients: true,
  reports: true,
  monthly_pack: true,
  unified_file: true,
  pcn874: true,
  bank_matches: false,
  notes: true,
};
