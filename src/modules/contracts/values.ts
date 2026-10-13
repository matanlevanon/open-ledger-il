import { all, first, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { isCurrency } from '../../core/money';
import { printedIdentity } from '../businesses/service';
import type { ClientRow } from '../clients/service';
import { isChoice, isMoney, isScope, valueText } from './render';
import {
  type ChoiceValue,
  choiceValue,
  type FieldDef,
  type FieldValue,
  type FieldValues,
  MODEL_LABELS,
  moneyValue,
  type ScopeService,
  type ServiceModel,
} from './types';

/** R25: field values. Prefill from the client and the business, and checks on what the owner types. */

interface ContactRow {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

function joinAddress(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(', ');
}

export function clientValue(client: ClientRow, contact: ContactRow | null, source: string | null | undefined): string {
  switch (source) {
    case 'name':
    case 'name_en':
      return client.name_en || client.name_he || '';
    case 'name_he':
      return client.name_he || client.name_en || '';
    case 'tax_id':
      return client.company_id || client.vat_number || '';
    case 'address':
    case 'address_en':
      return joinAddress(client.address_en, client.city, client.postal_code);
    case 'address_he':
      return joinAddress(client.address_he || client.address_en, client.city, client.postal_code);
    case 'contact_name':
      return contact?.name ?? '';
    case 'contact_email':
      return contact?.email || client.email || '';
    case 'contact_phone':
      return contact?.phone || client.phone || '';
    case 'email':
      return client.email ?? '';
    default:
      return '';
  }
}

export interface BusinessFacts {
  nameEn: string;
  nameHe: string;
  legalName: string;
  taxId: string;
  addressEn: string;
  addressHe: string;
  email: string;
  phone: string;
  website: string;
}

export async function businessFacts(db: D1Database, businessId: number, ownerTaxId: string | null): Promise<BusinessFacts> {
  const identity = await printedIdentity(db, businessId, null);
  const row = await first<{ name_en: string; tax_id: string | null }>(db, 'SELECT name_en, tax_id FROM businesses WHERE id = ?', businessId);
  return {
    nameEn: identity.nameEn,
    nameHe: identity.nameHe,
    legalName: row?.name_en ?? identity.nameEn,
    taxId: row?.tax_id?.trim() || (businessId === 1 ? (ownerTaxId ?? '') : ''),
    addressEn: identity.addressEn ?? '',
    addressHe: identity.addressHe ?? '',
    email: identity.email ?? '',
    phone: identity.phone ?? '',
    website: identity.website ?? '',
  };
}

export function businessValue(b: BusinessFacts, source: string | null | undefined): string {
  switch (source) {
    case 'name':
    case 'name_en':
      return b.nameEn || b.nameHe;
    case 'name_he':
      return b.nameHe || b.nameEn;
    case 'legal_name':
      return b.legalName;
    case 'tax_id':
      return b.taxId;
    case 'address':
    case 'address_en':
      return b.addressEn || b.addressHe;
    case 'address_he':
      return b.addressHe || b.addressEn;
    case 'email':
      return b.email;
    case 'phone':
      return b.phone;
    case 'website':
      return b.website;
    default:
      return '';
  }
}

/** Values the Ledger knows before the owner types: client and business fields, and defaults. */
export async function prefill(db: D1Database, businessId: number, client: ClientRow, fields: FieldDef[], ownerTaxId: string | null): Promise<FieldValues> {
  const contact = await first<ContactRow>(db, 'SELECT name, role, email, phone FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, id LIMIT 1', client.id);
  const facts = await businessFacts(db, businessId, ownerTaxId);
  const out: FieldValues = {};
  for (const field of fields) {
    if (field.kind === 'client') out[field.key] = clientValue(client, contact, field.source);
    else if (field.kind === 'business') out[field.key] = businessValue(facts, field.source);
    else if (field.kind === 'owner_input' && field.defaultValue) out[field.key] = await expandStartingValue(db, businessId, field.key, field.defaultValue);
  }
  return out;
}

/**
 * A starting value may carry tokens: {YYYY}, {YY}, {MM} for the date, and {N}, {NN}, {NNN}... for a
 * running number. "WO-{YYYY}-{NNN}" gives WO-2026-001, then WO-2026-002: the next number after the
 * highest one this business already used in the same field with the same prefix and suffix, across
 * every contract, drafts included. A new year starts again at 1. The owner can still type over it.
 */
export async function expandStartingValue(db: D1Database, businessId: number, key: string, pattern: string, today: string = todayIsrael()): Promise<string> {
  const dated = pattern.replace(/\{YYYY\}/g, today.slice(0, 4)).replace(/\{YY\}/g, today.slice(2, 4)).replace(/\{MM\}/g, today.slice(5, 7));
  const counter = /\{(N+)\}/.exec(dated);
  if (!counter) return dated;
  const width = counter[1]!.length;
  const before = dated.slice(0, counter.index);
  const after = dated.slice(counter.index + counter[0].length);
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = new RegExp(`^${esc(before)}(\\d+)${esc(after)}$`);
  const rows = await all<{ v: unknown }>(db, 'SELECT json_extract(field_values_json, ?) AS v FROM contracts WHERE business_id = ?', `$.${key}`, businessId);
  let max = 0;
  for (const r of rows) {
    const m = typeof r.v === 'string' ? shape.exec(r.v.trim()) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${before}${String(max + 1).padStart(width, '0')}${after}`;
}

/** The signer the client page suggests: its primary contact. */
export async function suggestedSigner(db: D1Database, client: ClientRow): Promise<{ name: string; email: string; phone: string }> {
  const contact = await first<ContactRow>(db, 'SELECT name, role, email, phone FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, id LIMIT 1', client.id);
  return { name: contact?.name ?? '', email: contact?.email || client.email || '', phone: contact?.phone || client.phone || '' };
}

const str = (v: unknown, max = 5000): string => {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new ValidationError('A field value is not text.');
  return String(v).slice(0, max);
};

interface ServiceSnapshotRow {
  id: number;
  name_en: string;
  name_he: string;
  model: ServiceModel;
  model_label_en: string | null;
  model_label_he: string | null;
  description_en: string;
  description_he: string;
}

/**
 * The scope picker value, rebuilt from the business's services list: names and items are copied
 * in now, so a later edit of the list never changes this contract once it is sent.
 */
async function scopeSnapshot(db: D1Database, businessId: number, raw: unknown): Promise<{ services: ScopeService[] }> {
  const input = (raw && typeof raw === 'object' ? (raw as { services?: unknown }).services : null) ?? [];
  if (!Array.isArray(input)) throw new ValidationError('The services list is not valid.');
  const services: ScopeService[] = [];
  for (const entry of input.slice(0, 30)) {
    const e = entry as { serviceId?: unknown; itemIds?: unknown; items?: unknown; other?: unknown; note?: unknown; fee?: unknown };
    const serviceId = Number(e.serviceId);
    const row = await first<ServiceSnapshotRow>(db, 'SELECT * FROM contract_services WHERE id = ? AND business_id = ?', serviceId, businessId);
    if (!row) throw new ValidationError('A ticked service is not in this business.');
    const wanted: number[] = Array.isArray(e.itemIds)
      ? e.itemIds.map(Number)
      : Array.isArray(e.items)
        ? (e.items as { itemId?: unknown }[]).map((i) => Number(i.itemId))
        : [];
    const items = wanted.length
      ? await all<{ id: number; label_en: string; label_he: string }>(
          db,
          `SELECT id, label_en, label_he FROM contract_service_items WHERE service_id = ? AND business_id = ? AND id IN (${wanted.map(() => '?').join(',')}) ORDER BY sort_order, id`,
          serviceId,
          businessId,
          ...wanted,
        )
      : [];
    if (items.length !== new Set(wanted).size) throw new ValidationError('A ticked scope item is not part of its service.');
    const fee = e.fee === null || e.fee === undefined || e.fee === '' ? null : moneyValue.parse(e.fee);
    services.push({
      serviceId,
      nameEn: row.name_en,
      nameHe: row.name_he,
      modelEn: row.model_label_en || MODEL_LABELS[row.model].en,
      modelHe: row.model_label_he || MODEL_LABELS[row.model].he,
      descriptionEn: row.description_en,
      descriptionHe: row.description_he,
      items: items.map((i) => ({ itemId: i.id, labelEn: i.label_en, labelHe: i.label_he })),
      other: str(e.other, 1000).trim() || null,
      note: str(e.note, 2000).trim() || null,
      fee,
    });
  }
  return { services };
}

function choice(field: FieldDef, raw: unknown): ChoiceValue {
  const v = choiceValue.parse(raw ?? {});
  const known = new Set(field.options.map((o) => o.value));
  const selected = v.selected.filter((s) => known.has(s.value));
  if (!field.multiple && selected.length > 1) throw new ValidationError(`Pick one option for ${field.labelEn || field.key}.`);
  if (!field.allowOther && v.other) throw new ValidationError(`${field.labelEn || field.key} has no Other option.`);
  return { selected: selected.map((s) => ({ value: s.value, text: field.options.find((o) => o.value === s.value)?.freeText ? (s.text ?? null) : null })), other: v.other ?? null };
}

/**
 * Checks what the owner typed against the field list. Signer inputs, signatures and signing dates
 * are not the owner's to fill and are dropped.
 */
export async function normalizeOwnerValues(db: D1Database, businessId: number, fields: FieldDef[], raw: Record<string, unknown>): Promise<FieldValues> {
  const out: FieldValues = {};
  for (const field of fields) {
    if (!(field.key in raw)) continue;
    const v = raw[field.key];
    switch (field.kind) {
      case 'client':
      case 'business':
        out[field.key] = str(v, 1000);
        break;
      case 'owner_input':
        if (field.inputType === 'money') {
          out[field.key] = v === null || v === undefined || v === '' ? null : moneyValue.parse(v);
        } else if (field.inputType === 'date') {
          const s = str(v, 10);
          if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`Use a date like 2026-11-01 for ${field.labelEn || field.key}.`);
          out[field.key] = s;
        } else if (field.inputType === 'number') {
          const s = str(v, 40).trim();
          if (s && !/^-?\d+(\.\d+)?$/.test(s)) throw new ValidationError(`Use a number for ${field.labelEn || field.key}.`);
          out[field.key] = s;
        } else out[field.key] = str(v, field.inputType === 'multiline' ? 10000 : 1000);
        break;
      case 'choice':
        out[field.key] = field.binding === 'services' ? await scopeSnapshot(db, businessId, v) : choice(field, v);
        break;
      default:
        break;
    }
  }
  return out;
}

function isFilled(field: FieldDef, v: FieldValue | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (isMoney(v)) return isCurrency(v.currency);
  if (isScope(v)) return v.services.length > 0;
  if (isChoice(v)) return v.selected.length > 0 || Boolean(v.other?.trim());
  return valueText(field, v, 'en').trim() !== '';
}

/** Required fields the owner fills that are still empty, by label. */
export function missingOwnerFields(fields: FieldDef[], values: FieldValues): string[] {
  return fields
    .filter((f) => f.required && (f.kind === 'client' || f.kind === 'business' || f.kind === 'owner_input' || f.kind === 'choice'))
    .filter((f) => !isFilled(f, values[f.key]))
    .map((f) => f.labelEn || f.labelHe || f.key);
}

/** Every ticked service on a scope field must carry a fee when the field feeds the pro forma. */
export function scopeFees(fields: FieldDef[], values: FieldValues): { name: string; nameHe: string; fee: { amountMinor: number; currency: string } | null }[] {
  const out: { name: string; nameHe: string; fee: { amountMinor: number; currency: string } | null }[] = [];
  for (const field of fields) {
    if (field.kind !== 'choice' || field.binding !== 'services') continue;
    const v = values[field.key];
    if (!isScope(v)) continue;
    for (const s of v.services) out.push({ name: s.nameEn || s.nameHe, nameHe: s.nameHe, fee: s.fee ?? null });
  }
  return out;
}
