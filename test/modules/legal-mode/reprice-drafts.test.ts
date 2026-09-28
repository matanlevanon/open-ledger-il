import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDocumentsModule } from '../../../src/modules/documents';
import type { CeilingGuard } from '../../../src/modules/documents/ceiling';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { RATES } from '../../fixtures/documents/rates';

/**
 * R11 fix 2: "reprice drafts only when the owner ticks an option". Its own file, because a
 * switch only ever succeeds once per file's storage (test/modules/legal-mode/routes.test.ts
 * already spends the one switch on the default, repriceDrafts-unset path).
 */

const passThroughCeiling: CeilingGuard = { async check() {} };
const TODAY = '2026-11-20';

function app() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }),
    ],
  });
}

async function api(instance: ReturnType<typeof app>, method: string, path: string, body?: unknown) {
  const res = await instance.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(await res.json())}`);
  return res.json<any>();
}

describe('POST /api/legal-mode/switch with repriceDrafts: true', () => {
  it('reprices every open draft with VAT, and keeps 0% for a foreign-resident client', async () => {
    const instance = app();
    const israeli = await api(instance, 'POST', '/clients', { nameEn: 'Israeli Co', country: 'IL', vatNumber: '514713288' });
    const foreign = await api(instance, 'POST', '/clients', { nameEn: 'Foreign Co', country: 'GB', foreignResident: true });

    const domesticDraft = await api(instance, 'POST', '/documents', {
      type: 'PR',
      clientId: israeli.client.id,
      lines: [{ description: 'Retainer', unitPriceMinor: 200000 }],
    });
    const foreignDraft = await api(instance, 'POST', '/documents', {
      type: 'QT',
      clientId: foreign.client.id,
      lines: [{ description: 'Export', unitPriceMinor: 900000 }],
    });
    expect(domesticDraft.document.vat_amount_minor).toBe(0);

    const res = await instance.request(
      '/api/legal-mode/switch',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ effectiveDate: '2099-05-01', repriceDrafts: true }) },
      { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ repricedDrafts: number[] }>();
    expect(body.repricedDrafts.slice().sort((a, b) => a - b)).toEqual(
      [domesticDraft.document.id, foreignDraft.document.id].sort((a, b) => a - b),
    );

    const domesticAfter = await first<{ status: string; vat_amount_minor: number; total_minor: number }>(
      env.DB,
      'SELECT status, vat_amount_minor, total_minor FROM documents WHERE id = ?',
      domesticDraft.document.id,
    );
    expect(domesticAfter).toMatchObject({ status: 'draft', vat_amount_minor: 36000, total_minor: 236000 });

    // Foreign resident: 0% stays 0% (section 30(a)(5)), not a stray non-zero rate from repricing.
    const foreignAfter = await first<{ status: string; vat_rate_bp: number | null; vat_amount_minor: number; total_minor: number }>(
      env.DB,
      'SELECT status, vat_rate_bp, vat_amount_minor, total_minor FROM documents WHERE id = ?',
      foreignDraft.document.id,
    );
    expect(foreignAfter).toMatchObject({ status: 'draft', vat_rate_bp: 0, vat_amount_minor: 0, total_minor: 900000 });

    const audited = await first(env.DB, `SELECT id FROM audit_log WHERE action = 'legal_mode.switch_repriced_drafts'`);
    expect(audited).not.toBeNull();
  });
});
