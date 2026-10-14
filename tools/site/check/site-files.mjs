// Shared helpers for the checks over the built site/ folder. Node only, no dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SITE = join(ROOT, 'site');
export const CONFIG = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
export const SITE_URL = CONFIG.siteUrl.replace(/\/+$/, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every built page: { file, path (URL path), html }. The 404 page is left out. */
export function pages() {
  return walk(SITE)
    .filter((f) => f.endsWith('index.html'))
    .map((file) => {
      const rel = relative(SITE, file).replace(/\\/g, '/');
      const path = `/${rel.replace(/index\.html$/, '')}`;
      return { file, path, html: readFileSync(file, 'utf8') };
    });
}

export function allFiles() {
  return walk(SITE).map((f) => relative(SITE, f).replace(/\\/g, '/'));
}

export function attr(html, re) {
  return [...html.matchAll(re)].map((m) => m[1]);
}
