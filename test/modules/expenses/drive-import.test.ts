import { beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/core/audit';
import { createExpensesModule } from '../../../src/modules/expenses';
import { FOLDER_MIME, type DriveFile } from '../../../src/modules/expenses/drive';
import {
  DRIVE_DAILY_CRON,
  dailyMonths,
  driveFileIdFromUrl,
  importMonth,
  normalizeSupplierName,
  parseIndexSheet,
  runDailyDriveImport,
  getIndexTitlePattern,
  setDailySync,
  setIndexTitlePattern,
  sheetDate,
} from '../../../src/modules/expenses/drive-import';
import { FakeDriveSource, FakeExtractor } from '../../../src/modules/expenses/fakes';
import { setDriveRootFolder } from '../../../src/modules/expenses/service';
import type { Deps } from '../../../src/modules/expenses/service';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, json, uploadForm } from './helpers';

// Storage is isolated per test FILE, not per test, so every test below uses its own month.

/** An invented Drive folder id. There is no default: the owner saves one in Settings > Expenses. */
const ROOT = 'test-root-folder';

const HEADER = [
  'סטטוס', 'תאריך', 'ספק', 'ח.פ ספק', 'סוג מסמך', 'לפני מע"מ', 'מע"מ', 'סה"כ', 'מטבע', 'שער המרה',
  'תאריך השער', 'סה"כ בשקלים', 'קטגוריה', 'קבוע', 'מספר מסמך', 'קישור לקובץ', 'הערות',
];

interface RowInput {
  status: string;
  date?: string;
  supplier?: string;
  taxId?: string;
  type?: string;
  vat?: string;
  total?: string;
  currency?: string;
  rate?: string;
  rateDate?: string;
  category?: string;
  fixed?: string;
  number?: string;
  link?: string;
  notes?: string;
}

function row(r: RowInput): string[] {
  return [
    r.status, r.date ?? '', r.supplier ?? '', r.taxId ?? '', r.type ?? '', r.total ?? '', r.vat ?? '0', r.total ?? '',
    r.currency ?? '', r.rate ?? '', r.rateDate ?? '', '', r.category ?? '', r.fixed ?? '', r.number ?? '', r.link ?? '', r.notes ?? '',
  ];
}

const driveLink = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const gmailLink = 'https://mail.google.com/mail/u/0/#inbox/18f0000000000001';

function pdf(id: string, name: string): DriveFile {
  return { id, name, mimeType: 'application/pdf', modifiedTime: '2026-09-01T00:00:00Z' };
}

function deps(drive: FakeDriveSource, extractor = new FakeExtractor()): Deps {
  const fx = new FxRates(
    env.DB,
    new FakeFxHistory({ USD: { '2026-07-02': '3.75', '2026-07-03': '3.70', '2026-06-10': '3.60', '2026-05-04': '3.50' } }),
  );
  return { drive, extractor, fx };
}

/** The July sheet: every status, plus the totals, blank, rate-source and section-title rows the skill writes. */
const JULY_ROWS = [
  ['Expense index 2026-07'],
  HEADER,
  row({
    status: 'הוצאה', date: '2026-07-02', supplier: 'Tunewave', type: 'חשבונית', total: '10', currency: 'USD', rate: '3.0012',
    rateDate: '2026-07-02', category: 'תוכנה ומנויים', fixed: 'קבוע', number: 'TW-0001', link: driveLink('jul-tunewave'), notes: 'Tunewave Pro',
  }),
  row({
    status: 'הוצאה', date: '03/07/2026', supplier: 'Nimbus, Inc.', taxId: 'US EIN 12-3456789', type: 'חשבונית', total: '1,186.00',
    vat: '0', currency: 'ILS', category: 'Software', fixed: 'לא קבוע', number: 'EC-100001', link: driveLink('jul-cf'),
  }),
  row({ status: 'לא הושג', date: '2026-07-04', supplier: 'Some SaaS', total: '5', currency: 'USD', link: gmailLink }),
  row({ status: 'נפסל לא עסקי', date: '2026-07-05', supplier: 'Streamflix', total: '50', currency: 'ILS', link: gmailLink }),
  row({ status: 'נדחה הכנסה', date: '2026-07-06', supplier: 'Sample Business Ltd', total: '1000', currency: 'ILS', link: driveLink('jul-own') }),
  row({ status: 'לא הוצאה', date: '2026-07-07', supplier: 'Law firm', total: '0', currency: 'ILS', link: driveLink('jul-letter') }),
  row({ status: 'מסמך אישי', date: '2026-07-08', supplier: 'Card Co', total: '900', currency: 'ILS', link: driveLink('jul-card') }),
  ['סה"כ', '', '', '', '', '1196', '0', '1196', 'USD', '', '', '1223.50', '', '', '', '', '2 מסמכים'],
  [],
  ['מקור השערים', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ECB דרך api.frankfurter.dev'],
  ['מסמכים שנדחו'],
];

function julyDrive(): FakeDriveSource {
  return new FakeDriveSource(
    {
      'folder-2026-07': [
        { file: pdf('jul-tunewave', '2026-07-02_18f1_Tunewave-invoice.pdf'), bytes: bytesFrom('tunewave july pdf') },
        { file: pdf('jul-cf', '2026-07-03_18f2_nimbus.pdf'), bytes: bytesFrom('nimbus july pdf') },
        { file: pdf('jul-own', '2026-07-06_18f3_Sample-Business-Ltd-receipt.pdf'), bytes: bytesFrom('own receipt') },
      ],
    },
    { [`${ROOT}/2026-07`]: 'folder-2026-07' },
    { [`${ROOT}/2026-07`]: { id: 'sheet-2026-07', rows: JULY_ROWS } },
  );
}

async function expense(id: number): Promise<ExpenseRow> {
  return (await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<ExpenseRow>())!;
}

describe('R20: index sheet parsing', () => {
  it('keeps only rows with one of the six statuses, skipping totals, blanks, rate source and titles', () => {
    const rows = parseIndexSheet(JULY_ROWS);
    expect(rows.map((r) => r.status)).toEqual(['הוצאה', 'הוצאה', 'לא הושג', 'נפסל לא עסקי', 'נדחה הכנסה', 'לא הוצאה', 'מסמך אישי']);
    expect(rows[0]!.rowNumber).toBe(3);
    expect(rows[0]!.cells.documentNumber).toBe('TW-0001');
  });

  it('reads the English header set and English statuses', () => {
    const english = ['Status', 'Date', 'Supplier', 'Supplier tax ID', 'Document type', 'Before VAT', 'VAT', 'Total', 'Currency', 'Exchange rate', 'Rate date', 'Total ILS', 'Category', 'Fixed', 'Document number', 'File link', 'Notes'];
    const rows = parseIndexSheet([
      ['Expense index 2026-07'],
      english,
      row({ status: 'Expense', date: '2026-07-02', supplier: 'Acme Ltd', total: '10', currency: 'USD', number: 'A-1' }),
      row({ status: 'Personal document', date: '2026-07-03', supplier: 'Bank', total: '1', currency: 'ILS' }),
      row({ status: 'Total', total: '11' }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(['הוצאה', 'מסמך אישי']);
    expect(rows[0]!.cells).toMatchObject({ supplier: 'Acme Ltd', documentNumber: 'A-1', currency: 'USD' });
  });

  it('matches headers written with gershayim', () => {
    const rows = parseIndexSheet([HEADER.map((h) => h.replace('"', '״')), row({ status: 'הוצאה', supplier: 'X', total: '1', vat: '0.17' })]);
    expect(rows[0]!.cells.vat).toBe('0.17');
  });

  it('reads ISO and Israeli day-first dates, and Drive file links only', () => {
    expect(sheetDate('2026-07-02')).toBe('2026-07-02');
    expect(sheetDate('3/7/2026')).toBe('2026-07-03');
    expect(sheetDate('03.07.2026')).toBe('2026-07-03');
    expect(sheetDate('July 3')).toBeNull();
    expect(driveFileIdFromUrl(driveLink('15ly_KLX-aF'))).toBe('15ly_KLX-aF');
    expect(driveFileIdFromUrl(gmailLink)).toBeNull();
  });

  it('treats a legal suffix and punctuation as the same supplier', () => {
    expect(normalizeSupplierName('Modelco, PBC')).toBe(normalizeSupplierName('modelco'));
    expect(normalizeSupplierName('Nimbus, Inc.')).toBe('nimbus');
  });
});

describe('R22: no Drive folder until the owner saves one', () => {
  it('fails the run with a clear message instead of reading a default folder', async () => {
    const summary = await importMonth(env, deps(new FakeDriveSource()), '2026-01', 'manual', SYSTEM_ACTOR);
    expect(summary).toMatchObject({ source: 'failed', errors: 1 });
    expect(summary.errorList[0]!.message).toContain('Settings > Expenses');
  });

  it('reads the index sheet title pattern from a setting, default Expense index YYYY-MM', async () => {
    expect(await getIndexTitlePattern(env.DB)).toBe('Expense index YYYY-MM');
    await setIndexTitlePattern(env.DB, 'Receipts YYYY-MM', SYSTEM_ACTOR);
    expect(await getIndexTitlePattern(env.DB)).toBe('Receipts YYYY-MM');
    await setIndexTitlePattern(env.DB, 'Expense index YYYY-MM', SYSTEM_ACTOR);
  });
});

describe('R20: import from the index sheet', () => {
  beforeAll(async () => {
    await setDriveRootFolder(env.DB, ROOT, SYSTEM_ACTOR);
  });

  it('creates expenses only from הוצאה rows, with the sheet fields, the PDF, and the ledger BOI rate', async () => {
    const summary = await importMonth(env, deps(julyDrive()), '2026-07', 'manual', SYSTEM_ACTOR);

    expect(summary.source).toBe('sheet');
    expect(summary.filesSeen).toBe(7);
    expect(summary.created).toBe(2);
    expect(summary.skippedNotExpense).toBe(5);
    expect(summary.errors).toBe(0);
    expect(summary.statusCounts).toEqual({ הוצאה: 2, 'לא הושג': 1, 'נפסל לא עסקי': 1, 'נדחה הכנסה': 1, 'לא הוצאה': 1, 'מסמך אישי': 1 });

    const tunewave = await expense(summary.createdIds[0]!);
    expect(tunewave).toMatchObject({
      status: 'filed',
      document_number: 'TW-0001',
      document_date: '2026-07-02',
      document_type: 'חשבונית',
      currency: 'USD',
      amount_minor: 1000,
      vat_amount_minor: 0,
      amount_ils_minor: 3750, // the ledger's BOI rate 3.75, not the sheet's ECB 3.0012
      fx_rate: '3.750000',
      is_fixed: 1,
    });
    expect(tunewave.notes).toBe('Tunewave Pro\nSheet rate: 3.0012 (ECB, 2026-07-02)');
    const file = await env.DB.prepare('SELECT * FROM expense_files WHERE id = ?').bind(tunewave.file_id).first<{ drive_file_id: string; filename: string }>();
    expect(file).toMatchObject({ drive_file_id: 'jul-tunewave', filename: '2026-07-02_18f1_Tunewave-invoice.pdf' });
    const category = await env.DB.prepare('SELECT name_en FROM expense_categories WHERE id = ?').bind(tunewave.category_id).first<{ name_en: string }>();
    expect(category?.name_en).toBe('תוכנה ומנויים');

    const cf = await expense(summary.createdIds[1]!);
    expect(cf).toMatchObject({ document_date: '2026-07-03', amount_minor: 118600, amount_ils_minor: 118600, is_fixed: 0, notes: null });
    const software = await env.DB.prepare("SELECT id FROM expense_categories WHERE key = 'software'").first<{ id: number }>();
    expect(cf.category_id).toBe(software!.id);
    const supplier = await env.DB.prepare('SELECT tax_id FROM suppliers WHERE id = ?').bind(cf.supplier_id).first<{ tax_id: string }>();
    expect(supplier?.tax_id).toBe('US EIN 12-3456789');

    const logged = await env.DB.prepare('SELECT * FROM drive_import_runs WHERE id = ?').bind(summary.runId).first<{ created: number; source: string }>();
    expect(logged).toMatchObject({ created: 2, source: 'sheet' });
  });

  it('is idempotent: a rerun of the same month creates nothing and links each skip to its expense', async () => {
    const first = (await env.DB.prepare("SELECT id FROM expenses WHERE document_number IN ('TW-0001', 'EC-100001') ORDER BY id").all<{ id: number }>()).results;
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first<{ n: number }>();

    const again = await importMonth(env, deps(julyDrive()), '2026-07', 'manual', SYSTEM_ACTOR);

    expect(again.created).toBe(0);
    expect(again.skippedDuplicate).toBe(2);
    expect(again.skips).toEqual([
      { ref: 'Row 3: Tunewave TW-0001', reason: 'drive_file', expenseId: first[0]!.id },
      { ref: 'Row 4: Nimbus, Inc. EC-100001', reason: 'drive_file', expenseId: first[1]!.id },
    ]);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM expenses').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it('skips expenses already uploaded by hand: same supplier and number, same file, or same supplier, date and ILS total', async () => {
    const extractor = new FakeExtractor({
      'gpuhost.pdf': { supplierName: 'Gpuhost', documentNumber: 'GH-0928', date: '2026-06-12', currency: 'USD', amount: '10', vatAmount: null },
      'modelco.pdf': { supplierName: 'Modelco', documentNumber: null, date: '2026-06-10', currency: 'USD', amount: '45', vatAmount: null },
      'chatly.pdf': { supplierName: 'Chatly', documentNumber: 'CH-1', date: '2026-06-20', currency: 'ILS', amount: '27.32', vatAmount: null },
    } satisfies Record<string, ExtractedExpense>);
    const app = buildApp({ extractor, fx: deps(new FakeDriveSource()).fx });
    const upload = async (name: string, content: string) => {
      const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom(content), name, 'application/pdf') });
      return ((await res.json()) as { expense: ExpenseRow }).expense;
    };
    const gpuhost = await upload('gpuhost.pdf', 'gpuhost receipt, scanned');
    const modelco = await upload('modelco.pdf', 'modelco invoice, scanned');
    const chatly = await upload('chatly.pdf', 'chatly receipt bytes');

    const drive = new FakeDriveSource(
      {
        'folder-2026-06': [
          { file: pdf('jun-gpuhost', '2026-06-12_18a_gpuhost.pdf'), bytes: bytesFrom('gpuhost receipt, from gmail') },
          { file: pdf('jun-modelco', '2026-06-10_18b_modelco.pdf'), bytes: bytesFrom('modelco invoice, from gmail') },
          { file: pdf('jun-chatly', '2026-06-21_18c_chatly.pdf'), bytes: bytesFrom('chatly receipt bytes') },
        ],
      },
      { [`${ROOT}/2026-06`]: 'folder-2026-06' },
      {
        [`${ROOT}/2026-06`]: {
          id: 'sheet-2026-06',
          rows: [
            HEADER,
            row({ status: 'הוצאה', date: '2026-07-12', supplier: 'Gpuhost', total: '10', currency: 'USD', number: 'GH-0928', link: driveLink('jun-gpuhost') }),
            row({ status: 'הוצאה', date: '2026-06-10', supplier: 'Modelco, PBC', total: '45', currency: 'USD', number: 'MC-0003', link: driveLink('jun-modelco') }),
            row({ status: 'הוצאה', date: '2026-06-21', supplier: 'Chatly Limited', total: '27.32', currency: 'ILS', number: 'CH-9', link: driveLink('jun-chatly') }),
          ],
        },
      },
    );
    const summary = await importMonth(env, deps(drive), '2026-06', 'manual', SYSTEM_ACTOR);

    expect(summary.created).toBe(0);
    expect(summary.skips).toEqual([
      { ref: 'Row 2: Gpuhost GH-0928', reason: 'supplier_number', expenseId: gpuhost.id },
      { ref: 'Row 3: Modelco, PBC MC-0003', reason: 'supplier_date_total', expenseId: modelco.id },
      { ref: 'Row 4: Chatly Limited CH-9', reason: 'file_hash', expenseId: chatly.id },
    ]);
    // Never changes an existing expense.
    expect(await expense(gpuhost.id)).toEqual(gpuhost);
  });

  it('records a row it cannot read as an error and carries on', async () => {
    const drive = new FakeDriveSource({}, {}, {
      [`${ROOT}/2026-04`]: {
        id: 'sheet-2026-04',
        rows: [
          HEADER,
          row({ status: 'הוצאה', date: 'someday', supplier: 'Broken', total: '1', currency: 'ILS', link: gmailLink }),
          row({ status: 'הוצאה', date: '2026-04-02', supplier: 'Whole Foods', total: '12.50', currency: 'ILS', number: 'WF-1', link: gmailLink }),
        ],
      },
    });
    const summary = await importMonth(env, deps(drive), '2026-04', 'manual', SYSTEM_ACTOR);
    expect(summary.created).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.errorList[0]).toEqual({ ref: 'Row 2: Broken', message: 'Unreadable date "someday".' });
    expect((await expense(summary.createdIds[0]!)).file_id).toBeNull();
  });
});

describe('R20: fallback to the month folder when there is no index sheet', () => {
  it('extracts every file as a new expense, skips files this business issued, and never reads _to_be_deleted', async () => {
    const ownerEnv = { ...env, OWNER_TAX_ID: '000000018' };
    const extractor = new FakeExtractor({
      '2026-05-04_19a_aws.pdf': { supplierName: 'Amazon Web Services', documentNumber: 'AWS-MAY', date: '2026-05-04', currency: 'USD', amount: '20', vatAmount: null },
      '2026-05-05_19b_invoice.pdf': { supplierName: 'Example Supplier', supplierId: '12-345-678-2', documentNumber: 'PF-7', date: '2026-05-05', currency: 'ILS', amount: '5000', vatAmount: null },
    });
    const drive = new FakeDriveSource(
      {
        'folder-2026-05': [
          { file: pdf('may-aws', '2026-05-04_19a_aws.pdf'), bytes: bytesFrom('aws may') },
          { file: pdf('may-own', '2026-05-03_19c_Sample-Business-Ltd-receipt-0042.pdf'), bytes: bytesFrom('own receipt') },
          { file: pdf('may-example', '2026-05-05_19b_invoice.pdf'), bytes: bytesFrom('example pro forma') },
          { file: { id: 'may-trash', name: '_to_be_deleted', mimeType: FOLDER_MIME, modifiedTime: '' }, bytes: new ArrayBuffer(0) },
        ],
        'may-trash': [{ file: pdf('may-trashed', 'old.pdf'), bytes: bytesFrom('trashed') }],
      },
      { [`${ROOT}/2026-05`]: 'folder-2026-05' },
    );

    const summary = await importMonth(ownerEnv, deps(drive, extractor), '2026-05', 'manual', SYSTEM_ACTOR);

    expect(summary.source).toBe('folder');
    expect(summary.filesSeen).toBe(3);
    expect(summary.created).toBe(1);
    expect(summary.skippedIssuedBySelf).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.skips).toEqual([
      { ref: '2026-05-03_19c_Sample-Business-Ltd-receipt-0042.pdf', reason: 'issued_by_self', expenseId: null },
      { ref: '2026-05-05_19b_invoice.pdf', reason: 'issued_by_self', expenseId: null },
    ]);
    const aws = await expense(summary.createdIds[0]!);
    expect(aws).toMatchObject({ status: 'new', document_number: 'AWS-MAY', amount_ils_minor: 7000 });
    const trashed = await env.DB.prepare("SELECT id FROM expense_files WHERE drive_file_id = 'may-trashed'").first();
    expect(trashed).toBeNull();

    const again = await importMonth(ownerEnv, deps(drive, extractor), '2026-05', 'manual', SYSTEM_ACTOR);
    expect(again.created).toBe(0);
    expect(again.skips[0]).toEqual({ ref: '2026-05-04_19a_aws.pdf', reason: 'drive_file', expenseId: aws.id });
  });

  it('reports a month with neither sheet nor folder, and a Google failure as a failed run', async () => {
    const empty = await importMonth(env, deps(new FakeDriveSource()), '2026-03', 'manual', SYSTEM_ACTOR);
    expect(empty).toMatchObject({ source: 'none', filesSeen: 0, created: 0, errors: 0 });

    const broken = new FakeDriveSource();
    broken.findIndexSheet = async () => {
      throw new Error('Google API error: 403');
    };
    const failed = await importMonth(env, deps(broken), '2026-03', 'manual', SYSTEM_ACTOR);
    expect(failed).toMatchObject({ source: 'failed', errors: 1, errorList: [{ ref: '2026-03', message: 'Google API error: 403' }] });
  });
});

describe('R20: daily job', () => {
  it('picks this month, plus last month on days 1 to 5', () => {
    expect(dailyMonths('2026-09-10')).toEqual(['2026-09']);
    expect(dailyMonths('2026-09-05')).toEqual(['2026-08', '2026-09']);
    expect(dailyMonths('2027-01-01')).toEqual(['2026-12', '2027-01']);
  });

  it('does nothing when the switch is off, through the cron dispatcher too', async () => {
    const untouchable = new FakeDriveSource();
    untouchable.findIndexSheet = async () => {
      throw new Error('Drive must not be called while the switch is off');
    };
    const runsBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM drive_import_runs').first<{ n: number }>();

    expect(await runDailyDriveImport(env, deps(untouchable), '2026-09-02', SYSTEM_ACTOR)).toEqual([]);
    const module = createExpensesModule(() => deps(untouchable));
    expect(module.crons).toEqual([DRIVE_DAILY_CRON]);
    await module.scheduled!({ cron: DRIVE_DAILY_CRON, scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController, env, {} as ExecutionContext);

    const runsAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM drive_import_runs').first<{ n: number }>();
    expect(runsAfter!.n).toBe(runsBefore!.n);
  });

  it('imports the current and previous month when the switch is on', async () => {
    await setDailySync(env.DB, true, SYSTEM_ACTOR);
    const runs = await runDailyDriveImport(env, deps(new FakeDriveSource()), '2026-02-03', SYSTEM_ACTOR);
    expect(runs.map((r) => [r.yearMonth, r.trigger])).toEqual([
      ['2026-01', 'daily'],
      ['2026-02', 'daily'],
    ]);
    await setDailySync(env.DB, false, SYSTEM_ACTOR);
  });
});

describe('R20: routes', () => {
  it('shows the saved folder, title pattern, switch off, and the run log to the owner', async () => {
    const app = buildApp();
    const res = await call(app, '/settings/drive');
    const body = (await res.json()) as { folderId: string; folderIdSaved: boolean; indexTitlePattern: string; dailySync: boolean; runs: unknown[] };
    expect(body.folderId).toBe(ROOT);
    expect(body.folderIdSaved).toBe(true);
    expect(body.indexTitlePattern).toBe('Expense index YYYY-MM');
    expect(body.dailySync).toBe(false);
    expect(body.runs.length).toBeGreaterThan(0);
  });

  it('audits the daily sync switch', async () => {
    const app = buildApp();
    const put = await call(app, '/settings/drive-daily-sync', json({ enabled: true }, { method: 'PUT' }));
    expect(put.status).toBe(200);
    const audit = await env.DB.prepare("SELECT details FROM audit_log WHERE action = 'settings.update' AND entity_id = 'expenses.drive_daily_sync' ORDER BY id DESC").first<{ details: string }>();
    expect(JSON.parse(audit!.details)).toEqual({ enabled: true });
    await call(app, '/settings/drive-daily-sync', json({ enabled: false }, { method: 'PUT' }));
  });

  it('runs Import month for the owner only, and rejects a bad month', async () => {
    const app = buildApp();
    const ok = await call(app, '/import/month', json({ yearMonth: '2026-01' }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { summary: { yearMonth: string; trigger: string } }).summary).toMatchObject({ yearMonth: '2026-01', trigger: 'manual' });
    expect((await call(app, '/import/month', json({ yearMonth: '2026-13' }))).status).toBe(400);
    expect((await call(app, '/import/month', json({ yearMonth: '2026-01' }), ACCOUNTANT_ENV)).status).toBe(403);
    expect((await call(app, '/settings/drive', {}, ACCOUNTANT_ENV)).status).toBe(403);
  });
});
