/**
 * API client for the shell.
 *
 * Mock mode: `npm run dev:web:mock` (VITE_MOCK=1) resolves every `apiGet` call from
 * `web/src/api/fixtures` instead of hitting the Worker, so a screen can be built and
 * tested before its API route ships.
 */

export type Role = 'owner' | 'accountant';

export interface Me {
  email: string;
  name: string | null;
  role: Role;
  features: string[];
  /** R16 tasks 15/16: null until the person picks one. */
  theme: 'light' | 'dark' | null;
  locale: 'en' | 'he' | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const MOCK_MODE = import.meta.env.VITE_MOCK === '1';

async function mockGet<T>(path: string): Promise<T> {
  const { fixtures } = await import('./fixtures');
  const key = path.split('?')[0]!;
  const fixture = fixtures[key];
  if (!fixture) throw new ApiError(404, 'not_found', `No mock fixture registered for ${key}.`);
  return structuredClone(fixture()) as T;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  if (MOCK_MODE) return mockGet<T>(path);
  const res = await fetch(`/api${path}`, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.', body?.error.details);
  }
  return (await res.json()) as T;
}

export async function fetchMe(): Promise<Me> {
  const body = await apiGet<{ user: Me }>('/me');
  return body.user;
}
