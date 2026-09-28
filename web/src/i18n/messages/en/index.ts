import { access } from './access';
import { analytics } from './analytics';
import { common } from './common';
import { dashboard } from './dashboard';
import { documents } from './documents';
import { expenses } from './expenses';
import { importFeature } from './import';
import { ita } from './ita';
import { reports } from './reports';
import { settings } from './settings';

/**
 * The English message catalog: one flat, dotted-key dictionary assembled from a file per
 * migrated area (R16 task 16). `he/index.ts` is typed against this object's keys, so a key
 * missing from the Hebrew catalog is a TypeScript error at build time.
 */
export const en = { ...common, ...dashboard, ...settings, ...documents, ...expenses, ...reports, ...ita, ...access, ...importFeature, ...analytics };
