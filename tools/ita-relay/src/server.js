/**
 * ita-relay. Forwards the Ledger's calls to the Israel Tax Authority from this
 * server's Israeli address.
 *
 * Why it exists: the Ledger is a Cloudflare Worker, and a Worker runs in
 * whichever Cloudflare data center takes the request. Israeli users are often
 * served from Frankfurt. The Tax Authority's token endpoint answered those
 * calls with a bare HTTP 403 on 6 October 2026, and the same login worked when
 * the Worker ran in Tel Aviv. Run this on a server in Israel, so calls that
 * leave from here leave from Israel.
 *
 * What it forwards, and nothing else:
 *   /openapi/shaam/<env>/...  ->  https://openapi.taxes.gov.il/shaam/<env>/...
 *   /ita-api/shaam/<env>/...  ->  https://ita-api.taxes.gov.il/shaam/<env>/...
 * where <env> is tsandbox or production. GET and POST only. Three request
 * headers pass through (Authorization, Content-Type, Accept). Every other
 * header, including Cloudflare's, is dropped. Redirects are not followed.
 *
 * Who it serves: one Access service token, verified on every request. See
 * access.js. Bodies and headers are never logged, because they carry the
 * client secret, the login code and the tokens.
 */

import { createServer } from 'node:http';
import { extractToken, makeCertsFetcher, verifyServiceToken } from './access.js';

const NAME = 'ita-relay';
const VERSION = '0.1.0';

const TARGETS = {
  openapi: 'https://openapi.taxes.gov.il',
  'ita-api': 'https://ita-api.taxes.gov.il',
};
const PATH_RE = /^\/(openapi|ita-api)(\/shaam\/(?:tsandbox|production)\/[A-Za-z0-9._~\-\/]+)$/;
const PASS_HEADERS = ['authorization', 'content-type', 'accept'];
const MAX_BODY = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

function config(env = process.env) {
  const missing = [];
  const need = (k) => {
    const v = (env[k] || '').trim();
    if (!v) missing.push(k);
    return v;
  };
  const team = need('CF_ACCESS_TEAM_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = need('CF_ACCESS_AUD');
  const ids = need('ITA_RELAY_ALLOWED_CLIENT_IDS');
  const bindAddr = need('ITA_RELAY_BIND_ADDR');
  if (missing.length) throw new Error(`missing ${missing.join(', ')}. See ita-relay.env.example.`);
  if (bindAddr === '0.0.0.0' || bindAddr === '::') throw new Error('ITA_RELAY_BIND_ADDR must be one local address, never all interfaces.');
  const port = Number(env.ITA_RELAY_PORT || 8788);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('ITA_RELAY_PORT is not a port.');
  return {
    issuer: `https://${team}`,
    certsUrl: `https://${team}/cdn-cgi/access/certs`,
    aud,
    allowedClientIds: ids.split(',').map((s) => s.trim()).filter(Boolean),
    bindAddr,
    port,
  };
}

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function handler(cfg, getCerts) {
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://relay.invalid');

    const verdict = await verifyServiceToken(extractToken(req.headers), {
      issuer: cfg.issuer,
      aud: cfg.aud,
      allowedClientIds: cfg.allowedClientIds,
      getCerts,
    });
    if (!verdict.ok) {
      log(`${req.method} ${url.pathname} refused ${verdict.status}: ${verdict.reason}`);
      return send(res, verdict.status, { error: verdict.status === 401 ? 'unauthenticated' : 'forbidden' });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, name: NAME, version: VERSION });
    }

    const m = PATH_RE.exec(url.pathname);
    if (!m || url.pathname.includes('..')) {
      log(`${req.method} ${url.pathname} refused 404: not a Tax Authority path`);
      return send(res, 404, { error: 'not a relayed path' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      return send(res, 405, { error: 'GET and POST only' });
    }

    let body;
    try {
      body = req.method === 'POST' ? await readBody(req) : undefined;
    } catch (err) {
      return send(res, 413, { error: err.message });
    }

    const headers = {};
    for (const h of PASS_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }

    const target = `${TARGETS[m[1]]}${m[2]}${url.search}`;
    let upstream;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      log(`${req.method} ${m[1]}${m[2]} upstream error after ${Date.now() - started}ms: ${err.name}`);
      return send(res, 502, { error: 'the Tax Authority did not answer the relay' });
    }
    const out = Buffer.from(await upstream.arrayBuffer());
    log(`${req.method} ${m[1]}${m[2]} ${upstream.status} ${out.length}B ${Date.now() - started}ms`);
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(out);
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  let cfg;
  try {
    cfg = config();
  } catch (err) {
    log(`${NAME} will not start: ${err.message}`);
    process.exit(1);
  }
  const getCerts = makeCertsFetcher({ certsUrl: cfg.certsUrl });
  createServer(handler(cfg, getCerts)).listen(cfg.port, cfg.bindAddr, () => {
    log(`${NAME} ${VERSION} listening on ${cfg.bindAddr}:${cfg.port}, ${cfg.allowedClientIds.length} service token(s) allowed`);
  });
}
