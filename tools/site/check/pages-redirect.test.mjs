// The old GitHub Pages files send visitors and crawlers to the new site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SITE_URL } from './site-files.mjs';

for (const [file, target] of [['index.html', `${SITE_URL}/`], ['he.html', `${SITE_URL}/he/`]]) {
  test(`docs/${file} redirects to ${target}`, () => {
    const html = readFileSync(join(ROOT, 'docs', file), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="${target}">`));
    assert.ok(html.includes(`<meta http-equiv="refresh" content="0; url=${target}">`));
    assert.ok(html.includes('location.replace('));
    assert.ok(html.includes(`<a href="${target}">`));
    assert.ok(html.includes('<meta name="robots" content="noindex, follow">'));
    assert.match(html, /"options": "[^"]+\/pricing\/"/);
  });
}
