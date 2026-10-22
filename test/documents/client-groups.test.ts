import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, ok } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-22';
});

describe('client groups (R45)', () => {
  it('saves, edits and clears a group, trimmed, with no group as null', async () => {
    const a = await ok('POST', '/clients', { nameEn: 'Group Buyer A', group: '  Open Ledger  ' });
    expect(a.client.client_group).toBe('Open Ledger');
    const none = await ok('POST', '/clients', { nameEn: 'Group None', group: '' });
    expect(none.client.client_group).toBeNull();
    const moved = await ok('PATCH', `/clients/${none.client.id}`, { group: 'Consulting' });
    expect(moved.client.client_group).toBe('Consulting');
    const cleared = await ok('PATCH', `/clients/${none.client.id}`, { group: '' });
    expect(cleared.client.client_group).toBeNull();
    expect((await api('POST', '/clients', { nameEn: 'Too long', group: 'x'.repeat(61) })).status).toBe(400);
  });

  it('filters the list by group, by no group, and lists the groups with counts', async () => {
    await ok('POST', '/clients', { nameEn: 'Filter Shop 1', group: 'Shop Filter' });
    await ok('POST', '/clients', { nameEn: 'Filter Shop 2', group: 'shop filter' });
    await ok('POST', '/clients', { nameEn: 'Filter Plain' });
    const shop = await ok('GET', '/clients?group=Shop%20Filter');
    expect(shop.clients.map((c: { name_en: string }) => c.name_en).sort()).toEqual(['Filter Shop 1', 'Filter Shop 2']);
    const plain = await ok('GET', '/clients?group=__none__');
    expect(plain.clients.some((c: { name_en: string }) => c.name_en === 'Filter Plain')).toBe(true);
    expect(plain.clients.every((c: { client_group: string | null }) => c.client_group === null)).toBe(true);
    const all = await ok('GET', '/clients');
    expect(all.clients.some((c: { name_en: string }) => c.name_en === 'Filter Shop 1')).toBe(true);
    const groups = await ok('GET', '/clients/groups');
    expect(groups.groups.find((g: { name: string }) => g.name.toLowerCase() === 'shop filter')).toMatchObject({ count: 2 });
  });
});
