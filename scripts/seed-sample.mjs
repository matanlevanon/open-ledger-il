#!/usr/bin/env node
/**
 * R26: loads the demo's master sample set (demo/seed/sample-set.json) into a deployed demo.
 *
 *   RESET_SECRET=... node scripts/seed-sample.mjs https://open-ledger-sample-reset.<you>.workers.dev
 *
 * It asks the reset Worker to run: every visitor row and session is removed, then the masters load
 * when they are missing, older than the seed, or changed (R29). Migration-safe: it never touches the schema, and the masters
 * load through the Ledger's own services, so numbering and the hash chain are real. Running it
 * twice changes nothing the second time.
 */
const url = process.argv[2];
const secret = process.env.RESET_SECRET;
if (!url || !secret) {
  console.error('Usage: RESET_SECRET=<secret> node scripts/seed-sample.mjs <reset Worker URL>');
  process.exit(1);
}
const res = await fetch(`${url.replace(/\/+$/, '')}/run`, { method: 'POST', headers: { 'X-Reset-Secret': secret } });
const body = await res.json().catch(() => ({}));
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok && body.ok ? 0 : 1);
