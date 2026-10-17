// Analytics are off until site.config.json sets an id. With ids set, the build adds Cloudflare Web
// Analytics and GA4 with IP anonymised and no ad features, and the two events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, ROOT, SITE, pages } from './site-files.mjs';

const PY = ['python3', 'py', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);

function build(config) {
  const dir = mkdtempSync(join(tmpdir(), 'site-analytics-'));
  cpSync(join(SITE, 'assets'), join(dir, 'site', 'assets'), { recursive: true });
  cpSync(join(SITE, 'data'), join(dir, 'site', 'data'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  const r = spawnSync(PY, [join(ROOT, 'scripts', 'build-site.py')], {
    cwd: ROOT,
    env: { ...process.env, SITE_OUT: join(dir, 'site'), SITE_CONFIG: join(dir, 'config.json') },
    encoding: 'utf8',
  });
  return { dir, r, read: (p) => readFileSync(join(dir, 'site', p), 'utf8') };
}

test('the committed site sends nothing: no analytics host on any page', () => {
  assert.equal(CONFIG.analytics.cfBeaconToken, '');
  assert.equal(CONFIG.analytics.ga4Id, '');
  for (const p of pages()) {
    assert.ok(!/cloudflareinsights|googletagmanager|gtag\(/.test(p.html.replace(/window\.gtag\('event', 'setup_request'\)/g, '')), `${p.path} loads analytics`);
  }
});

test('with ids set, Cloudflare Web Analytics and GA4 load, with IP anonymised and both events', { skip: !PY && 'no Python' }, () => {
  const { dir, r, read } = build({ ...CONFIG, analytics: { cfBeaconToken: '0123456789abcdef0123456789abcdef', ga4Id: 'G-TEST12345' } });
  try {
    assert.equal(r.status, 0, r.stderr);
    const home = read('index.html');
    assert.match(home, /static\.cloudflareinsights\.com\/beacon\.min\.js" data-cf-beacon='\{"token": "0123456789abcdef0123456789abcdef"\}'/);
    assert.match(home, /googletagmanager\.com\/gtag\/js\?id=G-TEST12345/);
    assert.match(home, /anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false/);
    assert.match(home, /gtag\('event', 'demo_click'/);
    assert.match(home, /data-demo/);
    assert.match(read('pricing/index.html'), /window\.gtag\('event', 'setup_request'\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed GA4 id stops the build', { skip: !PY && 'no Python' }, () => {
  const { dir, r } = build({ ...CONFIG, analytics: { cfBeaconToken: '', ga4Id: 'UA-123' } });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ga4Id must look like G-/);
});
