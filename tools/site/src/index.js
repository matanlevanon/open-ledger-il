/**
 * open-ledger-site: the product site Worker. Dependency free.
 *
 * It serves the static files in site/ through the ASSETS binding and does five things on top:
 *   1. 301 from the www. host and from the workers.dev address to siteUrl, so one host is indexed.
 *   2. 301 from every host in legacyHosts (and its www.) to the same page on siteUrl. Hebrew moved
 *      from /he/ to the root and English from the root to /en/, so the path is mapped on the way.
 *      On siteUrl itself an old /he/ path also answers 301 to its root form.
 *   3. 301 from the GitHub Pages era paths: /index.html, /he.html, /docs/*.
 *   4. Security headers on every reply, with a Content-Security-Policy that allows only this site,
 *      the analytics hosts set in site.config.json and the contact endpoint. Fonts are self-hosted.
 *   5. The search console verification file named in searchVerification.googleFile, served as
 *      Google expects it on every host, with no redirect. Empty: no such file.
 *   6. Cache headers: hashed assets one year immutable, other assets a day, pages 10 minutes, and
 *      a Link header with the hreflang alternates on the two home pages.
 * Every address comes from site.config.json at the repository root, so a fork changes one file.
 */
import config from '../../../site.config.json';

const SITE = new URL(config.siteUrl);
/** Hosts the site used to live on. Each answers 301 to the same page on siteUrl. */
export const LEGACY_HOSTS = (config.legacyHosts ?? []).map((h) => String(h).toLowerCase());
/** Files that kept their path when the languages moved. */
const SAME_PATH = new Set(['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/favicon.svg', '/404.html']);
const REPO = String(config.repoUrl).replace(/\/+$/, '');
const HASHED = /\.[0-9a-f]{8}\.[a-z0-9]+$/;

function origin(url) {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

/** The Content-Security-Policy, built once from the config. */
export function contentSecurityPolicy(cfg = config) {
  const a = cfg.analytics ?? {};
  const script = ["'self'", "'unsafe-inline'"];
  const connect = ["'self'"];
  const img = ["'self'", 'data:'];
  const contact = origin(cfg.contactEndpoint);
  if (contact) connect.push(contact);
  if (a.cfBeaconToken) {
    script.push('https://static.cloudflareinsights.com');
    connect.push('https://cloudflareinsights.com');
  }
  if (a.ga4Id) {
    script.push('https://www.googletagmanager.com');
    connect.push('https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com');
    img.push('https://www.google-analytics.com', 'https://www.googletagmanager.com');
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src ${img.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const CSP = contentSecurityPolicy();

/** Google Search Console's HTML file check: `/<name>.html` answering `google-site-verification: <name>.html`. */
export function verificationFor(url, cfg = config) {
  const file = String(cfg.searchVerification?.googleFile ?? '').trim();
  if (!/^google[0-9a-f]+\.html$/.test(file) || url.pathname !== `/${file}`) return null;
  return new Response(`google-site-verification: ${file}`, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

const redirect = (to) => new Response(null, { status: 301, headers: { Location: to, 'Cache-Control': 'public, max-age=3600' } });

const isLegacy = (host) => LEGACY_HOSTS.some((h) => host === h || host === `www.${h}`);

/** /he and /he/... to / and /..., the Hebrew pages' place since they moved to the root. */
function fromHe(path) {
  if (path === '/he') return '/';
  return path.startsWith('/he/') ? path.slice('/he'.length) : null;
}

/** A path on a legacy host, mapped to the same page on siteUrl: Hebrew to the root, English to /en/. */
export function legacyPath(path) {
  const he = fromHe(path);
  if (he !== null) return he;
  if (SAME_PATH.has(path) || path.startsWith('/assets/') || path === '/en' || path.startsWith('/en/')) return path;
  if (path === '/index.html') return '/en/';
  if (path === '/he.html') return '/';
  return `/en${path}`;
}

/** The 301 for this request, or null. */
export function redirectFor(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (path === '/docs' || path === '/docs/') return redirect(`${REPO}/tree/main/docs`);
  if (path.startsWith('/docs/')) return redirect(`${REPO}/blob/main/docs/${path.slice('/docs/'.length)}`);
  if (isLegacy(host)) return redirect(`${SITE.origin}${legacyPath(path)}${url.search}`);
  const he = fromHe(path);
  const moved = path === '/index.html' ? '/' : path === '/he.html' ? '/' : he;
  if (host === `www.${SITE.hostname}` || host.endsWith('.workers.dev')) {
    return redirect(`${SITE.origin}${moved ?? path}${url.search}`);
  }
  if (moved !== null) return redirect(`${url.origin}${moved}${url.search}`);
  return null;
}

function cacheControl(path, type) {
  if (path.startsWith('/assets/')) return HASHED.test(path) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
  if (type.includes('text/html')) return 'public, max-age=600';
  return 'public, max-age=600';
}

const HOME_LINK = [
  `<${SITE.origin}/>; rel="alternate"; hreflang="he"`,
  `<${SITE.origin}/en/>; rel="alternate"; hreflang="en"`,
  `<${SITE.origin}/>; rel="alternate"; hreflang="x-default"`,
].join(', ');

/** Adds the security, cache and hreflang headers to a reply from the assets. */
export function withHeaders(res, path) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('X-Frame-Options', 'DENY');
  if (res.status === 200 || res.status === 304) h.set('Cache-Control', cacheControl(path, h.get('Content-Type') ?? ''));
  else if (res.status === 404) h.set('Cache-Control', 'public, max-age=60');
  if (path === '/' || path === '/en/') h.set('Link', HOME_LINK);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The verification file answers on every host, the legacy ones too, before any redirect.
    const verification = verificationFor(url);
    if (verification) return verification;
    const moved = redirectFor(url);
    if (moved) return withHeaders(moved, url.pathname);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withHeaders(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }), url.pathname);
    }
    return withHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
};
