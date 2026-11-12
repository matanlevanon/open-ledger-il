import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { ledgerEdition } from '../../core/edition';
import { isLedgerAdmin, requireFeature, requireLedgerAdmin, requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { todayIsrael } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import type { DocumentsModuleOptions } from '../documents';
import { allowedNewBusinessTypes } from '../legal-mode/business-type';
import { switchToMurshe } from '../legal-mode/service';
import { isValidIsraeliId } from '../ops/israeli-id';
import { hasCompleteExport } from '../business-export/service';
import { createBrand, createBusiness, listBrands, listMyBusinesses, markMovedOut, updateBrand } from './service';

export * from './service';

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

const newBusinessInput = z.object({
  entityType: z.enum(['osek_patur', 'osek_murshe', 'company']),
  nameEn: z.string().trim().min(1),
  nameHe: z.string().trim().min(1),
  taxId: z
    .string()
    .trim()
    .refine((v) => isValidIsraeliId(v), 'Enter a valid Israeli ID or company number (9 digits).'),
  addressEn: z.string().trim().min(1),
  addressHe: z.string().trim().nullish(),
});

const optionalText = z.string().trim().max(500).nullish();
const movedOutInput = z.object({ confirmName: z.string().max(300), note: z.string().trim().max(1000).nullish() });
const brandInput = z.object({
  nameEn: z.string().trim().max(200).optional(),
  nameHe: z.string().trim().max(200).optional(),
  taglineEn: optionalText,
  taglineHe: optionalText,
  email: optionalText,
  phone: optionalText,
  website: optionalText,
  addressEn: optionalText,
  addressHe: optionalText,
  active: z.boolean().optional(),
});

/**
 * R24 Phase B: /api/businesses. Listing is open to every signed-in person (the top-bar switcher).
 * Adding a business and managing brands are owner actions, in Settings > Businesses and Brands.
 */
export function createBusinessesModule(documentsOptions: DocumentsModuleOptions = {}): ModuleDef {
  const r = new Hono<AppEnv>();

  r.get('/', requireRole('owner', 'assistant', 'accountant'), async (c) =>
    c.json({
      current: businessIdOf(c),
      businesses: await listMyBusinesses(c.env.DB, c.get('user')),
      // B3: the types Add business offers. Only an owner adds one.
      addableTypes: isLedgerAdmin(c.get('user')) ? await allowedNewBusinessTypes(c.env.DB, ledgerEdition(c.env)) : [],
    }),
  );

  // B4: Add business. The new business starts פטור, then a מורשה or a company runs the
  // `registered` switch for that business, so it is VAT registered from its first day.
  // R48: a Ledger-wide action. Single edition: any owner, as before. Firm edition: Ledger admins.
  r.post('/', requireLedgerAdmin(), async (c) => {
    const input = newBusinessInput.parse(await body(c));
    const user = c.get('user');
    const actor = actorFrom(c);
    const id = await createBusiness(c.env.DB, actor, user, input, ledgerEdition(c.env));
    if (input.entityType !== 'osek_patur') {
      await switchToMurshe(
        c.env,
        { documentsOptions },
        {
          kind: 'registered',
          effectiveDate: todayIsrael(),
          reason: null,
          repriceDrafts: false,
          target: input.entityType === 'company' ? 'company' : 'osek_murshe',
          businessId: id,
        },
        { ...user, businessId: id, role: 'owner', businesses: [...user.businesses, { id, role: 'owner' }] },
        { ...actor, businessId: id },
      );
    }
    return c.json({ businessId: id }, 201);
  });

  // R48 task 5: Mark as moved out. Ledger admins, typed confirmation, after a complete export.
  r.post('/:id/moved-out', requireLedgerAdmin(), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || !c.get('user').businesses.some((b) => b.id === id)) throw new NotFoundError('Business', c.req.param('id'));
    const input = movedOutInput.parse(await body(c));
    await markMovedOut(c.env.DB, actorFrom(c), id, input, hasCompleteExport);
    return c.json({ businesses: await listMyBusinesses(c.env.DB, c.get('user')) });
  });

  r.get('/brands', requireFeature('income_documents'), async (c) => c.json({ brands: await listBrands(c.env.DB, businessIdOf(c)) }));

  r.post('/brands', requireRole('owner'), async (c) => {
    const id = await createBrand(c.env.DB, actorFrom(c), brandInput.parse(await body(c)));
    return c.json({ brandId: id, brands: await listBrands(c.env.DB, businessIdOf(c)) }, 201);
  });

  r.patch('/brands/:id', requireRole('owner'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError('Brand', c.req.param('id'));
    await updateBrand(c.env.DB, actorFrom(c), id, brandInput.parse(await body(c)));
    return c.json({ brands: await listBrands(c.env.DB, businessIdOf(c)) });
  });

  return { name: 'businesses', basePath: '/businesses', routes: r };
}
