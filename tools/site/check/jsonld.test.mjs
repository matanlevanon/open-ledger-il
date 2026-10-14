// Parses every JSON-LD block on every built page and checks the required fields per type.
// Run: node --test tools/site/check/   (part of npm run test:site)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_URL, pages } from './site-files.mjs';

const REQUIRED = {
  Organization: ['name', 'url', 'logo', 'sameAs'],
  WebSite: ['name', 'url', 'inLanguage', 'publisher'],
  SoftwareApplication: ['name', 'applicationCategory', 'operatingSystem', 'offers', 'inLanguage'],
  BreadcrumbList: ['itemListElement'],
  Article: ['headline', 'dateModified', 'inLanguage', 'mainEntityOfPage', 'author', 'publisher', 'image'],
  FAQPage: ['mainEntity'],
  WebPage: ['name', 'url', 'description'],
};

function blocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

const all = pages();

test('every page has JSON-LD that parses, with schema.org types and their required fields', () => {
  assert.ok(all.length >= 32, `found ${all.length} pages`);
  for (const p of all) {
    const list = blocks(p.html);
    const types = list.map((b) => b['@type']);
    assert.ok(types.includes('Organization') && types.includes('WebSite'), `${p.path}: Organization and WebSite`);
    for (const b of list) {
      assert.equal(b['@context'], 'https://schema.org', `${p.path}: @context`);
      const need = REQUIRED[b['@type']];
      assert.ok(need, `${p.path}: unexpected type ${b['@type']}`);
      for (const field of need) assert.ok(b[field] !== undefined && b[field] !== '' && !(Array.isArray(b[field]) && !b[field].length), `${p.path}: ${b['@type']}.${field}`);
    }
  }
});

test('home and pricing carry a SoftwareApplication with the Free and ₪699 offers', () => {
  for (const path of ['/', '/he/', '/pricing/', '/he/pricing/']) {
    const p = all.find((x) => x.path === path);
    const app = blocks(p.html).find((b) => b['@type'] === 'SoftwareApplication');
    assert.ok(app, `${path}: SoftwareApplication`);
    assert.equal(app.applicationCategory, 'BusinessApplication');
    assert.equal(app.operatingSystem, 'Web');
    assert.deepEqual(app.inLanguage, ['he', 'en']);
    const prices = app.offers.map((o) => `${o.price} ${o.priceCurrency}`);
    assert.ok(prices.includes('0 ILS') && prices.includes('699 ILS'), `${path}: ${prices}`);
    for (const o of app.offers) assert.equal(o['@type'], 'Offer');
  }
});

test('inner pages carry a BreadcrumbList that ends at the page itself', () => {
  for (const p of all.filter((x) => x.path !== '/' && x.path !== '/he/')) {
    const crumbs = blocks(p.html).find((b) => b['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, `${p.path}: BreadcrumbList`);
    const items = crumbs.itemListElement;
    items.forEach((item, i) => {
      assert.equal(item['@type'], 'ListItem');
      assert.equal(item.position, i + 1);
      assert.ok(item.name && item.item.startsWith(SITE_URL), `${p.path}: item ${i + 1}`);
    });
    assert.equal(items.at(-1).item, `${SITE_URL}${p.path}`, `${p.path}: last crumb`);
  }
});

test('guides carry an Article and an FAQPage with questions and answers', () => {
  const guides = all.filter((x) => x.path.includes('/guides/') && !x.path.endsWith('/guides/'));
  assert.equal(guides.length, 16);
  for (const p of guides) {
    const list = blocks(p.html);
    const article = list.find((b) => b['@type'] === 'Article');
    assert.match(article.dateModified, /^\d{4}-\d{2}-\d{2}$/, `${p.path}: dateModified`);
    assert.ok(article.headline.length <= 110, `${p.path}: headline length`);
    const faq = list.find((b) => b['@type'] === 'FAQPage');
    assert.ok(faq.mainEntity.length >= 3 && faq.mainEntity.length <= 5, `${p.path}: 3 to 5 questions`);
    for (const q of faq.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.equal(q.acceptedAnswer['@type'], 'Answer');
      assert.ok(q.name && q.acceptedAnswer.text, `${p.path}: question text`);
    }
  }
});

test('the registration page describes the certificate in a WebPage', () => {
  for (const path of ['/registration/', '/he/registration/']) {
    const page = blocks(all.find((x) => x.path === path).html).find((b) => b['@type'] === 'WebPage');
    assert.match(page.description, /281801/);
    assert.match(page.description, /1\.1\.0/);
  }
});
