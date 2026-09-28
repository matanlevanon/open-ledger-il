import { usePreferences } from '../app/preferences';
import { en } from './messages/en';
import { he } from './messages/he';

export type MessageKey = keyof typeof en;

const catalogs = { en, he };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Renders a message in the signed-in interface language (R16 task 16). */
export function useT() {
  const { locale } = usePreferences();
  const catalog = catalogs[locale];
  return (key: MessageKey, vars?: Record<string, string | number>) => interpolate(catalog[key], vars);
}
