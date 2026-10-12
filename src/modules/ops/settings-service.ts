import type { AuditActor } from '../../core/audit';
import { actorBiz, auditStatement } from '../../core/audit';
import { readBusinessSetting, settingKey } from '../../core/business';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { ISSUING_KEY } from '../../core/issuing';
import { ConflictError, DomainError, NotFoundError } from '../../core/errors';
import type { CeilingInput, VatRateInput } from './schemas';

export interface BusinessProfileRow {
  id: number;
  name_en: string;
  name_he: string;
  tagline_en: string | null;
  tagline_he: string | null;
  address_en: string | null;
  address_he: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bank_details: string | null;
  logo_r2_key: string | null;
  signature_r2_key: string | null;
  tax_id: string | null;
  payment_link_stripe: string | null;
  payment_link_paypal: string | null;
  updated_at: string;
}

/** R24: Settings > Business edits the current business. */
export async function getBusinessProfile(db: D1Database, businessId: number): Promise<BusinessProfileRow> {
  const row = await first<BusinessProfileRow>(db, 'SELECT * FROM businesses WHERE id = ?', businessId);
  if (!row) throw new NotFoundError('Business profile');
  return row;
}

const BUSINESS_COLUMNS: [string, string][] = [
  ['nameEn', 'name_en'],
  ['nameHe', 'name_he'],
  ['taglineEn', 'tagline_en'],
  ['taglineHe', 'tagline_he'],
  ['addressEn', 'address_en'],
  ['addressHe', 'address_he'],
  ['taxId', 'tax_id'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['website', 'website'],
  ['bankDetails', 'bank_details'],
  ['paymentLinkStripe', 'payment_link_stripe'],
  ['paymentLinkPaypal', 'payment_link_paypal'],
];

export async function updateBusinessProfile(
  db: D1Database,
  actor: AuditActor,
  patch: Record<string, unknown>,
): Promise<BusinessProfileRow> {
  const set = BUSINESS_COLUMNS.filter(([key]) => patch[key] !== undefined);
  if (set.length > 0) {
    await transaction(db, [
      stmt(
        db,
        `UPDATE businesses SET ${set.map(([, col]) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...set.map(([key]) => (patch[key] as string | null) ?? null),
        nowIso(),
        actorBiz(actor),
      ),
      auditStatement(db, actor, 'ops.business_update', 'business', actorBiz(actor), { fields: set.map(([, col]) => col) }),
    ]);
  }
  return getBusinessProfile(db, actorBiz(actor));
}

export async function setBusinessLogo(db: D1Database, actor: AuditActor, r2Key: string | null): Promise<void> {
  await transaction(db, [
    stmt(db, 'UPDATE businesses SET logo_r2_key = ?, updated_at = ? WHERE id = ?', r2Key, nowIso(), actorBiz(actor)),
    auditStatement(db, actor, 'ops.business_logo_update', 'business', actorBiz(actor), { key: r2Key }),
  ]);
}

export async function setSignatureImage(db: D1Database, actor: AuditActor, r2Key: string | null): Promise<void> {
  await transaction(db, [
    stmt(db, 'UPDATE businesses SET signature_r2_key = ?, updated_at = ? WHERE id = ?', r2Key, nowIso(), actorBiz(actor)),
    auditStatement(db, actor, 'ops.signature_image_update', 'business', actorBiz(actor), { key: r2Key }),
  ]);
}

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------

/** Fields Settings > Business must hold before any document can be created. */
export const REQUIRED_BUSINESS_FIELDS = ['name_en', 'name_he', 'tax_id', 'address_en'] as const;

/** The required business fields that are still empty. An empty list means setup is done. */
export async function missingBusinessFields(db: D1Database, businessId: number): Promise<string[]> {
  const row = await first<Record<string, string | null>>(db, 'SELECT name_en, name_he, tax_id, address_en FROM businesses WHERE id = ?', businessId);
  return REQUIRED_BUSINESS_FIELDS.filter((f) => !row?.[f]?.trim());
}

/** Refuses to create a document until the business profile is filled in (first-run setup). */
export async function assertBusinessReady(db: D1Database, businessId: number): Promise<void> {
  const missing = await missingBusinessFields(db, businessId);
  if (missing.length > 0) {
    throw new DomainError('business_profile_incomplete', 'Fill in Settings > Business before you create a document.', 409, { missing });
  }
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * Series for Settings > Numbering. Hides series whose document type is disabled, so a retired type
 * (PF, replaced by 300 as the pro forma) never shows as a second "Pro Forma Invoice" row.
 */
export async function listSeries(db: D1Database, businessId: number) {
  return all(
    db,
    `SELECT s.id, s.doc_type, s.name_en, s.name_he, s.legal_mode, s.start_number, s.next_number, s.started_at, s.closed_at
       FROM series s LEFT JOIN document_types dt ON dt.code = s.doc_type
      WHERE s.business_id = ? AND (dt.enabled IS NULL OR dt.enabled = 1)
      ORDER BY s.doc_type`,
    businessId,
  );
}

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

export async function listCeilings(db: D1Database) {
  return all(db, 'SELECT id, year, amount_minor, currency, note FROM ceilings ORDER BY year DESC');
}

export async function upsertCeiling(db: D1Database, actor: AuditActor, input: CeilingInput): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO ceilings (year, amount_minor, currency, note) VALUES (?, ?, ?, ?)
       ON CONFLICT (year) DO UPDATE SET amount_minor = excluded.amount_minor, currency = excluded.currency, note = excluded.note`,
      input.year,
      input.amountMinor,
      input.currency,
      input.note ?? null,
    ),
    auditStatement(db, actor, 'ops.ceiling_set', 'ceiling', input.year, { amountMinor: input.amountMinor, currency: input.currency }),
  ]);
}

// ---------------------------------------------------------------------------
// VAT rates
// ---------------------------------------------------------------------------

export async function listVatRates(db: D1Database) {
  return all(db, 'SELECT id, rate_bp, effective_from, note FROM vat_rates ORDER BY effective_from DESC');
}

export async function addVatRate(db: D1Database, actor: AuditActor, input: VatRateInput): Promise<void> {
  const existing = await first(db, 'SELECT id FROM vat_rates WHERE effective_from = ?', input.effectiveFrom);
  if (existing) throw new ConflictError('vat_rate_exists', `A VAT rate already takes effect on ${input.effectiveFrom}.`);
  await transaction(db, [
    stmt(db, 'INSERT INTO vat_rates (rate_bp, effective_from, note) VALUES (?, ?, ?)', input.rateBp, input.effectiveFrom, input.note ?? null),
    auditStatement(db, actor, 'ops.vat_rate_add', 'vat_rate', input.effectiveFrom, { rateBp: input.rateBp }),
  ]);
}

// ---------------------------------------------------------------------------
// Signature mode
// ---------------------------------------------------------------------------

export async function getSignatureMode(db: D1Database, businessId: number): Promise<'secured' | 'none'> {
  return (await readBusinessSetting(db, businessId, 'signature_mode')) === 'none' ? 'none' : 'secured';
}

export async function setSignatureMode(db: D1Database, actor: AuditActor, mode: 'secured' | 'none'): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      settingKey(actorBiz(actor), 'signature_mode'),
      mode,
      nowIso(),
    ),
    auditStatement(db, actor, 'ops.signature_mode_set', 'settings', 'signature_mode', { mode }),
  ]);
}

/**
 * Turns issuing on or off (src/core/issuing.ts). Turning it on first moves recurring schedules
 * that fell behind past today, so no backlog is issued. Owner only, audited.
 */
export async function setIssuing(db: D1Database, actor: AuditActor, enabled: boolean, skippedSchedules: number): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      settingKey(actorBiz(actor), ISSUING_KEY),
      enabled ? 'on' : 'off',
      nowIso(),
    ),
    auditStatement(db, actor, enabled ? 'ops.issuing_on' : 'ops.issuing_off', 'settings', ISSUING_KEY, { enabled, skippedSchedules }),
  ]);
}
