import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { he } from './messages/he';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A `t(` call whose first argument is a quoted literal: `t('some.key')` or `t("some.key", {...})`.
 * Excludes `foo.t(...)` and `format(...)`-style false positives (requires a non-word, non-dot
 * character — or the start of the file — right before the `t`). */
const T_CALL = /(?<![\w.])t\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.tsx') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/**
 * R16 task 16: "Add a test that fails if any component renders a string not found in both
 * message files." Two checks: the en/he catalogs must have exactly the same keys (TypeScript
 * already enforces this at compile time via `Record<keyof typeof en, string>`; this is the
 * runtime backstop, e.g. against an `as any` escape hatch), and every `t('literal.key')` call
 * site found anywhere in the source tree must resolve to a key that actually exists in the
 * catalog — a typo'd or removed key fails this test.
 */
describe('i18n message catalogs', () => {
  it('has exactly the same keys in en and he', () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it('every t(...) call site uses a key present in both catalogs', () => {
    const keys = new Set(Object.keys(en));
    const missing: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(T_CALL)) {
        const key = match[1]!;
        if (!keys.has(key)) missing.push(`${file}: t('${key}')`);
      }
    }
    expect(missing).toEqual([]);
  });
});
