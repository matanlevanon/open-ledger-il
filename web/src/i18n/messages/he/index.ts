import type { en } from '../en';
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

/** Assembled the same way as `en/index.ts`. Typed against `en`'s keys for compile-time parity. */
export const he: Record<keyof typeof en, string> = {
  ...common,
  ...dashboard,
  ...settings,
  ...documents,
  ...expenses,
  ...reports,
  ...ita,
  ...access,
  ...importFeature,
  ...analytics,
};
