import { env } from 'cloudflare:workers';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { buildAccountantPack, monthRange, previousPeriod } from '../../../src/modules/reports';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

describe('monthRange / previousPeriod', () => {
  it('gives the first and last day of the month, leap years included', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('gives the previous calendar month, wrapping the year at January', () => {
    expect(previousPeriod('2026-11-05')).toBe('2026-10');
    expect(previousPeriod('2026-01-05')).toBe('2025-12');
  });
});

describe('buildAccountantPack: PDF summary, XLSX detail, ZIP of expense files (docs/accountant-access.md)', () => {
  it('builds and stores the three files, records the pack, and emails every accountant with monthly_pack on', async () => {
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 100000 });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    const { lastRowId: fileId } = await run(
      db(),
      `INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256) VALUES ('upload', ?, ?, 'application/pdf', 9, 'x')`,
      'expenses/pack-test.pdf',
      'receipt.pdf',
    );
    await env.FILES.put('expenses/pack-test.pdf', new TextEncoder().encode('%PDF-fake'));
    await run(
      db(),
      `INSERT INTO expenses (status, document_date, currency, amount_minor, amount_ils_minor, file_id) VALUES ('filed', '2026-10-15', 'ILS', 20000, 20000, ?)`,
      fileId,
    );

    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const { lastRowId: userId } = await run(db(), `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(db(), `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'monthly_pack', 1)`, userId);

    const mailer = new FakeMailer();
    const result = await buildAccountantPack(env, '2026-10', { mailer, meterDate: '2026-10-31' });

    expect(result.incomeTotalIlsMinor).toBe(100000);
    expect(result.expenseTotalIlsMinor).toBe(20000);
    expect(result.expenseFileCount).toBe(1);
    expect(result.emailedTo).toEqual([email]);
    expect(result.emailError).toBeNull();

    expect(await env.FILES.get(result.pdfKey)).not.toBeNull();
    expect(await env.FILES.get(result.xlsxKey)).not.toBeNull();
    expect(await env.FILES.get(result.zipKey)).not.toBeNull();

    const row = await db()
      .prepare('SELECT emailed_at FROM accountant_packs WHERE period = ?')
      .bind('2026-10')
      .first<{ emailed_at: string | null }>();
    expect(row?.emailed_at).not.toBeNull();

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(email);
    expect(mailer.sent[0]!.attachments).toHaveLength(3);
  });

  it('records the pack with nothing emailed when no accountant has the monthly_pack feature on', async () => {
    // The previous test's accountant persists in this file's shared D1 (final rows never
    // disappear); turn its switch off so this test starts from "nobody subscribed".
    await run(db(), `UPDATE user_features SET enabled = 0 WHERE feature = 'monthly_pack'`);
    const mailer = new FakeMailer();
    const result = await buildAccountantPack(env, '2027-05', { mailer, meterDate: '2027-05-31' });
    expect(result.emailedTo).toEqual([]);
    expect(result.expenseFileCount).toBe(0);
    expect(mailer.sent).toEqual([]);
  });

  it('overwrites the same period on a second run rather than accumulating rows', async () => {
    const mailer = new FakeMailer();
    await buildAccountantPack(env, '2027-06', { mailer, meterDate: '2027-06-30' });
    await buildAccountantPack(env, '2027-06', { mailer, meterDate: '2027-06-30' });
    const rows = await db().prepare('SELECT id FROM accountant_packs WHERE period = ?').bind('2027-06').all();
    expect(rows.results).toHaveLength(1);
  });

  /** R16 task 11: the per-client ledger (תוספת ה׳) rides along in the pack's XLSX detail export. */
  it('includes a Client ledgers sheet in the XLSX detail export', async () => {
    const { lastRowId: clientId } = await run(db(), 'INSERT INTO clients (name_en) VALUES (?)', 'Pack Client Co');
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 30000 });
    await run(db(), 'UPDATE documents SET client_id = ?, date = ? WHERE id = ?', clientId, '2027-07-10', receipt);
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    const mailer = new FakeMailer();
    const result = await buildAccountantPack(env, '2027-07', { mailer, meterDate: '2027-07-31' });

    const xlsxObject = await env.FILES.get(result.xlsxKey);
    const xlsxBytes = new Uint8Array(await xlsxObject!.arrayBuffer());
    const files = unzipSync(xlsxBytes);
    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('Client ledgers');
  });
});
