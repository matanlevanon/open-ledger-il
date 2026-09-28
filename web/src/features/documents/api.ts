import { ApiError, type ApiErrorBody, apiGet } from '../../api/client';

/** Fetchers for /api/clients and /api/documents. Field names follow the API (snake_case rows). */

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, err?.error.code ?? 'http_error', err?.error.message ?? 'Request failed.', err?.error.details);
  }
  return (await res.json()) as T;
}

export type Totals = Record<string, number>;

export interface Client {
  id: number;
  name_en: string;
  name_he: string | null;
  company_id: string | null;
  vat_number: string | null;
  country: string;
  foreign_resident: number;
  currency: string;
  client_copy_lang: 'en' | 'bilingual';
  email: string | null;
  phone: string | null;
  address_en: string | null;
  address_he: string | null;
  city: string | null;
  postal_code: string | null;
  notes: string | null;
  payment_instructions: string | null;
  payment_method_ids: string | null;
  archived_at: string | null;
  /** R18 task 6, replacing archived_at as the field the app reads. */
  active: number;
  balances?: Totals;
  overdue?: Totals;
}

export interface Contact {
  id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: number;
}

export interface ClientConsent {
  status: 'none' | 'requested' | 'granted' | 'revoked';
  at: string | null;
  method: string | null;
  source: string | null;
}

export interface ClientDetail {
  client: Client;
  contacts: Contact[];
  balances: Totals;
  consent: ClientConsent;
}

export interface ConsentFormInput {
  granted: boolean;
  source: 'signed_contract' | 'other';
  date: string;
  note?: string | null;
}

export interface LedgerEntry {
  kind: 'document' | 'payment' | 'imported';
  date: string;
  document_id: number;
  type: string;
  display_number: string | null;
  status: string;
  description: string;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number;
  method?: string;
  paid_on?: string;
  reference?: string | null;
}

export interface Ledger {
  client: { id: number; name_en: string; name_he: string | null };
  from: string | null;
  to: string | null;
  opening: Totals;
  closing: Totals;
  entries: LedgerEntry[];
}

export interface DocType {
  code: string;
  name_en: string;
  name_he: string;
  kind: string;
  enabled: number;
}

/** A document linked to a list row either way (R24): its source, or a document created from it. */
export interface RelatedDoc {
  id: number;
  type: string;
  number: number | null;
  name_en: string;
  name_he: string;
}

export interface DocListItem {
  id: number;
  related: RelatedDoc[];
  type: string;
  type_name_en: string;
  kind: string;
  number: number | null;
  display_number: string | null;
  status: string;
  state: string;
  date: string;
  due_date: string | null;
  client_id: number | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string;
  total_minor: number;
  total_ils_minor: number | null;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  remaining_minor: number | null;
  paid_minor: number | null;
  overdue: boolean;
  notes: string | null;
  payment_instructions: string | null;
  payment_method_ids: string | null;
  lang_variant: 'en' | 'bilingual';
  cancel_reason: string | null;
  hash: string | null;
}

/** R17 task 5: a service in the catalog, backed by the `items` table. */
export interface Service {
  id: number;
  name_en: string;
  name_he: string | null;
  description_en: string | null;
  description_he: string | null;
  unit_price_minor: number;
  currency: string;
  default_quantity_milli: number;
  unit: 'hour' | 'day' | 'month' | 'project' | 'item';
  vat_treatment: 'standard' | 'exempt' | 'zero_rated';
  active: number;
  sort_order: number;
}

/** R17 task 2. `details` fields depend on `type`: bank_transfer's eight fields, or a generic `identifier` for everything else. */
export interface PaymentMethod {
  id: number;
  display_name: string;
  type: 'bank_transfer' | 'bit' | 'paybox' | 'paypal' | 'card' | 'cash' | 'cheque' | 'other';
  currency: string | null;
  details: Record<string, string | null>;
  active: number;
  sort_order: number;
}

export interface DocLine {
  id: number;
  position: number;
  item_id: number | null;
  description_en: string;
  description_he: string | null;
  detail_en: string | null;
  detail_he: string | null;
  quantity_milli: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
}

export interface DocPayment {
  id: number;
  method: string;
  method_id: number | null;
  /** Resolved from method_id (R17 task 2), printed on the receipt (instruction 17). */
  method_detail: PaymentMethod | null;
  paid_on: string;
  reference: string | null;
  amount_minor: number;
  currency: string;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  amount_ils_minor: number | null;
  cheque_crossed: number;
}

export interface DocLink {
  id: number;
  kind: string;
  amount_minor: number | null;
  currency: string | null;
  other_id: number;
  other_type: string;
  other_status: string;
  other_display_number: string | null;
}

export interface DocEvent {
  id: number;
  kind: string;
  at: string;
  user_email: string | null;
  details: Record<string, unknown> | null;
}

export interface DocView {
  document: DocListItem;
  lines: DocLine[];
  payments: DocPayment[];
  /** The document's payment methods multi-select, resolved (R17 task 2). */
  paymentMethods: PaymentMethod[];
  meta: { source_id: number | null; source_kind: string | null; revises_id: number | null; show_ils: number; carry_rate: number } | null;
  source: { id: number; type: string; display_number: string | null; status: string } | null;
  links: { outgoing: DocLink[]; incoming: DocLink[] };
  events: DocEvent[];
}

export interface DocList {
  items: DocListItem[];
  summary: { overdue: Totals; due_soon: Totals; open: Totals };
}

export interface LineInput {
  description: string;
  descriptionHe?: string | null;
  detail?: string | null;
  detailHe?: string | null;
  itemId?: number | null;
  quantityMilli: number;
  unitPriceMinor: number;
  discountMinor?: number;
}

export interface PaymentInput {
  method: string;
  methodId?: number | null;
  paidOn: string;
  reference?: string | null;
  amountMinor: number;
  chequeCrossed?: boolean;
}

export interface DraftInput {
  type?: string;
  clientId?: number | null;
  date?: string;
  dueDate?: string | null;
  currency?: string;
  notes?: string | null;
  paymentInstructions?: string | null;
  paymentMethodIds?: number[];
  langVariant?: 'en' | 'bilingual';
  lines?: LineInput[];
  payments?: PaymentInput[];
  showIls?: boolean;
  overrideRate?: string | null;
  carryRate?: boolean;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export const clientsApi = {
  list: (params: { q?: string; active?: string } = {}) => apiGet<{ clients: Client[] }>(`/clients${qs(params)}`),
  get: (id: number) => apiGet<ClientDetail>(`/clients/${id}`),
  create: (body: Record<string, unknown>) => apiSend<ClientDetail>('POST', '/clients', body),
  update: (id: number, body: Record<string, unknown>) => apiSend<ClientDetail>('PATCH', `/clients/${id}`, body),
  activate: (id: number) => apiSend<ClientDetail>('POST', `/clients/${id}/activate`),
  deactivate: (id: number) => apiSend<ClientDetail>('POST', `/clients/${id}/deactivate`),
  addContact: (id: number, body: Record<string, unknown>) => apiSend<ClientDetail>('POST', `/clients/${id}/contacts`, body),
  removeContact: (id: number, contactId: number) => apiSend<ClientDetail>('DELETE', `/clients/${id}/contacts/${contactId}`),
  ledger: (id: number, from?: string, to?: string) => apiGet<Ledger>(`/clients/${id}/ledger${qs({ from, to })}`),
};

export const docsApi = {
  types: () => apiGet<{ types: DocType[] }>('/documents/types'),
  list: (params: { tab?: string; type?: string; clientId?: number } = {}) => apiGet<DocList>(`/documents${qs(params)}`),
  get: (id: number) => apiGet<DocView>(`/documents/${id}`),
  create: (body: DraftInput) => apiSend<DocView>('POST', '/documents', body),
  update: (id: number, body: DraftInput) => apiSend<DocView>('PATCH', `/documents/${id}`, body),
  remove: (id: number) => apiSend<{ ok: true }>('DELETE', `/documents/${id}`),
  finalize: (id: number, backdateReason?: string) => apiSend<DocView>('POST', `/documents/${id}/finalize`, { backdateReason }),
  convert: (id: number, type: string) => apiSend<DocView>('POST', `/documents/${id}/convert`, { type }),
  recordPayment: (id: number, body: { payments: PaymentInput[]; date?: string; backdateReason?: string }) =>
    apiSend<DocView>('POST', `/documents/${id}/record-payment`, body),
  revise: (id: number) => apiSend<DocView>('POST', `/documents/${id}/revise`),
  cancel: (id: number, reason: string) => apiSend<DocView>('POST', `/documents/${id}/cancel`, { reason }),
  credit: (id: number, body: { mode: 'full' | 'partial'; amountMinor?: number; reason?: string }) =>
    apiSend<DocView>('POST', `/documents/${id}/credit`, body),
  sent: (id: number, channel: string) => apiSend<DocView>('POST', `/documents/${id}/sent`, { channel }),
};

export type SendEmailResult = { status: 'sent'; messageId: string | null };
export type WhatsAppLinkResult = { status: 'ready'; url: string; waUrl: string | null; expiresAt: string };

export const sendingApi = {
  sendEmail: (id: number) => apiSend<SendEmailResult>('POST', `/sending/documents/${id}/send`, {}),
  whatsappLink: (id: number) => apiSend<WhatsAppLinkResult>('POST', `/sending/documents/${id}/whatsapp-link`, {}),
  requestConsent: (clientId: number) => apiSend<{ status: 'sent'; expiresAt: string }>('POST', `/sending/clients/${clientId}/consent/request`, {}),
};

/** R17 task 2: the payment methods catalog, shared by document editors and the Settings tab. */
export const paymentMethodsApi = {
  list: (activeOnly = false) => apiGet<{ paymentMethods: PaymentMethod[] }>(`/payment-methods${activeOnly ? '?active=1' : ''}`),
  create: (body: Record<string, unknown>) => apiSend<{ paymentMethods: PaymentMethod[] }>('POST', '/payment-methods', body),
  update: (id: number, body: Record<string, unknown>) => apiSend<{ paymentMethods: PaymentMethod[] }>('PATCH', `/payment-methods/${id}`, body),
  activate: (id: number) => apiSend<{ paymentMethods: PaymentMethod[] }>('POST', `/payment-methods/${id}/activate`),
  deactivate: (id: number) => apiSend<{ paymentMethods: PaymentMethod[] }>('POST', `/payment-methods/${id}/deactivate`),
  reorder: (ids: number[]) => apiSend<{ paymentMethods: PaymentMethod[] }>('PUT', '/payment-methods/reorder', { ids }),
};

/** R17 task 5: the services catalog, shared by document editors and the Settings/sidebar screen. */
export const servicesApi = {
  list: (activeOnly = false) => apiGet<{ services: Service[] }>(`/services${activeOnly ? '?active=1' : ''}`),
  create: (body: Record<string, unknown>) => apiSend<{ services: Service[] }>('POST', '/services', body),
  update: (id: number, body: Record<string, unknown>) => apiSend<{ services: Service[] }>('PATCH', `/services/${id}`, body),
  activate: (id: number) => apiSend<{ services: Service[] }>('POST', `/services/${id}/activate`),
  archive: (id: number) => apiSend<{ services: Service[] }>('POST', `/services/${id}/archive`),
  reorder: (ids: number[]) => apiSend<{ services: Service[] }>('PUT', '/services/reorder', { ids }),
};

export const pdfApi = {
  /** Opens a draft's rendered PDF preview in a new tab: DRAFT-stamped, no number, no signature (R16 task 3). */
  showDraft: (id: number, variant: 'client' | 'filed') => window.open(`/api/pdf/documents/${id}/draft.pdf?variant=${variant}`, '_blank', 'noopener'),
  /** First call renders, signs and stores the PDF; later calls reuse it (R16 task 4). Opens inline (R17 task 3). */
  view: (id: number, variant: 'client' | 'filed') => apiSend<{ url: string; expiresAt: string }>('POST', `/pdf/documents/${id}/view?variant=${variant}`),
  /** The "Download" button next to each view button (R17 task 3): saves as "<type>-<number>-<client>.pdf". */
  download: (id: number, variant: 'client' | 'filed') => apiSend<{ url: string; expiresAt: string }>('POST', `/pdf/documents/${id}/download?variant=${variant}`),
};
