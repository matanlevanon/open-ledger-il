import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDocumentsModule } from '../../../src/modules/documents';
import type { CeilingGuard } from '../../../src/modules/documents/ceiling';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { RATES } from '../../fixtures/documents/rates';

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

async function switchRequest(instance: ReturnType<typeof app>, body: unknown, asEmail = 'owner@example.com') {
  return instance.request(
    '/api/legal-mode/switch',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: asEmail },
  );
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

interface SwitchBody {
  status: string;
  effectiveDate: string;
  seriesOpened: string[];
  seriesClosed: string[];
  openPaymentRequests: { id: number; displayNumber: string | null; totalMinor: number }[];
  repricedDrafts: number[];
  vatOfficeTaskDueAt: string;
}

describe('POST /api/legal-mode/switch: the real עוסק מורשה switch (runs/R11-murshe.md)', () => {
  it('refuses an accountant, even with every feature switch on', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await run(env.DB, `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(
      env.DB,
      `INSERT INTO user_features (user_id, feature, enabled) SELECT id, f.feature, 1 FROM users, (SELECT 'reports' AS feature UNION SELECT 'monthly_pack') f WHERE email = ?`,
      email,
    );
    const res = await switchRequest(app(), { effectiveDate: '2099-04-01' }, email);
    expect(res.status).toBe(403);
  });

  it('refuses an effective date in the past', async () => {
    const res = await switchRequest(app(), { effectiveDate: '2000-01-01' });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed date', async () => {
    const res = await switchRequest(app(), { effectiveDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  /**
   * One switch per system, ever (PLAN.md decision 2: "No automatic switch", never reversed). This
   * test is deliberately the only one in the file that lets a switch succeed, and checks every
   * effect of that one confirmation together: closing the old 400 series and opening the five
   * מורשה series (fix 1: 400 itself is never disabled), flipping document_types, the legal_modes
   * row, the 15-day VAT-office task, leaving a final PR untouched while listing it (fix 2), and
   * that a second confirmation is refused.
   */
  it('confirms the switch once: series, document types, the VAT-office task, and the open-PR list', async () => {
    const instance = app();
    const client = await api(instance, 'POST', '/clients', { nameEn: 'Untouched Co', country: 'IL', vatNumber: '514713288' });
    const draft = await api(instance, 'POST', '/documents', {
      type: 'PR',
      clientId: client.client.id,
      lines: [{ description: 'Retainer', unitPriceMinor: 100000 }],
    });
    // A second, still-open draft: this switch does not tick repriceDrafts, so it must stay
    // exactly as it is, not just the final PR below (fix 2's other half; repriceDrafts: true is
    // covered in test/modules/legal-mode/reprice-drafts.test.ts, which needs its own switch: only
    // one switch ever succeeds, and this run's storage is shared across every it() in this file).
    const untouchedDraft = await api(instance, 'POST', '/documents', {
      type: 'PR',
      clientId: client.client.id,
      lines: [{ description: 'Another retainer', unitPriceMinor: 50000 }],
    });
    const original = await api(instance, 'POST', `/documents/${draft.document.id}/finalize`, {});
    expect(original.document.status).toBe('final');
    expect(original.document.vat_amount_minor).toBe(0);
    const originalHash = (await first<{ hash: string; updated_at: string }>(env.DB, 'SELECT hash, updated_at FROM documents WHERE id = ?', original.document.id))!;

    const res = await switchRequest(instance, { effectiveDate: '2099-01-01', reason: 'crossed the ceiling' });
    expect(res.status).toBe(200);
    const body = await res.json<SwitchBody>();
    expect(body.status).toBe('confirmed');
    expect(body.seriesClosed).toEqual(['400']);
    expect(body.seriesOpened.slice().sort()).toEqual(['305', '320', '330', '332', '400-M']);
    expect(body.vatOfficeTaskDueAt).toBe('2099-01-16');

    const modes = await all<{ mode: string; effective_from: string }>(env.DB, 'SELECT mode, effective_from FROM legal_modes ORDER BY effective_from');
    expect(modes.at(-1)).toMatchObject({ mode: 'murshe', effective_from: '2099-01-01' });

    // Fix 1: the old 400 series closes, but a fresh one for 400 opens right alongside it. The type
    // itself is never disabled, so a plain receipt against a 305 stays possible.
    const closed = await first<{ closed_at: string | null }>(env.DB, "SELECT closed_at FROM series WHERE id = '400'");
    expect(closed?.closed_at).not.toBeNull();
    const newReceiptSeries = await first<{ doc_type: string; legal_mode: string | null; closed_at: string | null }>(
      env.DB,
      "SELECT doc_type, legal_mode, closed_at FROM series WHERE id = '400-M'",
    );
    expect(newReceiptSeries).toMatchObject({ doc_type: '400', legal_mode: 'murshe', closed_at: null });

    const opened = await all<{ id: string; legal_mode: string | null; closed_at: string | null }>(
      env.DB,
      "SELECT id, legal_mode, closed_at FROM series WHERE id IN ('305', '320', '330', '332') ORDER BY id",
    );
    expect(opened).toHaveLength(4);
    for (const s of opened) {
      expect(s.legal_mode).toBe('murshe');
      expect(s.closed_at).toBeNull();
    }

    const types = await all<{ code: string; enabled: number }>(
      env.DB,
      "SELECT code, enabled FROM document_types WHERE code IN ('305', '320', '330', '332', '400')",
    );
    const byCode = Object.fromEntries(types.map((t) => [t.code, t.enabled]));
    // 400 stays enabled=1 throughout: never disabled by the switch (fix 1).
    expect(byCode).toMatchObject({ '305': 1, '320': 1, '330': 1, '332': 1, '400': 1 });

    const task = await first<{ due_at: string; status: string }>(
      env.DB,
      "SELECT due_at, status FROM tasks WHERE kind = 'vat_office_notice' ORDER BY id DESC LIMIT 1",
    );
    expect(task).toMatchObject({ status: 'open', due_at: '2099-01-16' });

    const audited = await all(env.DB, `SELECT * FROM audit_log WHERE action = 'legal_mode.switch_confirmed'`);
    expect(audited.length).toBeGreaterThan(0);

    // Fix 2, CLAUDE.md rule 1: the switch never touches a final document. The open PR is listed,
    // not revised, cancelled or re-priced; its hash, status and updated_at stay exactly as they were.
    expect(body.openPaymentRequests).toHaveLength(1);
    expect(body.openPaymentRequests[0]).toMatchObject({ id: original.document.id, totalMinor: 100000 });
    expect(body.repricedDrafts).toEqual([]);
    const originalAfter = await first<{ status: string; hash: string; updated_at: string; vat_amount_minor: number }>(
      env.DB,
      'SELECT status, hash, updated_at, vat_amount_minor FROM documents WHERE id = ?',
      original.document.id,
    );
    expect(originalAfter).toMatchObject({ status: 'final', hash: originalHash.hash, updated_at: originalHash.updated_at, vat_amount_minor: 0 });

    // repriceDrafts was not ticked: the other open draft is left exactly as it was too.
    expect(body.repricedDrafts).toEqual([]);
    const draftAfter = await first<{ status: string; vat_amount_minor: number }>(
      env.DB,
      'SELECT status, vat_amount_minor FROM documents WHERE id = ?',
      untouchedDraft.document.id,
    );
    expect(draftAfter).toMatchObject({ status: 'draft', vat_amount_minor: 0 });

    // No automatic switch, and no second switch (PLAN.md decision 2).
    const second = await switchRequest(instance, { effectiveDate: '2099-01-02' });
    expect(second.status).toBe(409);
  });
});
