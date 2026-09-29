#!/usr/bin/env node
// Builds a demo unified file (מבנה אחיד) for the Tax Authority's checker, from a demo year of
// documents issued through the real API in a throwaway local database. Never touches a live one.
//
// Usage (from the repository root):
//   node scripts/demo-unified-file.mjs --vat 123456782 --name "עסק לדוגמה"
// Optional: --registration 12345678 once the Tax Authority has issued a registration number.
//
// Writes demo/output/: the zip, INI.TXT and BKMVDATA.TXT ready to upload to the checker, and the
// section 5.4 and 2.6 printouts as HTML pages to print or save as PDF.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'demo', 'output');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const env = {
  ...process.env,
  DEMO_VAT: (arg('vat') ?? '').replace(/\D/g, ''),
  DEMO_NAME_HE: arg('name') ?? '',
  DEMO_REGISTRATION_NUMBER: (arg('registration') ?? '').replace(/\D/g, ''),
};

console.log('Issuing the demo year and building the file. This takes about a minute...');
const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const run = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.demo.config.ts', '--silent=false', '--reporter=verbose'], {
  cwd: ROOT,
  env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
if (run.status !== 0) {
  console.error(output.slice(-4000));
  console.error('The demo run failed. See the error above.');
  process.exit(1);
}

const summaryLine = output.split(/\r?\n/).find((l) => l.includes('@@SUMMARY@@'));
const zipB64 = output
  .split(/\r?\n/)
  .filter((l) => l.includes('@@ZIP@@'))
  .map((l) => l.slice(l.indexOf('@@ZIP@@') + 7).trim())
  .join('');
if (!summaryLine || !zipB64) {
  console.error('The demo ran but printed no file. Output tail:');
  console.error(output.slice(-2000));
  process.exit(1);
}
const { summary, report } = JSON.parse(summaryLine.slice(summaryLine.indexOf('@@SUMMARY@@') + 11));
const zip = Buffer.from(zipB64, 'base64');

mkdirSync(OUT, { recursive: true });
const parts = summary.path.split('\\');
const zipName = `OPENFRMT-${parts.at(-2)}-${parts.at(-1)}-demo.zip`;
writeFileSync(join(OUT, zipName), zip);
const outer = unzipSync(new Uint8Array(zip));
for (const [name, bytes] of Object.entries(outer)) {
  if (name.endsWith('INI.TXT')) writeFileSync(join(OUT, 'INI.TXT'), bytes);
  if (name.endsWith('BKMVDATA.zip')) writeFileSync(join(OUT, 'BKMVDATA.TXT'), unzipSync(bytes)['BKMVDATA.TXT']);
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ summary, report }, null, 2));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const shekels = (minor) => `₪${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const page = (title, body) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:32px}h2{font-size:17px;text-decoration:underline}
table{border-collapse:collapse;margin:10px 0;min-width:380px}th,td{border:1px solid #999;padding:4px 10px;text-align:right}th{background:#eee}
.ltr{direction:ltr;unicode-bidi:isolate}</style></head><body>${body}</body></html>`;
const footer = `<p>הנתונים הופקו באמצעות תוכנת: ${esc(summary.software.name)}, מספר תעודת הרישום: <span class="ltr">${esc(summary.software.registrationNumber || '-')}</span></p>
<p>בתאריך: <span class="ltr">${esc(summary.generatedDate)}</span> בשעה: <span class="ltr">${esc(summary.generatedTime)}</span></p>`;

writeFileSync(
  join(OUT, 'printout-5.4.html'),
  page(
    'הפקת קבצים במבנה אחיד',
    `<h2>הפקת קבצים במבנה אחיד</h2>
<p><b>מספר עוסק מורשה:</b> <span class="ltr">${esc(summary.vatNumber)}</span></p>
<p><b>שם בית העסק:</b> ${esc(summary.businessName)}</p>
<p><b>** ביצוע ממשק פתוח הסתיים בהצלחה **</b></p>
<p><b>הנתונים נשמרו בנתיב:</b> <span class="ltr">${esc(summary.path)}</span></p>
<p><b>טווח תאריכים:</b> מתאריך: <span class="ltr">${ddmmyyyy(summary.from)}</span> ועד תאריך: <span class="ltr">${ddmmyyyy(summary.to)}</span></p>
<p><b>פירוט סך סוגי הרשומות בקובץ BKMVDATA.TXT:</b></p>
<table><tr><th>סוג רשומה</th><th>תיאור</th><th>כמות</th></tr>
${summary.records.map((r) => `<tr><td>${r.code}</td><td>${esc(r.nameHe)}</td><td>${r.count}</td></tr>`).join('\n')}
<tr><td colspan="2"><b>סה"כ</b></td><td><b>${summary.totalRecords}</b></td></tr></table>
${footer}`,
  ),
);

const totals = summary.documentTypes.reduce((a, x) => ({ count: a.count + x.count, total: a.total + x.totalIlsMinor }), { count: 0, total: 0 });
writeFileSync(
  join(OUT, 'printout-2.6.html'),
  page(
    'פירוט סוגי המסמכים',
    `<h2>פירוט סוגי המסמכים</h2>
<p>מספר עוסק מורשה: <span class="ltr">${esc(summary.vatNumber)}</span> · שם בית העסק: ${esc(summary.businessName)}</p>
<p>טווח תאריכים: מתאריך <span class="ltr">${ddmmyyyy(summary.from)}</span> ועד תאריך <span class="ltr">${ddmmyyyy(summary.to)}</span></p>
<table><tr><th>מספר מסמך</th><th>סוג מסמך</th><th>סה"כ כמותי</th><th>סה"כ כספי (בש"ח)</th></tr>
${summary.documentTypes.map((t) => `<tr><td>${t.code}</td><td>${esc(t.nameHe)}</td><td>${t.count}</td><td class="ltr">${shekels(t.totalIlsMinor)}</td></tr>`).join('\n')}
<tr><td colspan="2"><b>סה"כ</b></td><td><b>${totals.count}</b></td><td class="ltr"><b>${shekels(totals.total)}</b></td></tr></table>
${footer}`,
  ),
);

console.log(`Done: ${summary.totalRecords} records, ${totals.count} documents.`);
for (const r of summary.records) console.log(`  ${r.code}  ${r.count}`);
for (const w of report.warnings) console.log(`  Note: ${w}`);
console.log(`Files in ${OUT}:`);
console.log(`  ${zipName}, INI.TXT, BKMVDATA.TXT, printout-5.4.html, printout-2.6.html, summary.json`);
