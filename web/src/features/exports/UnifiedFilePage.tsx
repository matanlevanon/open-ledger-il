import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useT } from '../../i18n';
import { Card, ErrorNote, PageTitle, btnPrimary, btnSecondary, input, label } from '../documents/ui';

/**
 * Unified file (מבנה אחיד), instructions 1.31. One step from the main menu (section 2.1 ב).
 * The dialog asks for the drive and the date range (appendix 4). After the run it downloads the
 * zip and shows the section 5.4 summary and the section 2.6 report, both printable. The two
 * printouts are in Hebrew, as the Tax Authority's samples are, whatever the interface language.
 */

interface Summary {
  vatNumber: string;
  businessName: string;
  mainId: string;
  path: string;
  from: string;
  to: string;
  generatedDate: string;
  generatedTime: string;
  software: { name: string; version: string; registrationNumber: string };
  records: { code: string; nameHe: string; count: number }[];
  totalRecords: number;
  documentTypes: { code: number; nameHe: string; count: number; totalIlsMinor: number }[];
}

interface RunResponse {
  filename: string;
  zipBase64: string;
  summary: Summary;
  report: { warnings: string[] };
}

const DRIVES = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const shekels = (minor: number) =>
  `₪${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function saveZip(res: RunResponse): void {
  const bin = atob(res.zipBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = res.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Prints one element on its own, right to left, without the app around it. */
function printElement(el: HTMLElement | null): void {
  if (!el) return;
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>מבנה אחיד</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:24px}h2{font-size:17px;text-decoration:underline;margin:0 0 14px}
table{border-collapse:collapse;margin:10px 0;min-width:360px}th,td{border:1px solid #999;padding:4px 10px;text-align:right}th{background:#eee}
dl{display:grid;grid-template-columns:max-content auto;gap:4px 16px;margin:0 0 12px}dt{font-weight:bold}dd{margin:0}.ltr{direction:ltr;unicode-bidi:isolate}</style>
</head><body>${el.innerHTML}</body></html>`);
  doc.close();
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 2000);
}

export function UnifiedFilePage() {
  const t = useT();
  const [drive, setDrive] = useState('C');
  const [from, setFrom] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [biz, setBiz] = useState<{ vatNumber: string; name: string; warnings: string[] } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/exports/unified-file/business', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBiz(b as { vatNumber: string; name: string; warnings: string[] }))
      .catch(() => undefined);
  }, []);
  const typesRef = useRef<HTMLDivElement>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to, drive });
      const res = await fetch(`/api/exports/unified-file/run?${qs}`, { method: 'POST', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
        throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? t('unified.error'));
      }
      const body = (await res.json()) as RunResponse;
      setResult(body);
      saveZip(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('unified.error'));
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;
  const typesTotal = s ? s.documentTypes.reduce((a, x) => ({ count: a.count + x.count, total: a.total + x.totalIlsMinor }), { count: 0, total: 0 }) : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageTitle subtitle={t('unified.subtitle')}>{t('unified.title')}</PageTitle>

      <Card title={t('unified.dialogTitle')}>
        {biz && (
          <p className="mb-4 text-sm text-ink">
            {t('unified.business')}: <span className="font-semibold">{biz.name || '-'}</span> · <span dir="ltr">{biz.vatNumber}</span>
          </p>
        )}
        {biz && biz.warnings.length > 0 && <ErrorNote error={biz.warnings.join(' ')} />}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={label}>{t('unified.drive')}</span>
            <select className={input} value={drive} onChange={(e) => setDrive(e.target.value)}>
              {DRIVES.map((d) => (
                <option key={d} value={d}>
                  {d}:
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('unified.from')}</span>
            <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{t('unified.to')}</span>
            <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-sm text-muted">{t('unified.help')}</p>
        <ErrorNote error={error} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={busy || !from || !to || from > to} onClick={() => void create()}>
            {busy ? t('unified.working') : t('unified.create')}
          </button>
          {result && (
            <button type="button" className={btnSecondary} onClick={() => saveZip(result)}>
              {t('unified.downloadAgain')}
            </button>
          )}
        </div>
        {result && result.report.warnings.length > 0 && (
          <ul className="mt-4 list-disc space-y-1 ps-5 text-sm text-danger">
            {result.report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Card>

      {s && typesTotal && (
        <>
          <Card title={t('unified.summaryTitle')} actions={<button type="button" className={btnSecondary} onClick={() => printElement(summaryRef.current)}>{t('unified.print')}</button>}>
            <div ref={summaryRef} dir="rtl" lang="he" className="text-sm text-ink">
              <h2 className="mb-3 font-semibold underline">הפקת קבצים במבנה אחיד</h2>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <dt className="font-semibold">מספר עוסק מורשה:</dt>
                <dd className="ltr">{s.vatNumber}</dd>
                <dt className="font-semibold">שם בית העסק:</dt>
                <dd>{s.businessName}</dd>
              </dl>
              <p className="my-3 font-semibold">** ביצוע ממשק פתוח הסתיים בהצלחה **</p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <dt className="font-semibold">הנתונים נשמרו בנתיב:</dt>
                <dd className="ltr" dir="ltr">{s.path}</dd>
                <dt className="font-semibold">טווח תאריכים:</dt>
                <dd>
                  מתאריך: <span className="ltr">{ddmmyyyy(s.from)}</span> ועד תאריך: <span className="ltr">{ddmmyyyy(s.to)}</span>
                </dd>
              </dl>
              <p className="mt-3 font-semibold">פירוט סך סוגי הרשומות בקובץ BKMVDATA.TXT:</p>
              <table className="mt-2 border-collapse text-start" data-no-stack>
                <thead>
                  <tr>
                    <th className="border border-line px-3 py-1 text-start">סוג רשומה</th>
                    <th className="border border-line px-3 py-1 text-start">תיאור</th>
                    <th className="border border-line px-3 py-1 text-start">כמות</th>
                  </tr>
                </thead>
                <tbody>
                  {s.records.map((r) => (
                    <tr key={r.code}>
                      <td className="border border-line px-3 py-1">{r.code}</td>
                      <td className="border border-line px-3 py-1">{r.nameHe}</td>
                      <td className="border border-line px-3 py-1 tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="border border-line px-3 py-1 font-semibold" colSpan={2}>
                      סה"כ
                    </td>
                    <td className="border border-line px-3 py-1 font-semibold tabular-nums">{s.totalRecords}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3">
                הנתונים הופקו באמצעות תוכנת: {s.software.name}, מספר תעודת הרישום: <span className="ltr">{s.software.registrationNumber || '-'}</span>
              </p>
              <p>
                בתאריך: <span className="ltr">{s.generatedDate}</span> בשעה: <span className="ltr">{s.generatedTime}</span>
              </p>
            </div>
          </Card>

          <Card title={t('unified.typesTitle')} actions={<button type="button" className={btnSecondary} onClick={() => printElement(typesRef.current)}>{t('unified.print')}</button>}>
            <div ref={typesRef} dir="rtl" lang="he" className="text-sm text-ink" data-no-stack>
              <h2 className="mb-3 font-semibold underline">פירוט סוגי המסמכים</h2>
              <p>
                מספר עוסק מורשה: <span className="ltr">{s.vatNumber}</span> · שם בית העסק: {s.businessName}
              </p>
              <p className="mb-2">
                טווח תאריכים: מתאריך <span className="ltr">{ddmmyyyy(s.from)}</span> ועד תאריך <span className="ltr">{ddmmyyyy(s.to)}</span>
              </p>
              <table className="border-collapse" data-no-stack>
                <thead>
                  <tr>
                    <th className="border border-line px-3 py-1 text-start">מספר מסמך</th>
                    <th className="border border-line px-3 py-1 text-start">סוג מסמך</th>
                    <th className="border border-line px-3 py-1 text-start">סה"כ כמותי</th>
                    <th className="border border-line px-3 py-1 text-start">סה"כ כספי (בש"ח)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.documentTypes.map((r) => (
                    <tr key={r.code}>
                      <td className="border border-line px-3 py-1">{r.code}</td>
                      <td className="border border-line px-3 py-1">{r.nameHe}</td>
                      <td className="border border-line px-3 py-1 tabular-nums">{r.count}</td>
                      <td className="border border-line px-3 py-1 tabular-nums" dir="ltr">
                        {shekels(r.totalIlsMinor)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="border border-line px-3 py-1 font-semibold" colSpan={2}>
                      סה"כ
                    </td>
                    <td className="border border-line px-3 py-1 font-semibold tabular-nums">{typesTotal.count}</td>
                    <td className="border border-line px-3 py-1 font-semibold tabular-nums" dir="ltr">
                      {shekels(typesTotal.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3">
                הנתונים הופקו באמצעות תוכנת: {s.software.name}, מספר תעודת הרישום: <span className="ltr">{s.software.registrationNumber || '-'}</span>
              </p>
              <p>
                בתאריך: <span className="ltr">{s.generatedDate}</span> בשעה: <span className="ltr">{s.generatedTime}</span>
              </p>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
