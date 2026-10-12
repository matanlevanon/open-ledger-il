import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { seriesIdFor } from '../../core/business';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import { type EntityType, allowedNewBusinessTypes } from '../legal-mode/business-type';

/**
 * R24 Phase B: more than one business in one Ledger, and the brands each business prints.
 * A business is a legal entity with its own tax ID, series, hash chain, clients and documents.
 * A brand is the name, tagline, logo and contact block a document prints. Empty brand fields
 * print the business's own value.
 */

/** The series every new business starts with, the same set business 1 was seeded with. */
const BASE_SERIES = ['QT', 'PR', 'PF', '300', '400', '405'];

export interface BusinessSummary {
  id: number;
  nameEn: string;
  nameHe: string;
  taxId: string | null;
  entityType: EntityType;
  role: AuthUser['role'];
}

/** The businesses this person may open, with their role in each. */
export async function listMyBusinesses(db: D1Database, user: AuthUser): Promise<BusinessSummary[]> {
  if (user.businesses.length === 0) return [];
  const ids = user.businesses.map((b) => b.id);
  const rows = await all<{ id: number; name_en: string; name_he: string; tax_id: string | null; entity_type: EntityType }>(
    db,
    `SELECT id, name_en, name_he, tax_id, entity_type FROM businesses WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ...ids,
  );
  return rows.map((r) => ({
    id: r.id,
    nameEn: r.name_en,
    nameHe: r.name_he,
    taxId: r.tax_id,
    entityType: r.entity_type,
    role: user.businesses.find((b) => b.id === r.id)!.role,
  }));
}

export interface NewBusinessInput {
  entityType: EntityType;
  nameEn: string;
  nameHe: string;
  taxId: string;
  addressEn: string;
  addressHe?: string | null;
}

/**
 * Opens a new business: its row, an empty default brand, a פטור legal mode, the base series, and
 * the creator as its owner. A מורשה or a company then runs the `registered` switch, so it starts
 * VAT registered (src/modules/legal-mode). Nothing moves from another business.
 */
export async function createBusiness(db: D1Database, actor: AuditActor, user: AuthUser, input: NewBusinessInput): Promise<number> {
  if (user.role !== 'owner') throw new ForbiddenError('Only an owner adds a business.');
  const allowed = await allowedNewBusinessTypes(db);
  if (!allowed.includes(input.entityType)) {
    throw new ConflictError(
      'one_osek_only',
      'A person has one עוסק file, פטור or מורשה. This Ledger already has one, so the new business is a company.',
    );
  }
  const next = await first<{ id: number }>(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM businesses');
  const id = next!.id;
  const base = await all<{ id: string; doc_type: string; name_en: string; name_he: string | null; legal_mode: string | null }>(
    db,
    `SELECT id, doc_type, name_en, name_he, legal_mode FROM series WHERE business_id = 1 AND id IN (${BASE_SERIES.map(() => '?').join(',')})`,
    ...BASE_SERIES,
  );
  const created = { ...actor, businessId: id };
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO businesses (id, name_en, name_he, tax_id, address_en, address_he, entity_type) VALUES (?, ?, ?, ?, ?, ?, 'osek_patur')`,
      id,
      input.nameEn,
      input.nameHe,
      input.taxId,
      input.addressEn,
      input.addressHe ?? null,
    ),
    stmt(db, 'INSERT INTO brands (business_id, is_default) VALUES (?, 1)', id),
    stmt(db, "INSERT INTO legal_modes (business_id, mode, effective_from, note) VALUES (?, 'patur', '2020-01-01', 'עוסק פטור until the confirmed switch')", id),
    ...base.map((s) =>
      stmt(
        db,
        'INSERT INTO series (id, doc_type, name_en, name_he, legal_mode, business_id) VALUES (?, ?, ?, ?, ?, ?)',
        seriesIdFor(id, s.id),
        s.doc_type,
        s.name_en,
        s.name_he,
        s.legal_mode,
        id,
      ),
    ),
    stmt(db, "INSERT INTO user_businesses (user_id, business_id, role, granted_by) VALUES (?, ?, 'owner', ?)", user.id, id, user.id),
    auditStatement(db, actor, 'business.create', 'business', id, { entityType: input.entityType, fromBusiness: actorBiz(actor) }),
    auditStatement(db, created, 'business.create', 'business', id, { entityType: input.entityType }),
  ]);
  return id;
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export interface BrandRow {
  id: number;
  business_id: number;
  name_en: string;
  name_he: string;
  tagline_en: string | null;
  tagline_he: string | null;
  logo_r2_key: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_en: string | null;
  address_he: string | null;
  is_default: number;
  active: number;
}

export async function listBrands(db: D1Database, businessId: number): Promise<BrandRow[]> {
  return all<BrandRow>(db, 'SELECT * FROM brands WHERE business_id = ? ORDER BY is_default DESC, id', businessId);
}

export async function getBrand(db: D1Database, id: number, businessId: number): Promise<BrandRow> {
  const row = await first<BrandRow>(db, 'SELECT * FROM brands WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Brand', id);
  return row;
}

export interface BrandInput {
  nameEn?: string;
  nameHe?: string;
  taglineEn?: string | null;
  taglineHe?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressEn?: string | null;
  addressHe?: string | null;
  active?: boolean;
}

const BRAND_COLUMNS: [keyof BrandInput, keyof BrandRow][] = [
  ['nameEn', 'name_en'],
  ['nameHe', 'name_he'],
  ['taglineEn', 'tagline_en'],
  ['taglineHe', 'tagline_he'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['website', 'website'],
  ['addressEn', 'address_en'],
  ['addressHe', 'address_he'],
];

export async function createBrand(db: D1Database, actor: AuditActor, input: BrandInput): Promise<number> {
  const businessId = actorBiz(actor);
  const cols = BRAND_COLUMNS.filter(([k]) => input[k] !== undefined);
  const [res] = await transaction(db, [
    stmt(
      db,
      `INSERT INTO brands (business_id${cols.map(([, c]) => `, ${c}`).join('')}) VALUES (?${cols.map(() => ', ?').join('')})`,
      businessId,
      ...cols.map(([k]) => (input[k] as string | null) ?? null),
    ),
    auditStatement(db, actor, 'brand.create', 'brand', null, { nameEn: input.nameEn ?? '' }),
  ]);
  return res!.meta.last_row_id;
}

export async function updateBrand(db: D1Database, actor: AuditActor, id: number, input: BrandInput): Promise<void> {
  const brand = await getBrand(db, id, actorBiz(actor));
  if (input.active === false && brand.is_default === 1) throw new ConflictError('default_brand', 'The default brand stays on.');
  const cols = BRAND_COLUMNS.filter(([k]) => input[k] !== undefined);
  const sets = cols.map(([, c]) => `${c} = ?`);
  const values: (string | number | null)[] = cols.map(([k]) => (input[k] as string | null) ?? null);
  if (input.active !== undefined) {
    sets.push('active = ?');
    values.push(input.active ? 1 : 0);
  }
  if (sets.length === 0) return;
  await transaction(db, [
    stmt(db, `UPDATE brands SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND business_id = ?`, ...values, nowIso(), id, actorBiz(actor)),
    auditStatement(db, actor, 'brand.update', 'brand', id, { fields: cols.map(([, c]) => c) }),
  ]);
}

export async function setBrandLogo(db: D1Database, actor: AuditActor, id: number, r2Key: string | null): Promise<void> {
  await getBrand(db, id, actorBiz(actor));
  await transaction(db, [
    stmt(db, 'UPDATE brands SET logo_r2_key = ?, updated_at = ? WHERE id = ? AND business_id = ?', r2Key, nowIso(), id, actorBiz(actor)),
    auditStatement(db, actor, 'brand.logo_update', 'brand', id, { key: r2Key }),
  ]);
}

/** What a document prints in its header. Brand fields win, empty ones print the business's own. */
export interface PrintedIdentity {
  nameEn: string;
  nameHe: string;
  taglineEn: string | null;
  taglineHe: string | null;
  logoR2Key: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressEn: string | null;
  addressHe: string | null;
}

const pick = (brand: string | null | undefined, business: string | null | undefined): string | null =>
  brand !== null && brand !== undefined && brand.trim() !== '' ? brand : (business ?? null);

/**
 * The identity printed for a document: its brand over its business. A null brand is the
 * business's default brand. The tax ID, legal name and legal type always come from the business.
 */
export async function printedIdentity(db: D1Database, businessId: number, brandId: number | null): Promise<PrintedIdentity> {
  const business = await first<Record<string, string | null>>(
    db,
    'SELECT name_en, name_he, tagline_en, tagline_he, logo_r2_key, email, phone, website, address_en, address_he FROM businesses WHERE id = ?',
    businessId,
  );
  const brand =
    brandId === null
      ? await first<Record<string, string | null>>(db, 'SELECT * FROM brands WHERE business_id = ? AND is_default = 1', businessId)
      : await first<Record<string, string | null>>(db, 'SELECT * FROM brands WHERE id = ? AND business_id = ?', brandId, businessId);
  return {
    nameEn: pick(brand?.name_en, business?.name_en) ?? '',
    nameHe: pick(brand?.name_he, business?.name_he) ?? '',
    taglineEn: pick(brand?.tagline_en, business?.tagline_en),
    taglineHe: pick(brand?.tagline_he, business?.tagline_he),
    logoR2Key: pick(brand?.logo_r2_key, business?.logo_r2_key),
    email: pick(brand?.email, business?.email),
    phone: pick(brand?.phone, business?.phone),
    website: pick(brand?.website, business?.website),
    addressEn: pick(brand?.address_en, business?.address_en),
    addressHe: pick(brand?.address_he, business?.address_he),
  };
}

/** The business a document belongs to, for routes reached by a signed link with no signed-in user. */
export async function businessOfDocument(db: D1Database, documentId: number): Promise<number> {
  const row = await first<{ business_id: number }>(db, 'SELECT business_id FROM documents WHERE id = ?', documentId);
  if (!row) throw new NotFoundError('Document', documentId);
  return row.business_id;
}

/** The business a client belongs to, for the public consent link. */
export async function businessOfClient(db: D1Database, clientId: number): Promise<number> {
  const row = await first<{ business_id: number }>(db, 'SELECT business_id FROM clients WHERE id = ?', clientId);
  if (!row) throw new NotFoundError('Client', clientId);
  return row.business_id;
}
