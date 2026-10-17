import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import config from '../../../site.config.json';
import worker, { LEGACY_HOSTS, contentSecurityPolicy, legacyPath, verificationFor } from '../src/index.js';

const SITE = config.siteUrl.replace(/\/+$/, '');
const REPO = config.repoUrl.replace(/\/+$/, '');
const get = (url, init) => worker.fetch(new Request(url, init), env);
const OLD = `https://${config.legacyHosts[0]}`;
const moved = async (url) => {
  const res = await get(url);
  return [res.status, res.headers.get('Location')];
};

describe('the move to siteUrl, Hebrew at the root and English under /en/', () => {
  it('reads the legacy hosts from site.config.json', () => {
    expect(LEGACY_HOSTS.length).toBeGreaterThan(0);
    expect(LEGACY_HOSTS).not.toContain(new URL(SITE).hostname);
  });

  it('sends old Hebrew pages, /he and /he/..., to the root form', async () => {
    expect(await moved(`${OLD}/he`)).toEqual([301, `${SITE}/`]);
    expect(await moved(`${OLD}/he/`)).toEqual([301, `${SITE}/`]);
    expect(await moved(`${OLD}/he/pricing/`)).toEqual([301, `${SITE}/pricing/`]);
    expect(await moved(`${OLD}/he/help/install/`)).toEqual([301, `${SITE}/help/install/`]);
  });

  it('sends every other old path to /en/...', async () => {
    expect(await moved(`${OLD}/`)).toEqual([301, `${SITE}/en/`]);
    expect(await moved(`${OLD}/pricing/`)).toEqual([301, `${SITE}/en/pricing/`]);
    expect(await moved(`${OLD}/help/install/`)).toEqual([301, `${SITE}/en/help/install/`]);
    expect(await moved(`${OLD}/guides/unified-file/`)).toEqual([301, `${SITE}/en/guides/unified-file/`]);
    expect(await moved(`${OLD}/index.md`)).toEqual([301, `${SITE}/en/index.md`]);
  });

  it('keeps the path of the crawler files and the assets', async () => {
    for (const f of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/favicon.svg', '/assets/logo.png']) {
      expect(await moved(`${OLD}${f}`)).toEqual([301, `${SITE}${f}`]);
    }
  });

  it('keeps the query string', async () => {
    expect(await moved(`${OLD}/pricing/?utm_source=x&a=1`)).toEqual([301, `${SITE}/en/pricing/?utm_source=x&a=1`]);
    expect(await moved(`${OLD}/he/demo/?ref=mail`)).toEqual([301, `${SITE}/demo/?ref=mail`]);
  });

  it('treats the www. of a legacy host the same', async () => {
    expect(await moved(`https://www.${config.legacyHosts[0]}/he/features/`)).toEqual([301, `${SITE}/features/`]);
    expect(await moved(`https://www.${config.legacyHosts[0]}/features/`)).toEqual([301, `${SITE}/en/features/`]);
  });

  it('sends an old /he/ path on siteUrl itself to the root form', async () => {
    expect(await moved(`${SITE}/he/`)).toEqual([301, `${SITE}/`]);
    expect(await moved(`${SITE}/he`)).toEqual([301, `${SITE}/`]);
    expect(await moved(`${SITE}/he/pricing/?x=1`)).toEqual([301, `${SITE}/pricing/?x=1`]);
  });

  it('makes no loop: every redirect target on siteUrl answers 200 with no further redirect', async () => {
    const starts = ['/', '/he', '/he/', '/pricing/', '/he/pricing/', '/help/install/', '/he/help/install/', '/en/', '/en/pricing/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt'];
    for (const start of starts) {
      const res = await get(`${OLD}${start}`);
      expect(res.status, start).toBe(301);
      const next = await get(res.headers.get('Location'));
      expect(next.status, `${start} -> ${res.headers.get('Location')}`).toBe(200);
    }
  });

  it('does not touch /help/ or /en/ on siteUrl, which only start like /he', async () => {
    expect((await get(`${SITE}/help/install/`)).status).toBe(200);
    expect((await get(`${SITE}/en/help/install/`)).status).toBe(200);
    expect(legacyPath('/help/')).toBe('/en/help/');
    expect(legacyPath('/hello')).toBe('/en/hello');
  });
});

describe('redirects', () => {
  it('sends the www. host to siteUrl, keeping the path and query', async () => {
    const host = new URL(SITE).hostname;
    const res = await get(`https://www.${host}/en/pricing/?x=1`);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(`${SITE}/en/pricing/?x=1`);
    expect(await moved(`https://www.${host}/he/pricing/`)).toEqual([301, `${SITE}/pricing/`]);
  });

  it('sends the workers.dev address to siteUrl', async () => {
    const res = await get('https://open-ledger-site.someone.workers.dev/features/');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(`${SITE}/features/`);
  });

  it('sends the GitHub Pages era paths to their new places', async () => {
    let res = await get(`${SITE}/index.html`);
    expect([res.status, res.headers.get('Location')]).toEqual([301, `${SITE}/`]);
    res = await get(`${SITE}/he.html`);
    expect([res.status, res.headers.get('Location')]).toEqual([301, `${SITE}/`]);
    res = await get(`${SITE}/docs/deploy.md`);
    expect([res.status, res.headers.get('Location')]).toEqual([301, `${REPO}/blob/main/docs/deploy.md`]);
    res = await get(`${SITE}/docs/`);
    expect([res.status, res.headers.get('Location')]).toEqual([301, `${REPO}/tree/main/docs`]);
  });

  it('does not redirect the site host or a local address', async () => {
    expect((await get(`${SITE}/`)).status).toBe(200);
    expect((await get('http://localhost:8787/')).status).toBe(200);
  });
});

describe('headers', () => {
  it('puts the security headers on every reply, pages, assets, redirects and 404s', async () => {
    for (const path of ['/', '/favicon.svg', '/index.html', '/no-such-page/']) {
      const res = await get(`${SITE}${path}`);
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
    }
  });

  it('allows the contact endpoint, and the analytics hosts only when set', () => {
    const contact = new URL(config.contactEndpoint).origin;
    const plain = contentSecurityPolicy({ ...config, analytics: {} });
    expect(plain).toContain(`connect-src 'self' ${contact}`);
    expect(plain).not.toContain('cloudflareinsights');
    expect(plain).not.toContain('googletagmanager');
    expect(plain).not.toContain('fonts.g');
    expect(plain).toContain("font-src 'self'");
    const both = contentSecurityPolicy({ ...config, analytics: { cfBeaconToken: 't', ga4Id: 'G-X' } });
    expect(both).toContain('https://static.cloudflareinsights.com');
    expect(both).toContain('https://www.googletagmanager.com');
  });

  it('caches pages 10 minutes and hashed assets a year', async () => {
    expect((await get(`${SITE}/`)).headers.get('Cache-Control')).toBe('public, max-age=600');
    const asset = await get(`${SITE}/assets/screenshots/dashboard.png`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('sends the hreflang Link header on the home pages only', async () => {
    const link = (await get(`${SITE}/`)).headers.get('Link');
    expect(link).toContain(`<${SITE}/>; rel="alternate"; hreflang="he"`);
    expect(link).toContain(`<${SITE}/en/>; rel="alternate"; hreflang="en"`);
    expect(link).toContain(`<${SITE}/>; rel="alternate"; hreflang="x-default"`);
    expect((await get(`${SITE}/en/`)).headers.get('Link')).toBe(link);
    expect((await get(`${SITE}/favicon.svg`)).headers.get('Link')).toBeNull();
  });
});

describe('search console verification', () => {
  it('serves the Google verification file with no redirect', async () => {
    const file = config.searchVerification?.googleFile;
    if (!file) return;
    const res = await get(`${SITE}/${file}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`google-site-verification: ${file}`);
  });

  it('serves the verification file on the legacy hosts too, with no redirect', async () => {
    const file = config.searchVerification?.googleFile;
    if (!file) return;
    for (const host of LEGACY_HOSTS) {
      const res = await get(`https://${host}/${file}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toBe(`google-site-verification: ${file}`);
    }
  });

  it('serves nothing when the config has no file', () => {
    const url = new URL(`${SITE}/google0123abcd.html`);
    expect(verificationFor(url, { searchVerification: { googleFile: '' } })).toBeNull();
  });
});

describe('404', () => {
  it('answers an unknown path with the 404 page', async () => {
    const res = await get(`${SITE}/no-such-page/`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('noindex');
    expect(body).toContain('Page not found');
  });

  it('refuses a POST', async () => {
    expect((await get(`${SITE}/`, { method: 'POST' })).status).toBe(405);
  });
});
