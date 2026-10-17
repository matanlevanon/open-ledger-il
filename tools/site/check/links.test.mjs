// Every internal link and asset on every page resolves to a file in site/, every external link is
// a well formed address, and every hreflang pair points both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, SITE, SITE_URL, attr, pages } from './site-files.mjs';

const all = pages();

/** The file a site path is served from, with the Worker's auto trailing slash rules. */
function resolves(path) {
  const clean = decodeURIComponent(path.split('#')[0].split('?')[0]);
  if (clean === '' ) return true;
  const file = join(SITE, clean);
  if (clean.endsWith('/')) return existsSync(join(file, 'index.html'));
  if (existsSync(file) && statSync(file).isFile()) return true;
  return existsSync(`${file}.html`) || existsSync(join(file, 'index.html'));
}

test('every internal link, image, stylesheet and font resolves to a file', () => {
  let count = 0;
  for (const p of all) {
    const refs = [
      ...attr(p.html, /\s(?:href|src)="([^"]+)"/g),
      ...attr(p.html, /\ssrcset="([^"\s]+)/g),
      ...attr(p.html, /url\(([^)]+)\)/g),
    ];
    for (let ref of refs) {
      if (ref.startsWith(SITE_URL)) ref = ref.slice(SITE_URL.length) || '/';
      if (/^(https?:|mailto:|data:|#)/.test(ref)) continue;
      assert.ok(ref.startsWith('/'), `${p.path}: relative link ${ref}`);
      assert.ok(resolves(ref), `${p.path}: ${ref} does not resolve`);
      count++;
    }
  }
  assert.ok(count > 500, `checked ${count} internal links`);
});

test('every in-page anchor exists on its page', () => {
  for (const p of all) {
    const ids = new Set(attr(p.html, /\sid="([^"]+)"/g));
    for (const href of attr(p.html, /\shref="#([^"]+)"/g)) assert.ok(ids.has(href), `${p.path}: #${href} has no target`);
  }
});

test('every external link is a well formed https or mailto address', () => {
  for (const p of all) {
    for (const href of attr(p.html, /\s(?:href|src|content)="(https?:[^"]+)"/g)) {
      const url = new URL(href);
      assert.ok(url.protocol === 'https:' || url.hostname === 'localhost', `${p.path}: ${href} is not https`);
      assert.ok(url.hostname.includes('.'), `${p.path}: ${href} has no real host`);
    }
  }
});

test('every hreflang pair points both ways, and x-default is the Hebrew page', () => {
  const byUrl = new Map(all.map((p) => [`${SITE_URL}${p.path}`, p]));
  const alternates = (p) =>
    Object.fromEntries([...p.html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
  for (const p of all) {
    const alt = alternates(p);
    const self = `${SITE_URL}${p.path}`;
    const lang = p.path.startsWith('/en/') ? 'en' : 'he';
    assert.equal(alt[lang], self, `${p.path}: hreflang ${lang} must point at itself`);
    assert.equal(alt['x-default'], alt.he, `${p.path}: x-default`);
    for (const [l, href] of Object.entries(alt)) {
      if (l === 'x-default') continue;
      const other = byUrl.get(href);
      assert.ok(other, `${p.path}: hreflang ${l} points at ${href}, which is not a page`);
      assert.equal(alternates(other)[lang], self, `${href} does not point back to ${self}`);
    }
  }
});

test('every page has one h1, a canonical to itself, and a title and description in range', () => {
  for (const p of all) {
    assert.equal((p.html.match(/<h1[\s>]/g) ?? []).length, 1, `${p.path}: one h1`);
    assert.ok(p.html.includes(`<link rel="canonical" href="${SITE_URL}${p.path}">`), `${p.path}: canonical`);
    const title = /<title>([^<]*)<\/title>/.exec(p.html)[1].replace(/&amp;/g, '&');
    const desc = /<meta name="description" content="([^"]*)">/.exec(p.html)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
    assert.ok(title.length < 60, `${p.path}: title ${title.length}`);
    assert.ok(desc.length < 155, `${p.path}: description ${desc.length}`);
    assert.match(p.html, /<meta property="og:image" content="https:\/\/[^"]+\.png">/, `${p.path}: og:image`);
  }
});

test('every link to another site opens in a new tab with rel noopener', () => {
  let count = 0;
  for (const p of all) {
    for (const tag of p.html.match(/<a\b[^>]*>/g) ?? []) {
      const href = /\shref="(https?:\/\/[^"]+)"/.exec(tag)?.[1];
      if (!href || href.startsWith(SITE_URL)) continue;
      count++;
      assert.match(tag, /\starget="_blank"/, `${p.path}: ${tag}`);
      assert.match(tag, /\srel="[^"]*\bnoopener\b/, `${p.path}: ${tag}`);
    }
  }
  assert.ok(count > 10, `only ${count} external links checked`);
});

test('Hebrew pages sit at the root with lang he and rtl, English pages under /en/ with lang en and ltr', () => {
  for (const p of all) {
    assert.ok(!p.path.startsWith('/he/'), `${p.path}: no page under /he/ any more`);
    const en = p.path.startsWith('/en/');
    assert.match(p.html, en ? /<html lang="en" dir="ltr">/ : /<html lang="he" dir="rtl">/, `${p.path}: lang and dir`);
    const blocks = [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    for (const b of blocks) if (typeof b.inLanguage === 'string') assert.equal(b.inLanguage, en ? 'en' : 'he', `${p.path}: ${b['@type']}.inLanguage`);
    const og = /<meta property="og:url" content="([^"]+)">/.exec(p.html)[1];
    assert.equal(og, `${SITE_URL}${p.path}`, `${p.path}: og:url`);
  }
});

test('the language switch on each page goes to its pair', () => {
  for (const p of all) {
    const sw = /<a class="lang" href="([^"]+)" hreflang="([^"]+)"/.exec(p.html);
    assert.ok(sw, `${p.path}: language switch`);
    const en = p.path.startsWith('/en/');
    assert.equal(sw[2], en ? 'he' : 'en');
    assert.equal(sw[1].startsWith('/en/'), !en, `${p.path}: switch to ${sw[1]}`);
  }
});

test('the Help install buy box goes to the shop buy page, Hebrew with ?lang=he', () => {
  const he = all.find((x) => x.path === '/help/install/');
  const en = all.find((x) => x.path === '/en/help/install/');
  assert.ok(he.html.includes(`href="${CONFIG.shopUrl}/buy?lang=he"`));
  assert.ok(en.html.includes(`href="${CONFIG.shopUrl}/buy"`));
});
