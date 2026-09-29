import { ApiError, apiGet } from '../../api/client';

export interface ActivityItem {
  kind: 'document' | 'expense';
  id: number;
  at: string;
  type: string | null;
  number: number | null;
  status: string;
  name: string | null;
  nameHe: string | null;
  currency: string;
  amountMinor: number;
}

export const activityApi = {
  recent: (limit = 15) => apiGet<{ items: ActivityItem[] }>(`/dashboard/activity?limit=${limit}`),
};

/**
 * Sends one receipt to the expense reader. Answers the new expense id, or null when the same
 * file was uploaded before (the server keeps one copy per file hash).
 */
export async function uploadReceipt(file: File): Promise<number | null> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/expenses/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Upload failed.');
  }
  const body = (await res.json()) as { expense: { id: number } | null };
  return body.expense?.id ?? null;
}
