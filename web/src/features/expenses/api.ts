import { ApiError, apiGet } from '../../api/client';

export type ExpenseStatus = 'new' | 'filed' | 'not_expense' | 'duplicate' | 'returned';

export interface Expense {
  id: number;
  /** R29: on the public demo, the session key of the visitor who uploaded it. Null for the sample set. */
  demo_session_id?: string | null;
  supplier_name?: string | null;
  supplier_tax_id?: string | null;
  category_name?: string | null;
  file_id: number | null;
  supplier_id: number | null;
  category_id: number | null;
  status: ExpenseStatus;
  status_reason: string | null;
  duplicate_of_id: number | null;
  document_number: string | null;
  document_date: string | null;
  document_type: string | null;
  currency: string;
  amount_minor: number;
  vat_amount_minor: number;
  amount_ils_minor: number | null;
  fx_rate: string | null;
  fx_source: string | null;
  notes: string | null;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  tax_id: string | null;
  country: string;
  default_category_id: number | null;
  default_currency: string;
  notes: string | null;
}

export interface Category {
  id: number;
  key: string;
  name_en: string;
  sort_order: number;
  active: number;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/expenses${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, errBody?.error.code ?? 'http_error', errBody?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as T;
}

export interface ExpenseFilter {
  status?: ExpenseStatus;
  categoryId?: number;
  supplierId?: number;
}

export async function listExpenses(filter: ExpenseFilter = {}): Promise<Expense[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.categoryId) params.set('categoryId', String(filter.categoryId));
  if (filter.supplierId) params.set('supplierId', String(filter.supplierId));
  const query = params.toString();
  const body = await apiGet<{ expenses: Expense[] }>(`/expenses${query ? `?${query}` : ''}`);
  return body.expenses;
}

export async function getExpense(id: number): Promise<Expense> {
  return (await apiGet<{ expense: Expense }>(`/expenses/${id}`)).expense;
}

export async function nextExpense(excludeId?: number): Promise<Expense | null> {
  const query = excludeId ? `?excludeId=${excludeId}` : '';
  return (await apiGet<{ expense: Expense | null }>(`/expenses/next${query}`)).expense;
}

export interface ExpenseEdit {
  supplierId?: number | null;
  categoryId?: number | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  documentType?: string | null;
  currency?: string;
  amount?: string;
  vatAmount?: string | null;
  fxRateOverride?: string | null;
  notes?: string | null;
}

export async function updateExpense(id: number, edit: ExpenseEdit): Promise<Expense> {
  return (await send<{ expense: Expense }>(`/${id}`, 'PATCH', edit)).expense;
}

export async function updateExpenseReview(id: number, edit: { categoryId?: number | null; notes?: string | null }): Promise<Expense> {
  return (await send<{ expense: Expense }>(`/${id}/review`, 'PATCH', edit)).expense;
}

export async function setExpenseStatus(id: number, status: ExpenseStatus, reason?: string): Promise<Expense> {
  return (await send<{ expense: Expense }>(`/${id}/status`, 'POST', { status, reason })).expense;
}

export async function uploadExpense(file: File): Promise<Expense> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/expenses/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Upload failed.');
  }
  return ((await res.json()) as { expense: Expense }).expense;
}

export function fileDownloadUrl(fileId: number): string {
  return `/api/expenses/files/${fileId}/download`;
}

export async function listSuppliers(): Promise<Supplier[]> {
  return (await apiGet<{ suppliers: Supplier[] }>('/expenses/suppliers')).suppliers;
}

export async function createSupplier(input: { name: string; taxId?: string | null }): Promise<Supplier> {
  return (await send<{ supplier: Supplier }>('/suppliers', 'POST', input)).supplier;
}

export async function listCategories(all = false): Promise<Category[]> {
  return (await apiGet<{ categories: Category[] }>(`/expenses/categories${all ? '?all=1' : ''}`)).categories;
}

export async function createCategory(input: { key: string; nameEn: string }): Promise<Category> {
  return (await send<{ category: Category }>('/categories', 'POST', input)).category;
}

export async function setCategoryActive(id: number, active: boolean): Promise<Category> {
  return (await send<{ category: Category }>(`/categories/${id}`, 'PATCH', { active })).category;
}

// R20: Drive import. One summary shape for the Import month button and the run history.
export type ImportSkipReason = 'drive_file' | 'file_hash' | 'supplier_number' | 'supplier_date_total' | 'issued_by_self';

export interface ImportSummary {
  runId: number;
  yearMonth: string;
  trigger: 'manual' | 'daily';
  source: 'sheet' | 'folder' | 'none' | 'failed';
  startedAt: string;
  finishedAt: string;
  filesSeen: number;
  created: number;
  skippedDuplicate: number;
  skippedNotExpense: number;
  skippedIssuedBySelf: number;
  errors: number;
  statusCounts: Record<string, number>;
  createdIds: number[];
  skips: { ref: string; reason: ImportSkipReason; expenseId: number | null }[];
  errorList: { ref: string; message: string }[];
}

export interface DriveSettings {
  folderId: string | null;
  folderIdSaved: boolean;
  indexTitlePattern: string;
  dailySync: boolean;
  runs: ImportSummary[];
  /** R24: who reads documents. Absent on an older Worker. */
  reader?: { provider: 'anthropic' | 'gemini' | null; keySet: boolean };
}

export async function fetchDriveSettings(): Promise<DriveSettings> {
  return apiGet<DriveSettings>('/expenses/settings/drive');
}

export async function saveDriveRootFolder(folderId: string): Promise<void> {
  await send<{ folderId: string }>('/settings/drive-root-folder', 'PUT', { folderId });
}

/** The Check folder button. Mirrors DriveCheck in src/modules/expenses/drive-import.ts. */
export interface DriveCheck {
  ok: boolean;
  problem: 'no_folder' | 'no_key' | 'bad_key' | 'not_found' | 'not_folder' | 'google_error' | null;
  message: string | null;
  folderId: string | null;
  account: string | null;
  folderName: string | null;
  monthFolders: string[];
  sheets: string[];
  looseFiles: number;
}

export async function checkDriveFolder(folderId?: string): Promise<DriveCheck> {
  return (await send<{ check: DriveCheck }>('/settings/drive/check', 'POST', folderId ? { folderId } : {})).check;
}

/** Column headers the index sheet import reads (drive-import.ts COLUMNS, English set). */
export const INDEX_SHEET_HEADERS = [
  'Status', 'Date', 'Supplier', 'Supplier tax ID', 'Document type', 'Before VAT', 'VAT', 'Total', 'Currency',
  'Exchange rate', 'Rate date', 'Total ILS', 'Category', 'Fixed', 'Document number', 'File link', 'Notes',
];

const SAMPLE_ROWS = [
  ['Expense', '2026-10-02', 'Acme Hosting Ltd', '515555555', 'Tax invoice', '100.00', '18.00', '118.00', 'ILS', '', '', '118.00', 'Software', 'Fixed', 'INV-1001', 'https://drive.google.com/file/d/FILE_ID/view', 'Monthly hosting'],
  ['Expense', '2026-10-05', 'Example SaaS Inc.', '', 'Invoice', '20.00', '0', '20.00', 'USD', '3.75', '2026-10-05', '75.00', 'Software', 'Not fixed', 'ES-2210', 'https://drive.google.com/file/d/FILE_ID/view', ''],
  ['Personal document', '2026-10-07', 'My bank', '', 'Statement', '', '', '0', 'ILS', '', '', '', '', '', '', '', 'Skipped by the import'],
];

/** The sample index sheet as CSV, with a BOM so Excel and Google Sheets read Hebrew text right. */
export function sampleIndexSheetCsv(): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '\ufeff' + [INDEX_SHEET_HEADERS, ...SAMPLE_ROWS].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function saveIndexTitlePattern(pattern: string): Promise<void> {
  await send<{ indexTitlePattern: string }>('/settings/drive-index-title', 'PUT', { pattern });
}

export async function saveDailySync(enabled: boolean): Promise<void> {
  await send<{ dailySync: boolean }>('/settings/drive-daily-sync', 'PUT', { enabled });
}

export async function importMonth(yearMonth: string): Promise<ImportSummary> {
  return (await send<{ summary: ImportSummary }>('/import/month', 'POST', { yearMonth })).summary;
}

/** Last calendar month as YYYY-MM, the Import month default. */
export function lastMonth(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
