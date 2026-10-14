import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import config from '../../../site.config.json';
import worker, { contentSecurityPolicy } from '../src/index.js';

const SITE = config.siteUrl.replace(/\/+$/, '');
const REPO = config.repoUrl.replace(/\/+$/, '');
const get = (url, init) => worker.fetch(new Request(url, init), env);

describe('redirects', () => {
  it('sends the www. host to siteUrl, keeping the path and query', async () => {
    const host = new URL(SITE).hostname;
    const res = await get(`https://www.${host}/he/pricing/?x=1`);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(`${SITE}/he/pricing/?x=1`);
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
    expect([res.status, res.headers.get('Location')]).toEqual([301, `${SITE}/he/`]);
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
    expect(link).toContain(`<${SITE}/>; rel="alternate"; hreflang="en"`);
    expect(link).toContain(`<${SITE}/he/>; rel="alternate"; hreflang="he"`);
    expect(link).toContain('hreflang="x-default"');
    expect((await get(`${SITE}/favicon.svg`)).headers.get('Link')).toBeNull();
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
