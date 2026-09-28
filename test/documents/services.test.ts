import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, issue, makeClient, ok } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('services catalog (R17 task 5)', () => {
  it('creates a service with defaults and lists it', async () => {
    const created = await ok('POST', '/services', {
      nameEn: 'Growth audit',
      nameHe: 'בדיקת צמיחה',
      descriptionEn: 'A one-week review of the growth machine.',
      unitPriceMinor: 500000,
      currency: 'USD',
      unit: 'project',
    });
    const row = created.services.find((s: any) => s.name_en === 'Growth audit');
    expect(row).toBeDefined();
    expect(row.currency).toBe('USD');
    expect(row.unit).toBe('project');
    expect(row.default_quantity_milli).toBe(1000);
    expect(row.vat_treatment).toBe('standard');
    expect(row.active).toBe(1);
  });

  it('rejects an unknown unit', async () => {
    const bad = await api('POST', '/services', { nameEn: 'X', unitPriceMinor: 100, unit: 'week' });
    expect(bad.status).toBe(400);
  });

  it('edits and archives a service, and reactivates it', async () => {
    const created = await ok('POST', '/services', { nameEn: 'Retainer', unitPriceMinor: 200000 });
    const id = created.services[0].id;
    const edited = await ok('PATCH', `/services/${id}`, { unitPriceMinor: 250000 });
    expect(edited.services[0].unit_price_minor).toBe(250000);
    const archived = await ok('POST', `/services/${id}/archive`);
    expect(archived.services[0].active).toBe(0);
    const reactivated = await ok('POST', `/services/${id}/activate`);
    expect(reactivated.services[0].active).toBe(1);
  });

  /** Same partial()-with-defaults bug as clientPatch: a PATCH of one field must not reset the others to their zod defaults. */
  it('a PATCH of one field never resets an omitted defaulted field', async () => {
    const created = await ok('POST', '/services', { nameEn: 'Design sprint', unitPriceMinor: 500000, currency: 'USD', unit: 'project', vatTreatment: 'exempt' });
    const id = created.services.find((s: any) => s.name_en === 'Design sprint').id;
    const updated = await ok('PATCH', `/services/${id}`, { unitPriceMinor: 550000 });
    const svc = updated.services.find((s: any) => s.id === id);
    expect(svc.unit_price_minor).toBe(550000);
    expect(svc.currency).toBe('USD');
    expect(svc.unit).toBe('project');
    expect(svc.vat_treatment).toBe('exempt');
    expect(svc.active).toBe(1);
  });

  it('reorders the whole list and rejects a partial list', async () => {
    await ok('POST', '/services', { nameEn: 'Reorder A', unitPriceMinor: 100 });
    const afterB = await ok('POST', '/services', { nameEn: 'Reorder B', unitPriceMinor: 100 });
    const ids: number[] = afterB.services.map((s: any) => s.id);
    const reversed = [...ids].reverse();
    const reordered = await ok('PUT', '/services/reorder', { ids: reversed });
    expect(reordered.services.map((s: any) => s.id)).toEqual(reversed);
    const bad = await api('PUT', '/services/reorder', { ids: [ids[0]!] });
    expect(bad.status).toBe(400);
  });

  it('only an owner can write', async () => {
    const created = await ok('POST', '/services', { nameEn: 'Owner only', unitPriceMinor: 100 });
    const id = created.services[0].id;
    const forbidden = await api('PATCH', `/services/${id}`, { unitPriceMinor: 200 }, 'nobody@example.com');
    expect(forbidden.status).toBe(403);
  });

  it('lists active-only when asked', async () => {
    const created = await ok('POST', '/services', { nameEn: 'Inactive one', unitPriceMinor: 100 });
    const id = created.services[0].id;
    await ok('POST', `/services/${id}/archive`);
    const activeOnly = await ok('GET', '/services?active=1');
    expect(activeOnly.services.some((s: any) => s.id === id)).toBe(false);
    const all = await ok('GET', '/services');
    expect(all.services.some((s: any) => s.id === id)).toBe(true);
  });

  it('creates a line referencing a service and stores its item_id', async () => {
    const svc = await ok('POST', '/services', { nameEn: 'Consulting hour', unitPriceMinor: 50000, unit: 'hour' });
    const id = svc.services[0].id;
    const draft = await ok('POST', '/documents', { type: 'PR', lines: [{ description: 'Consulting hour', itemId: id, quantityMilli: 2000, unitPriceMinor: 50000 }] });
    expect(draft.lines[0].item_id).toBe(id);
  });
});

/** R18 task 4: an optional description line on each document line, carried from the service catalog's own description. */
describe('line description (R18 task 4)', () => {
  it('stores and returns detail_en/detail_he for a line with a description', async () => {
    const draft = await ok('POST', '/documents', {
      type: 'PR',
      lines: [{ description: 'Consulting', detail: 'October retainer', detailHe: 'ריטיינר אוקטובר', quantityMilli: 1000, unitPriceMinor: 100000 }],
    });
    expect(draft.lines[0].detail_en).toBe('October retainer');
    expect(draft.lines[0].detail_he).toBe('ריטיינר אוקטובר');
  });

  it('leaves detail_en/detail_he null for a line without one', async () => {
    const draft = await ok('POST', '/documents', { type: 'PR', lines: [{ description: 'Consulting', quantityMilli: 1000, unitPriceMinor: 100000 }] });
    expect(draft.lines[0].detail_en).toBeNull();
    expect(draft.lines[0].detail_he).toBeNull();
  });

  it('carries the service catalog description into a new line when the app fills it from a service', async () => {
    const svc = await ok('POST', '/services', {
      nameEn: 'Retainer for detail test',
      descriptionEn: 'Monthly marketing retainer',
      descriptionHe: 'ריטיינר שיווק חודשי',
      unitPriceMinor: 300000,
    });
    const service = svc.services.find((s: any) => s.name_en === 'Retainer for detail test');
    const id = service.id;
    const draft = await ok('POST', '/documents', {
      type: 'PR',
      lines: [
        {
          description: service.name_en,
          itemId: id,
          detail: service.description_en,
          detailHe: service.description_he,
          quantityMilli: 1000,
          unitPriceMinor: 300000,
        },
      ],
    });
    expect(draft.lines[0].detail_en).toBe('Monthly marketing retainer');
    expect(draft.lines[0].detail_he).toBe('ריטיינר שיווק חודשי');
  });

  it('keeps the description through an edit (delete-and-reinsert)', async () => {
    const draft = await ok('POST', '/documents', {
      type: 'QT',
      lines: [{ description: 'Consulting', detail: 'Kept across edits', quantityMilli: 1000, unitPriceMinor: 100000 }],
    });
    const updated = await ok('PATCH', `/documents/${draft.document.id}`, {
      lines: [{ description: 'Consulting', detail: 'Kept across edits', quantityMilli: 2000, unitPriceMinor: 100000 }],
    });
    expect(updated.lines[0].detail_en).toBe('Kept across edits');
  });

  it('keeps the description through convert', async () => {
    const clientId = await makeClient();
    const qt = await issue('QT', {
      clientId,
      lines: [{ description: 'Consulting', detail: 'Kept through convert', quantityMilli: 1000, unitPriceMinor: 100000 }],
    });
    const converted = await ok('POST', `/documents/${qt.document.id}/convert`, { type: 'PR' });
    expect(converted.lines[0].detail_en).toBe('Kept through convert');
  });
});

/**
 * Same partial()-with-defaults bug as clientPatch/servicePatch, but on draftPatch: lines,
 * payments, paymentMethodIds, showIls and carryRate all carry a zod .default(...), so a PATCH
 * meaning to change only one field used to wipe every one of those back to its default
 * (empty array / false) whenever the request omitted them.
 */
describe('draft PATCH never resets an omitted defaulted field (R18 PATCH-bug audit)', () => {
  it('a notes-only PATCH keeps lines and the payment methods multi-select', async () => {
    const svc = await ok('POST', '/payment-methods', { displayName: 'Bank Leumi', type: 'bank_transfer', details: {} });
    const methodId = svc.paymentMethods[0].id;
    const draft = await ok('POST', '/documents', {
      type: 'PR',
      lines: [{ description: 'Consulting', quantityMilli: 1000, unitPriceMinor: 100000 }],
      paymentMethodIds: [methodId],
      showIls: true,
    });
    const updated = await ok('PATCH', `/documents/${draft.document.id}`, { notes: 'Just a note' });
    expect(updated.document.notes).toBe('Just a note');
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0].unit_price_minor).toBe(100000);
    expect(JSON.parse(updated.document.payment_method_ids)).toEqual([methodId]);
    expect(updated.meta.show_ils).toBe(1);
  });
});
