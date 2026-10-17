// The files for crawlers and AI answers: sitemap, robots, llms.txt, llms-full.txt and index.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, SITE_URL, pages } from './site-files.mjs';

const all = pages();
const isDraft = (p) => p.html.includes('name="robots" content="noindex');
const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
const full = readFileSync(join(SITE, 'llms-full.txt'), 'utf8');

test('the sitemap lists every published page and no draft, with both language alternates', () => {
  for (const p of all) {
    const loc = `<loc>${SITE_URL}${p.path}</loc>`;
    if (isDraft(p)) assert.ok(!sitemap.includes(loc), `${p.path} is a draft and must stay out`);
    else assert.ok(sitemap.includes(loc), `${p.path} missing from the sitemap`);
  }
  const blocks = sitemap.split('<url>').slice(1);
  for (const b of blocks) {
    assert.match(b, /hreflang="he"/);
    assert.match(b, /hreflang="en"/);
    assert.match(b, /hreflang="x-default"/);
    assert.match(b, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  }
});

test('robots.txt allows every crawler and points at the sitemap', () => {
  const robots = readFileSync(join(SITE, 'robots.txt'), 'utf8');
  assert.match(robots, /User-agent: \*\nAllow: \//);
  assert.ok(!/Disallow/.test(robots));
  assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
});

test('llms.txt has a title, a summary with the certificate and prices, and links to published pages only', () => {
  assert.match(llms, /^# Open Ledger IL\n\n> /);
  assert.match(llms, /281801/);
  assert.match(llms, /₪699/);
  for (const p of all) {
    const url = `(${SITE_URL}${p.path})`;
    if (isDraft(p)) assert.ok(!llms.includes(url), `${p.path} is a draft`);
    else assert.ok(llms.includes(url), `${p.path} missing from llms.txt`);
  }
});

test('every published page has a Markdown twin, linked from the page, and in llms-full.txt', () => {
  for (const p of all) {
    const md = join(SITE, p.path, 'index.md');
    if (isDraft(p)) {
      assert.ok(!existsSync(md), `${p.path} is a draft and gets no index.md`);
      continue;
    }
    assert.ok(existsSync(md), `${p.path}index.md`);
    assert.ok(p.html.includes(`<link rel="alternate" type="text/markdown" href="${p.path}index.md">`), `${p.path}: markdown link`);
    const text = readFileSync(md, 'utf8');
    assert.match(text, /^# /m, `${p.path}: a heading`);
    assert.ok(!/<[a-z][^>]*>/i.test(text.replace(/`[^`]*`/g, '')), `${p.path}: no HTML left`);
    assert.ok(full.includes(`Source: ${SITE_URL}${p.path}\n`), `${p.path} missing from llms-full.txt`);
  }
});

test('home and pricing carry the key facts block', () => {
  for (const path of ['/', '/en/', '/pricing/', '/en/pricing/']) {
    const p = all.find((x) => x.path === path);
    assert.ok(p.html.includes('id="key-facts"'), `${path}: key facts`);
    assert.match(p.html, /281801/);
    assert.match(p.html, /FSL-1\.1/);
  }
});

test('every page in the sitemap exists in site/', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0);
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${SITE_URL}/`), `${loc} is not on ${SITE_URL}`);
    const path = loc.slice(SITE_URL.length);
    assert.ok(path.endsWith('/') && existsSync(join(SITE, path, 'index.html')), `${loc} has no page in site/`);
  }
  for (const href of [...sitemap.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(existsSync(join(SITE, href.slice(SITE_URL.length), 'index.html')), `alternate ${href} has no page in site/`);
  }
});

test('Hebrew sits at the root and English under /en/, in the sitemap and llms.txt', () => {
  assert.ok(sitemap.includes(`<loc>${SITE_URL}/</loc>`));
  assert.ok(sitemap.includes(`<loc>${SITE_URL}/en/</loc>`));
  assert.ok(!sitemap.includes(`${SITE_URL}/he/`), 'no /he/ address left in the sitemap');
  assert.ok(!llms.includes(`${SITE_URL}/he/`), 'no /he/ address left in llms.txt');
  assert.ok(!full.includes(`${SITE_URL}/he/`), 'no /he/ address left in llms-full.txt');
});
