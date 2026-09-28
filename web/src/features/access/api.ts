import { ApiError, apiGet, type ApiErrorBody } from '../../api/client';

export interface AccessFeatures {
  income_documents: boolean;
  expenses: boolean;
  clients: boolean;
  reports: boolean;
  monthly_pack: boolean;
  unified_file: boolean;
  pcn874: boolean;
  bank_matches: boolean;
  notes: boolean;
}

export interface AccessUser {
  id: number;
  email: string;
  name: string | null;
  role: 'owner' | 'accountant';
  active: boolean;
  accessEndsOn: string | null;
  features: AccessFeatures | null;
}

export interface AccessLogEntry {
  id: number;
  at: string;
  userEmail: string | null;
  role: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: unknown;
  ip: string | null;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errorBody?.error.code ?? 'http_error', errorBody?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as T;
}

export function fetchUsers(): Promise<{ users: AccessUser[] }> {
  return apiGet('/access/users');
}

export interface InviteAccountantInput {
  email: string;
  name?: string;
  accessEndsOn: string;
  features?: Partial<AccessFeatures>;
}

export function inviteAccountant(input: InviteAccountantInput): Promise<{ user: AccessUser }> {
  return send('/access/users', 'POST', input);
}

export interface UpdateAccountantInput {
  name?: string | null;
  accessEndsOn?: string;
  features?: Partial<AccessFeatures>;
}

export function updateAccountant(id: number, input: UpdateAccountantInput): Promise<{ user: AccessUser }> {
  return send(`/access/users/${id}`, 'PATCH', input);
}

export function revokeAccountant(id: number): Promise<void> {
  return send(`/access/users/${id}`, 'DELETE');
}

export function fetchAccessLog(params: { before?: number; userEmail?: string; action?: string } = {}): Promise<{
  entries: AccessLogEntry[];
  nextBefore: number | null;
}> {
  const query = new URLSearchParams();
  if (params.before !== undefined) query.set('before', String(params.before));
  if (params.userEmail) query.set('userEmail', params.userEmail);
  if (params.action) query.set('action', params.action);
  const qs = query.toString();
  return apiGet(`/access/log${qs ? `?${qs}` : ''}`);
}

export { ApiError };
