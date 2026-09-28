import { PDFDocument, StandardFonts } from 'pdf-lib';
import { zipSync } from 'fflate';
import { all, run } from '../../core/db';
import type { Env } from '../../env';
import { ceilingMeter, meterPercent } from '../ceiling';
import { readFile } from '../expenses/files';
import { type Notifier, slackNotifier } from '../ita/notify';
import { type EmailAttachment, type Mailer, ResendMailer } from '../sending/mailer';
import { clientLedgersReport } from './client-ledgers';
import { expenseFilesForPeriod, expenseReport } from './expenses';
import { clientLedgersSheet, expenseSheet, incomeSheet, profitLossSheet } from './exporters';
import { decimalMinor } from './format';
import { incomeReport } from './income';
import { type ProfitLossReport, profitLossReport } from './profit-loss';
import { buildXlsx } from './xlsx';

/** 'YYYY-MM' to its first and last calendar day. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/** The calendar month before a YYYY-MM-DD date, as 'YYYY-MM'. The pack for month M runs on the 5th of M+1. */
export function previousPeriod(dateIso: string): string {
  const [y, m] = dateIso.slice(0, 7).split('-').map(Number) as [number, number];
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

async function buildSummaryPdf(period: string, pl: ProfitLossReport, meterPct: number | null, expenseFileCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 780;
  const draw = (text: string, size: number, f: typeof font) => {
    page.drawText(text, { x: 50, y, size, font: f });
    y -= size + 10;
  };
  // StandardFonts.Helvetica only encodes WinAnsi (Latin) glyphs, so this summary stays English
  // only; the filed PDFs it references (src/modules/pdf) carry the bilingual legal copy.
  draw('Open Ledger IL: monthly accountant pack', 18, bold);
  draw(`Period: ${period}`, 12, font);
  y -= 10;
  draw('Profit and loss (document date, cash from payments)', 13, bold);
  draw(`Income: ${decimalMinor(pl.incomeIlsMinor)} ILS`, 11, font);
  draw(`Expenses: ${decimalMinor(pl.expensesIlsMinor)} ILS`, 11, font);
  draw(`Net: ${decimalMinor(pl.netIlsMinor)} ILS`, 11, font);
  y -= 10;
  if (meterPct !== null) {
    draw('Annual turnover ceiling (exempt dealer)', 13, bold);
    draw(`${meterPct.toFixed(1)}% of the year's ceiling used (turnover plus open requests).`, 11, font);
    y -= 10;
  }
  draw(`Expense files attached (ZIP): ${expenseFileCount}`, 11, font);
  draw('See detail.xlsx for the full income and expense breakdown.', 11, font);
  return doc.save();
}

async function buildExpenseZip(env: Env, files: { r2Key: string; filename: string }[]): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  const seen = new Map<string, number>();
  for (const f of files) {
    const obj = await readFile(env, f.r2Key);
    if (!obj) continue; // the R2 object should always exist; skip rather than fail the whole pack
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const count = seen.get(f.filename) ?? 0;
    seen.set(f.filename, count + 1);
    let name = f.filename;
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot === -1 ? `${name}-${count}` : `${name.slice(0, dot)}-${count}${name.slice(dot)}`;
    }
    entries[name] = bytes;
  }
  return zipSync(entries, { level: 6 });
}

interface AccountantRecipient {
  email: string;
}

async function packRecipients(db: D1Database): Promise<AccountantRecipient[]> {
  return all<AccountantRecipient>(
    db,
    `SELECT u.email FROM users u
     JOIN user_features f ON f.user_id = u.id AND f.feature = 'monthly_pack' AND f.enabled = 1
     WHERE u.role = 'accountant' AND u.active = 1`,
  );
}

export interface AccountantPackResult {
  period: string;
  pdfKey: string;
  xlsxKey: string;
  zipKey: string;
  expenseFileCount: number;
  incomeTotalIlsMinor: number;
  expenseTotalIlsMinor: number;
  emailedTo: string[];
  emailError: string | null;
}

export interface AccountantPackDeps {
  mailer?: Mailer;
  notifier?: Notifier;
  /** Business date used to read the ceiling meter. Default: the last day of the period. */
  meterDate?: string;
}

/**
 * Builds the monthly pack (docs/accountant-access.md "Monthly pack": PDF summary, XLSX detail,
 * ZIP of expense files) for one calendar month, stores it in R2, records it, and emails every
 * accountant with the `monthly_pack` feature on. Safe to call again for the same period: R2 keys
 * and the `accountant_packs` row are both keyed by `period` and overwrite in place.
 */
export async function buildAccountantPack(env: Env, period: string, deps: AccountantPackDeps = {}): Promise<AccountantPackResult> {
  const { from, to } = monthRange(period);
  const [income, expenses, pl, files, clientLedgers] = await Promise.all([
    incomeReport(env.DB, from, to),
    expenseReport(env.DB, from, to),
    profitLossReport(env.DB, from, to),
    expenseFilesForPeriod(env.DB, from, to),
    clientLedgersReport(env.DB, from, to),
  ]);
  const meter = await ceilingMeter(env.DB, deps.meterDate ?? to);
  const meterPct = meter ? meterPercent(meter) : null;

  const [pdfBytes, zipBytes] = await Promise.all([buildSummaryPdf(period, pl, meterPct, files.length), buildExpenseZip(env, files)]);
  const xlsxBytes = buildXlsx([incomeSheet(income), expenseSheet(expenses), profitLossSheet(pl), clientLedgersSheet(clientLedgers)]);

  const pdfKey = `accountant-packs/${period}/summary.pdf`;
  const xlsxKey = `accountant-packs/${period}/detail.xlsx`;
  const zipKey = `accountant-packs/${period}/expense-files.zip`;
  await Promise.all([
    env.FILES.put(pdfKey, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } }),
    env.FILES.put(xlsxKey, xlsxBytes, { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }),
    env.FILES.put(zipKey, zipBytes, { httpMetadata: { contentType: 'application/zip' } }),
  ]);

  await run(
    env.DB,
    `INSERT INTO accountant_packs (period, pdf_key, xlsx_key, zip_key, expense_file_count, income_total_ils_minor, expense_total_ils_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (period) DO UPDATE SET
       pdf_key = excluded.pdf_key, xlsx_key = excluded.xlsx_key, zip_key = excluded.zip_key,
       expense_file_count = excluded.expense_file_count, income_total_ils_minor = excluded.income_total_ils_minor,
       expense_total_ils_minor = excluded.expense_total_ils_minor,
       generated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), emailed_at = NULL, email_error = NULL`,
    period,
    pdfKey,
    xlsxKey,
    zipKey,
    files.length,
    income.totalIlsMinor,
    expenses.totalIlsMinor,
  );

  const recipients = await packRecipients(env.DB);
  const emailedTo: string[] = [];
  let emailError: string | null = null;

  if (recipients.length > 0) {
    const mailer = deps.mailer ?? (env.MAIL_API_KEY && env.MAIL_FROM ? new ResendMailer(env.MAIL_API_KEY, env.MAIL_FROM) : null);
    if (!mailer) {
      emailError = 'MAIL_API_KEY or MAIL_FROM is not set. The pack was generated but not emailed.';
    } else {
      const attachments: EmailAttachment[] = [
        { filename: `open-ledger-il-summary-${period}.pdf`, content: pdfBytes, contentType: 'application/pdf' },
        { filename: `open-ledger-il-detail-${period}.xlsx`, content: xlsxBytes, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { filename: `open-ledger-il-expense-files-${period}.zip`, content: zipBytes, contentType: 'application/zip' },
      ];
      const html = `<p>The Open Ledger IL accountant pack for ${period} is attached: a PDF summary, an XLSX detail export, and a ZIP of the period's expense files.</p>`;
      const text = `The Open Ledger IL accountant pack for ${period} is attached: a PDF summary, an XLSX detail export, and a ZIP of the period's expense files.`;
      for (const r of recipients) {
        try {
          await mailer.send({ to: r.email, subject: `Open Ledger IL accountant pack, ${period}`, html, text, attachments });
          emailedTo.push(r.email);
        } catch (err) {
          emailError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  await run(
    env.DB,
    `UPDATE accountant_packs SET emailed_at = ?, email_error = ? WHERE period = ?`,
    emailedTo.length > 0 ? new Date().toISOString() : null,
    emailError,
    period,
  );

  if (emailError) {
    const notifier = deps.notifier ?? slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init));
    await notifier.send(`:warning: Open Ledger IL accountant pack for ${period} could not be emailed to everyone: ${emailError}`);
  }

  return {
    period,
    pdfKey,
    xlsxKey,
    zipKey,
    expenseFileCount: files.length,
    incomeTotalIlsMinor: income.totalIlsMinor,
    expenseTotalIlsMinor: expenses.totalIlsMinor,
    emailedTo,
    emailError,
  };
}
