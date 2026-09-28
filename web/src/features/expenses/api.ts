import { ApiError, apiGet } from '../../api/client';

export type ExpenseStatus = 'new' | 'filed' | 'not_expense' | 'duplicate' | 'returned';

export interface Expense {
  id: number;
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
}

export async function fetchDriveSettings(): Promise<DriveSettings> {
  return apiGet<DriveSettings>('/expenses/settings/drive');
}

export async function saveDriveRootFolder(folderId: string): Promise<void> {
  await send<{ folderId: string }>('/settings/drive-root-folder', 'PUT', { folderId });
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
