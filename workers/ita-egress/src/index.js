/**
 * Tax Authority egress for the Ledger.
 *
 * The Ledger's main Worker runs in whichever Cloudflare data center takes the request, and
 * Israeli users are often served from Frankfurt. The Tax Authority answered the token call from
 * Frankfurt with a bare HTTP 403 and accepted the same call from Tel Aviv. This Worker is placed
 * near Tel Aviv (wrangler.toml, placement.region = gcp:me-west1) and makes those calls instead.
 *
 * The main Worker reaches it only through a service binding, calling fetch() with the real Tax
 * Authority URL. Placement is honoured for fetch() over a service binding and ignored for RPC,
 * which is why this is a fetch handler and not an RPC method.
 *
 * It forwards two hosts only, under /shaam/tsandbox/ or /shaam/production/, GET and POST, with
 * three request headers. Nothing is logged: the bodies carry the client secret, the login code
 * and the tokens.
 */

const HOSTS = new Set(['openapi.taxes.gov.il', 'ita-api.taxes.gov.il']);
const PATH_RE = /^\/shaam\/(?:tsandbox|production)\/[A-Za-z0-9._~\-\/]+$/;
const PASS_HEADERS = ['authorization', 'content-type', 'accept'];
const TIMEOUT_MS = 30_000;

async function where() {
  // The data center this Worker runs in, read from Cloudflare's own trace endpoint.
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(5_000) });
    const text = await res.text();
    const field = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || null;
    return { colo: field('colo'), loc: field('loc') };
  } catch {
    return { colo: null, loc: null };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/__where') {
      return Response.json(await where());
    }

    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || !PATH_RE.test(url.pathname) || url.pathname.includes('..')) {
      return Response.json({ error: 'not a Tax Authority path' }, { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return Response.json({ error: 'GET and POST only' }, { status: 405 });
    }

    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = request.headers.get(h);
      if (v !== null) headers.set(h, v);
    }

    const upstream = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
      },
    });
  },
};
