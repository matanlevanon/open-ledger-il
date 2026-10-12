import { z } from 'zod';
import { CURRENCY_CODES } from '../../core/money';

/** R25: contracts and work orders. Field model, values and row shapes. */

export const TEMPLATE_KINDS = ['contract', 'work_order'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const CONTRACT_LANGUAGES = ['en', 'he', 'both'] as const;
export type ContractLanguage = (typeof CONTRACT_LANGUAGES)[number];

export const CONTRACT_STATUSES = ['draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'void'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const LINK_DAYS = [7, 14, 30] as const;
export const DEFAULT_LINK_DAYS = 14;

export const SERVICE_MODELS = ['fixed_fee', 'monthly_retainer', 'milestones'] as const;
export type ServiceModel = (typeof SERVICE_MODELS)[number];

export const MODEL_LABELS: Record<ServiceModel, { en: string; he: string }> = {
  fixed_fee: { en: 'Fixed fee', he: 'מחיר קבוע' },
  monthly_retainer: { en: 'Monthly retainer', he: 'ריטיינר חודשי' },
  milestones: { en: 'Milestones', he: 'אבני דרך' },
};

export const FIELD_KINDS = ['client', 'business', 'owner_input', 'signer_input', 'signature', 'signed_date', 'choice'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Where a `client` field reads from. */
export const CLIENT_SOURCES = ['name', 'name_en', 'name_he', 'tax_id', 'address', 'address_en', 'address_he', 'contact_name', 'contact_email', 'contact_phone', 'email'] as const;
/** Where a `business` field reads from: the business and its default brand. */
export const BUSINESS_SOURCES = ['name', 'name_en', 'name_he', 'legal_name', 'tax_id', 'address', 'address_en', 'address_he', 'email', 'phone', 'website'] as const;
export const OWNER_INPUT_TYPES = ['text', 'multiline', 'money', 'date', 'number'] as const;
export const SIGNER_INPUT_TYPES = ['name', 'role', 'text', 'date'] as const;
export const PARTIES = ['owner', 'client'] as const;
export type Party = (typeof PARTIES)[number];
/** What a field feeds when a signed work order becomes a draft pro forma. */
export const MAPS_TO = ['amount', 'currency', 'start_date', 'description'] as const;

const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, 'A field key uses lowercase letters, digits and underscores, and starts with a letter.');

export const choiceOption = z.object({
  value: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
  labelEn: z.string().trim().max(300).default(''),
  labelHe: z.string().trim().max(300).default(''),
  /** The option has its own free-text box, for example "On milestones: ___". */
  freeText: z.boolean().default(false),
});

export const fieldDef = z.object({
  key,
  labelEn: z.string().trim().max(200).default(''),
  labelHe: z.string().trim().max(200).default(''),
  kind: z.enum(FIELD_KINDS),
  required: z.boolean().default(false),
  /** `signature` and `signed_date`: whose signature or date. */
  party: z.enum(PARTIES).nullish(),
  /** `client` and `business`: the attribute it reads. */
  source: z.string().trim().max(40).nullish(),
  /** `owner_input` and `signer_input`: the input type. */
  inputType: z.string().trim().max(20).nullish(),
  /** `choice`: the options, single or multiple, with an "Other" free-text option. */
  options: z.array(choiceOption).max(40).default([]),
  multiple: z.boolean().default(false),
  allowOther: z.boolean().default(false),
  /** `choice` bound to Settings > Contract templates > Services: the scope picker. */
  binding: z.enum(['services']).nullish(),
  /** A starting value for `owner_input`, for example the 14 in "within [14] days". */
  defaultValue: z.string().max(2000).nullish(),
  mapsTo: z.enum(MAPS_TO).nullish(),
});
export type FieldDef = z.infer<typeof fieldDef>;

export const templateInput = z.object({
  name: z.string().trim().min(1, 'Name the template.').max(200),
  kind: z.enum(TEMPLATE_KINDS),
  bodyEn: z.string().max(200_000).default(''),
  bodyHe: z.string().max(200_000).default(''),
  fields: z.array(fieldDef).max(200).default([]),
  active: z.boolean().default(true),
});
export type TemplateInput = z.infer<typeof templateInput>;

export const serviceInput = z.object({
  nameEn: z.string().trim().max(200).default(''),
  nameHe: z.string().trim().max(200).default(''),
  model: z.enum(SERVICE_MODELS).default('fixed_fee'),
  modelLabelEn: z.string().trim().max(100).nullish(),
  modelLabelHe: z.string().trim().max(100).nullish(),
  descriptionEn: z.string().trim().max(1000).default(''),
  descriptionHe: z.string().trim().max(1000).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        id: z.number().int().positive().nullish(),
        labelEn: z.string().trim().max(500).default(''),
        labelHe: z.string().trim().max(500).default(''),
        active: z.boolean().default(true),
      }),
    )
    .max(60)
    .default([]),
});
export type ServiceInput = z.infer<typeof serviceInput>;

/** A money value typed by the owner: integer minor units and a currency. */
export const moneyValue = z.object({
  amountMinor: z.number().int().refine(Number.isSafeInteger),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
});
export type MoneyValue = z.infer<typeof moneyValue>;

/** One ticked service on a Work Order, with the names and items copied in at the time. */
export const scopeService = z.object({
  serviceId: z.number().int().positive(),
  nameEn: z.string().max(200).default(''),
  nameHe: z.string().max(200).default(''),
  modelEn: z.string().max(100).default(''),
  modelHe: z.string().max(100).default(''),
  descriptionEn: z.string().max(1000).default(''),
  descriptionHe: z.string().max(1000).default(''),
  items: z.array(z.object({ itemId: z.number().int().positive(), labelEn: z.string().max(500).default(''), labelHe: z.string().max(500).default('') })).max(60).default([]),
  other: z.string().trim().max(1000).nullish(),
  note: z.string().trim().max(2000).nullish(),
  fee: moneyValue.nullish(),
});
export type ScopeService = z.infer<typeof scopeService>;

export const scopeValue = z.object({ services: z.array(scopeService).max(30).default([]) });
export type ScopeValue = z.infer<typeof scopeValue>;

/** A `choice` field not bound to services: the picked options and their free text. */
export const choiceValue = z.object({
  selected: z.array(z.object({ value: z.string().max(40), text: z.string().trim().max(1000).nullish() })).max(40).default([]),
  other: z.string().trim().max(1000).nullish(),
});
export type ChoiceValue = z.infer<typeof choiceValue>;

/** Values by field key. Strings for text fields, objects for money, choice and scope. */
export type FieldValue = string | MoneyValue | ScopeValue | ChoiceValue | null;
export type FieldValues = Record<string, FieldValue>;

export const signerInput = z.object({ name: z.string().trim().min(1, 'Add the signer name.').max(200), email: z.string().trim().email(), phone: z.string().trim().max(40).nullish() });

export const contractInput = z.object({
  clientId: z.number().int().positive(),
  templateId: z.number().int().positive(),
  title: z.string().trim().max(200).nullish(),
  language: z.enum(CONTRACT_LANGUAGES).default('en'),
  values: z.record(z.string(), z.unknown()).default({}),
  signer: z.object({ name: z.string().trim().max(200).nullish(), email: z.string().trim().max(200).nullish(), phone: z.string().trim().max(40).nullish() }).default({}),
  linkDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(DEFAULT_LINK_DAYS),
  ownerSign: z.boolean().default(false),
});
export type ContractInput = z.infer<typeof contractInput>;

export interface TemplateRow {
  id: number;
  business_id: number;
  name: string;
  kind: TemplateKind;
  current_version: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersionRow {
  id: number;
  template_id: number;
  business_id: number;
  version: number;
  name: string;
  kind: TemplateKind;
  body_en: string;
  body_he: string;
  fields_json: string;
  created_by: number | null;
  created_at: string;
}

export interface ContractRow {
  id: number;
  business_id: number;
  client_id: number;
  template_id: number;
  template_version: number;
  kind: TemplateKind;
  title: string;
  language: ContractLanguage;
  field_values_json: string;
  signer_values_json: string | null;
  status: ContractStatus;
  signer_name: string | null;
  signer_email: string | null;
  signer_phone: string | null;
  link_days: number;
  owner_sign: number;
  owner_signed_at: string | null;
  owner_signed_by: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  expires_at: string | null;
  void_at: string | null;
  sent_pdf_r2_key: string | null;
  sent_pdf_sha256: string | null;
  signed_pdf_r2_key: string | null;
  signed_pdf_sha256: string | null;
  signed_content_sha256: string | null;
  identity_method: 'email_code' | 'link_only' | null;
  linked_document_id: number | null;
  unsigned_alerted_at: string | null;
}

export interface ContractEventRow {
  id: number;
  contract_id: number;
  business_id: number;
  kind: string;
  actor_email: string | null;
  actor_role: string | null;
  ip: string | null;
  user_agent: string | null;
  details_json: string | null;
  created_at: string;
}

export interface CodeRow {
  id: number;
  contract_id: number;
  code_hash: string;
  sent_to: string;
  expires_at: string;
  attempts: number;
  confirmed_at: string | null;
  superseded: number;
  created_at: string;
}

export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_TRIES = 5;
/** A dashboard line once a contract sits sent and unsigned this long. */
export const UNSIGNED_AFTER_DAYS = 7;
/** A dashboard line when the link ends within this many days. */
export const EXPIRING_WITHIN_DAYS = 2;
/** Largest signature image accepted from the signing page. */
export const MAX_SIGNATURE_BYTES = 400_000;
