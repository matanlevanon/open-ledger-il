#!/usr/bin/env node
// Renders the 1200x630 Open Graph card of every page into site/assets/og/, with headless Chromium.
// Run after python3 scripts/build-site.py, which lists the pages in site-reports/og-pages.json.
// Usage: CHROME=<path to chrome or chrome-headless-shell> node scripts/render-og.mjs
// The cards are committed, so the Workers Builds build needs no browser.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME;
if (!chrome) {
  console.error('Set CHROME to a Chrome or chrome-headless-shell executable.');
  process.exit(1);
}
const config = JSON.parse(readFileSync(join(ROOT, 'site.config.json'), 'utf8'));
const host = new URL(config.siteUrl).host;
const pages = JSON.parse(readFileSync(join(ROOT, 'site-reports', 'og-pages.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fontDir = join(ROOT, 'site', 'assets', 'fonts');
const work = join(tmpdir(), `og-${process.pid}`);
mkdirSync(work, { recursive: true });

const logo = `<svg viewBox="0 0 32 32" width="72" height="72"><rect x="1" y="1" width="30" height="30" rx="8" fill="#141d2e" stroke="#26344b" stroke-width="1.5"/><rect x="8" y="6" width="16" height="20" rx="2.5" fill="none" stroke="#4f93ff" stroke-width="2"/><path d="M12 12h8M12 16h8" stroke="#35c46a" stroke-width="2" stroke-linecap="round"/><path d="M12 20h5" stroke="#9b6dff" stroke-width="2" stroke-linecap="round"/></svg>`;

function card(p) {
  const rtl = p.lang === 'he';
  const fontFace = ['hebrew', 'latin']
    .map((s) => `@font-face{font-family:Heebo;font-weight:400 800;src:url(${pathToFileURL(join(fontDir, `heebo-${s}.woff2`)).href}) format('woff2')}`)
    .join('');
  return `<!doctype html><html lang="${p.lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
${fontFace}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:linear-gradient(135deg,#0f172a 0%,#13213d 60%,#0f2a20 100%);color:#fff;font-family:Heebo,"Segoe UI",Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:64px 72px;box-sizing:border-box}
.top{display:flex;align-items:center;gap:20px;font-size:34px;font-weight:700}
h1{font-size:${p.title.length > 34 ? 60 : 72}px;line-height:1.12;margin:0;font-weight:800;letter-spacing:-.02em;max-width:1000px}
.kicker{font-size:28px;color:#a7b4c8;margin-top:22px;max-width:1000px;line-height:1.35}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:26px;color:#86efac}
.foot span{color:#a7b4c8;direction:ltr}
</style></head><body>
<div class="top">${logo}<span>Open Ledger IL</span></div>
<div><h1>${esc(p.title)}</h1><div class="kicker">${esc(p.kicker)}</div></div>
<div class="foot"><b>${rtl ? 'רשומה ברשות המסים · תעודה 281801' : 'Registered with the Israel Tax Authority · certificate 281801'}</b><span>${esc(host)}</span></div>
</body></html>`;
}

mkdirSync(join(ROOT, 'site', 'assets', 'og'), { recursive: true });
const all = [...pages, { file: 'og/default.png', title: 'Open Ledger IL', kicker: pages.find((p) => p.file === 'og/he-home.png')?.kicker ?? '', lang: 'he' }];
for (const p of all) {
  const html = join(work, `${p.file.replace(/[/\\]/g, '_')}.html`);
  writeFileSync(html, card(p));
  const out = join(ROOT, 'site', 'assets', p.file);
  execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--virtual-time-budget=3000', '--window-size=1200,630', `--screenshot=${out}`, pathToFileURL(html).href], { stdio: 'ignore' });
  console.log('rendered', p.file);
}
// The 512x512 logo the Organization structured data points at.
const logoHtml = join(work, 'logo.html');
writeFileSync(logoHtml, `<!doctype html><html><head><style>html,body{margin:0;width:512px;height:512px;background:transparent}svg{display:block}</style></head><body>${logo.replace('width="72" height="72"', 'width="512" height="512"')}</body></html>`);
execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', '--window-size=512,512', `--screenshot=${join(ROOT, 'site', 'assets', 'logo.png')}`, pathToFileURL(logoHtml).href], { stdio: 'ignore' });
console.log('rendered logo.png');
rmSync(work, { recursive: true, force: true });
