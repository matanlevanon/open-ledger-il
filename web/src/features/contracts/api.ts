import { apiGet } from '../../api/client';
import { apiSend } from '../documents/api';

/** R25: /api/contracts. */

export type TemplateKind = 'contract' | 'work_order';
export type ContractLanguage = 'en' | 'he' | 'both';
export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'void';
export type FieldKind = 'client' | 'business' | 'owner_input' | 'signer_input' | 'signature' | 'signed_date' | 'choice';

export interface ChoiceOption {
  value: string;
  labelEn: string;
  labelHe: string;
  freeText: boolean;
}

export interface FieldDef {
  key: string;
  labelEn: string;
  labelHe: string;
  kind: FieldKind;
  required: boolean;
  party?: 'owner' | 'client' | null;
  source?: string | null;
  inputType?: string | null;
  options: ChoiceOption[];
  multiple: boolean;
  allowOther: boolean;
  binding?: 'services' | null;
  defaultValue?: string | null;
  mapsTo?: 'amount' | 'currency' | 'start_date' | 'description' | null;
}

export interface Template {
  id: number;
  name: string;
  kind: TemplateKind;
  version: number;
  active: boolean;
  bodyEn: string;
  bodyHe: string;
  fields: FieldDef[];
  fieldCount: number;
  usedCount: number;
  updatedAt: string;
}

export interface TemplateInput {
  name: string;
  kind: TemplateKind;
  bodyEn: string;
  bodyHe: string;
  fields: FieldDef[];
  active: boolean;
}

export interface ServiceItem {
  id: number;
  labelEn: string;
  labelHe: string;
  active: boolean;
}

export interface Service {
  id: number;
  nameEn: string;
  nameHe: string;
  model: 'fixed_fee' | 'monthly_retainer' | 'milestones';
  modelLabelEn: string;
  modelLabelHe: string;
  descriptionEn: string;
  descriptionHe: string;
  sortOrder: number;
  active: boolean;
  items: ServiceItem[];
}

export interface ServiceInput {
  nameEn: string;
  nameHe: string;
  model: Service['model'];
  modelLabelEn?: string | null;
  modelLabelHe?: string | null;
  descriptionEn: string;
  descriptionHe: string;
  sortOrder: number;
  active: boolean;
  items: { id?: number | null; labelEn: string; labelHe: string; active: boolean }[];
}

export interface Money {
  amountMinor: number;
  currency: string;
}

/** The scope picker value the editor sends. The server copies names and labels in. */
export interface ScopeEntry {
  serviceId: number;
  itemIds: number[];
  other?: string | null;
  note?: string | null;
  fee?: Money | null;
}

export interface ChoiceValue {
  selected: { value: string; text?: string | null }[];
  other?: string | null;
}

export type FieldValue = string | Money | { services: unknown[] } | ChoiceValue | null;
export type FieldValues = Record<string, FieldValue>;

export interface ContractSummary {
  id: number;
  title: string;
  kind: TemplateKind;
  templateName: string;
  status: ContractStatus;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  signerEmail: string | null;
}

export interface ContractEvent {
  id: number;
  kind: string;
  label: string;
  actor: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
  at: string;
}

export interface ContractDetail extends ContractSummary {
  clientId: number;
  clientName: string;
  templateId: number;
  templateVersion: number;
  language: ContractLanguage;
  values: FieldValues;
  signerValues: Record<string, string> | null;
  fields: FieldDef[];
  signer: { name: string | null; email: string | null; phone: string | null };
  linkDays: number;
  ownerSign: boolean;
  declineReason: string | null;
  sentSha256: string | null;
  signedSha256: string | null;
  identityMethod: 'email_code' | 'link_only' | null;
  linkedDocumentId: number | null;
  events: ContractEvent[];
}

export interface ContractInput {
  clientId: number;
  templateId: number;
  title?: string | null;
  language: ContractLanguage;
  values: Record<string, unknown>;
  signer: { name?: string | null; email?: string | null; phone?: string | null };
  linkDays: 7 | 14 | 30;
  ownerSign: boolean;
}

export interface NewDefaults {
  templateId: number;
  templateVersion: number;
  kind: TemplateKind;
  title: string;
  fields: FieldDef[];
  values: FieldValues;
  signer: { name: string; email: string; phone: string };
  linkDays: number[];
  ownerSignature: boolean;
  emailReady: boolean;
}

export interface SendResult {
  url: string;
  whatsappUrl: string;
  expiresAt: string;
  emailed: boolean;
  sha256: string;
}

export const contractsApi = {
  templates: () => apiGet<{ templates: Template[] }>('/contracts/templates'),
  createTemplate: (input: TemplateInput) => apiSend<{ template: Template }>('POST', '/contracts/templates', input),
  updateTemplate: (id: number, input: TemplateInput) => apiSend<{ template: Template }>('PUT', `/contracts/templates/${id}`, input),
  services: (all = false) => apiGet<{ services: Service[] }>(`/contracts/services${all ? '?all=1' : ''}`),
  createService: (input: ServiceInput) => apiSend<{ services: Service[] }>('POST', '/contracts/services', input),
  updateService: (id: number, input: ServiceInput) => apiSend<{ services: Service[] }>('PUT', `/contracts/services/${id}`, input),
  forClient: (clientId: number) => apiGet<{ contracts: ContractSummary[] }>(`/contracts/clients/${clientId}`),
  defaults: (clientId: number, templateId: number) => apiGet<NewDefaults>(`/contracts/new?clientId=${clientId}&templateId=${templateId}`),
  get: (id: number) =>
    apiGet<{ contract: ContractDetail; currentTemplateVersion: number; currentFields: FieldDef[]; emailReady: boolean; ownerSignature: boolean }>(`/contracts/${id}`),
  create: (input: ContractInput) => apiSend<{ contract: ContractDetail }>('POST', '/contracts', input),
  update: (id: number, input: ContractInput) => apiSend<{ contract: ContractDetail }>('PUT', `/contracts/${id}`, input),
  send: (id: number, channel: 'email' | 'link') => apiSend<SendResult>('POST', `/contracts/${id}/send`, { channel }),
  remind: (id: number, channel: 'email' | 'link') => apiSend<SendResult>('POST', `/contracts/${id}/remind`, { channel }),
  void: (id: number, reason: string | null) => apiSend<{ contract: ContractDetail }>('POST', `/contracts/${id}/void`, { reason }),
  proforma: (id: number) => apiSend<{ documentId: number }>('POST', `/contracts/${id}/proforma`, {}),
  pdfUrl: (id: number, which: 'sent' | 'signed', download = false) => `/api/contracts/${id}/pdf?which=${which}${download ? '&download=1' : ''}`,
};

/** The preview is HTML, so it skips the JSON client. */
export async function fetchPreview(input: ContractInput): Promise<string> {
  const res = await fetch('/api/contracts/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/html' }, body: JSON.stringify(input) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'The preview failed.');
  }
  return res.text();
}
