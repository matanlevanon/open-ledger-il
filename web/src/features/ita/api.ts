import { ApiError, type ApiErrorBody, apiGet } from '../../api/client';

export type RefusalChoice = 'cancel' | 'continue' | 'reverse_charge' | 'further_objection';

export interface Connection {
  environment: 'sandbox' | 'production';
  connected: boolean;
  status: 'not_connected' | 'active' | 'reconnect_required';
  status_reason: string | null;
  login_at: string | null;
  days_until_relogin: number | null;
  days_since_login: number | null;
  last_refresh_at: string | null;
  banner: boolean;
}

export interface QueueDocument {
  id: number;
  type: string;
  number: number | null;
  status: string;
  date: string;
  customer_name: string | null;
  customer_vat_number?: string | null;
  payment_amount_minor: number;
  vat_amount_minor: number;
  total_minor?: number;
}

export interface AllocationItem {
  document_id: number;
  status: 'pending' | 'stalled' | 'failed' | 'refused' | 'decided';
  attempts: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  decision: RefusalChoice | null;
  document: QueueDocument | null;
}

export interface WithoutNumber {
  id: number;
  type: string;
  number: number | null;
  status: string;
  date: string;
  subtotal_minor: number;
  client_name: string | null;
  decision: string | null;
}

export interface Overview {
  connection: Connection;
  queue: AllocationItem[];
  refused: AllocationItem[];
  without_numbers: WithoutNumber[];
  links: { web_app: string; hearing: string };
  /** 'manual': no ITA API app is set up, numbers come from the ITA web app. */
  mode?: 'api' | 'manual';
  business_vat_number?: string | null;
}

export interface ActionResult {
  status: string;
  message: string;
  short_number: string | null;
  hearing_url: string | null;
}

export interface RouteProbe {
  from: string | null;
  status: number;
  reached: boolean;
  reply: string;
}

export interface RouteCheck {
  environment: string;
  direct: RouteProbe;
  relay: RouteProbe | null;
}

export interface ItaApi {
  overview(): Promise<Overview>;
  request(documentId: number): Promise<ActionResult>;
  decide(documentId: number, choice: RefusalChoice): Promise<ActionResult>;
  manual(documentId: number, confirmationNumber: string, note: string): Promise<ActionResult>;
  /** Checks whether the ITA token address answers, directly and through the relay. */
  routeCheck?(): Promise<RouteCheck>;
  /** Renews the ITA login now. */
  refresh?(): Promise<{ ok: boolean; reason?: string; from?: string | null }>;
}

async function post(path: string, body?: unknown): Promise<ActionResult> {
  const res = await fetch(`/api/ita${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as ({ result: ActionResult } & Partial<ApiErrorBody>) | null;
  if (!res.ok || !json?.result) {
    throw new ApiError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? 'Request failed.');
  }
  return json.result;
}

export const httpItaApi: ItaApi = {
  overview: () => apiGet<Overview>('/ita/overview'),
  request: (id) => post(`/allocations/${id}/request`),
  decide: (id, choice) => post(`/allocations/${id}/decision`, { choice }),
  manual: (id, confirmationNumber, note) => post(`/allocations/${id}/manual`, { confirmation_number: confirmationNumber, source_note: note }),
  routeCheck: () => apiGet<RouteCheck>('/ita/route-check'),
  refresh: async () => {
    const res = await fetch('/api/ita/refresh', { method: 'POST', headers: { Accept: 'application/json' } });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; from?: string | null } | null;
    return { ok: Boolean(res.ok && json?.ok), reason: json?.reason ?? (res.ok ? undefined : `HTTP ${res.status}`), from: json?.from ?? null };
  },
};

/** Where the browser goes to sign in to the ITA. */
export const CONNECT_URL = '/api/ita/connect';
