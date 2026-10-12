import type { AuditActor } from '../../core/audit';
import { auditAs, auditStatement } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { first, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError } from '../../core/errors';
import type { Env } from '../../env';
import {
  type Ctx,
  type DocumentsModuleOptions,
  type OpenPaymentRequestSummary,
  buildDocumentsServices,
  listOpenFinalPaymentRequests,
  repriceOpenDraftsForSwitch,
} from '../documents';
import { seriesIdFor } from '../../core/business';
import { REGISTERED_NOTE, getEntityType, isFreshLedger } from './business-type';

/**
 * The real עוסק מורשה switch (docs/legal-requirements.md, "Switch from פטור to מורשה", point 4),
 * confirmed once from the ceiling-crossing screen or the Settings tax screen. There is no
 * automatic switch and no way back: PLAN.md decision 2, "No automatic switch."
 */

/** Types R11 opens a fresh מורשה series for. Their series id equals their code. */
const MURSHE_SERIES_TYPES = ['305', '320', '330', '332'] as const;
/** The פטור receipt series the switch closes. The type itself (400) is never disabled: a plain
 * receipt stays possible against a standalone tax invoice once switched (runs/R11-murshe.md
 * fix 1), it just numbers from a fresh series like the four tax-invoice types do. */
const PATUR_RECEIPT_SERIES = '400';
const MURSHE_RECEIPT_SERIES = '400-M';
/** VAT registration regulation 8(א): notice to the VAT office within 15 days of the event. */
const VAT_OFFICE_NOTICE_DAYS = 15;

export interface SwitchResult {
  effectiveDate: string;
  seriesOpened: string[];
  seriesClosed: string[];
  /** Final payment requests the switch left untouched (CLAUDE.md rule 1). The owner reissues or cancels each one by hand. */
  openPaymentRequests: OpenPaymentRequestSummary[];
  /** Draft ids re-saved, only when the owner ticked repriceDrafts. Never a final document. */
  repricedDrafts: number[];
  /** Null for the `registered` flavour: the registration is already done. */
  vatOfficeTaskDueAt: string | null;
  entityType: 'osek_murshe' | 'company';
}

/**
 * R24 Phase A. `becoming`: the owner picks the start date and the VAT office task is added.
 * `registered`: the business was already מורשה before the Ledger, only on a fresh Ledger, starts
 * today, no task. `company` runs the registered flavour and records a company.
 */
export type SwitchKind = 'becoming' | 'registered';

export interface SwitchOptions {
  kind: SwitchKind;
  effectiveDate: string;
  reason: string | null;
  repriceDrafts: boolean;
  /** The business type the switch records. `company` comes only from start-company. */
  target: 'osek_murshe' | 'company';
  /** R24 Phase B: the business that switches. Its own series, legal modes and tasks. */
  businessId: number;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface SwitchDeps {
  documentsOptions: DocumentsModuleOptions;
  /**
   * docs/legal-requirements.md, "Switch from פטור to מורשה", point 4: after confirmation, one of
   * the three follow-ups is "ITA connection check". Default: a no-op that reports unchecked,
   * until src/modules/index.ts wires the real ITA token status. Never fails the switch itself:
   * the connection can always be fixed later from the ITA screen.
   */
  itaConnectionCheck?: (env: Env, businessId: number) => Promise<{ connected: boolean }>;
}

/**
 * Runs the switch: the legal_modes row, closing the 400 series and opening a fresh one for it
 * alongside the four מורשה series, enabling the מורשה document types, the 15-day VAT-office task,
 * and listing (never editing) open final payment requests. The core state change (legal_modes,
 * series, document_types, task) commits as one transaction. It never touches a final document
 * (CLAUDE.md rule 1: fix with cancel or credit only, and only the owner decides which, per
 * document); `repriceDrafts` only ever reaches saveDraft(), which refuses a non-draft outright.
 */
export async function switchToMurshe(
  env: Env,
  deps: SwitchDeps,
  opts: SwitchOptions,
  user: AuthUser,
  actor: AuditActor,
): Promise<SwitchResult> {
  const db = env.DB;
  const { kind, effectiveDate, reason, repriceDrafts, target, businessId } = opts;
  const already = await first<{ id: number }>(db, "SELECT id FROM legal_modes WHERE mode = 'murshe' AND business_id = ? LIMIT 1", businessId);
  if (already) throw new ConflictError('already_murshe', 'The switch to עוסק מורשה is already confirmed. It cannot run twice.');
  if ((await getEntityType(db, businessId)) !== 'osek_patur') throw new ConflictError('already_murshe', 'This business is not עוסק פטור. There is nothing to switch.');
  if ((kind === 'registered' || target === 'company') && !(await isFreshLedger(db, businessId))) {
    throw new ConflictError(
      'ledger_not_fresh',
      target === 'company'
        ? 'A company starts only on a fresh Ledger, before the first final document.'
        : 'Already registered applies only before the first final document. Use Becoming עוסק מורשה instead.',
    );
  }

  const now = nowIso();
  const vatOfficeTaskDueAt = kind === 'becoming' ? addDays(effectiveDate, VAT_OFFICE_NOTICE_DAYS) : null;
  const seriesOpened = [...MURSHE_SERIES_TYPES, MURSHE_RECEIPT_SERIES].map((id) => seriesIdFor(businessId, id));
  const paturReceiptSeries = seriesIdFor(businessId, PATUR_RECEIPT_SERIES);
  const mursheReceiptSeries = seriesIdFor(businessId, MURSHE_RECEIPT_SERIES);
  const note = kind === 'registered' ? REGISTERED_NOTE : reason;

  await transaction(db, [
    stmt(
      db,
      'INSERT INTO legal_modes (business_id, mode, effective_from, confirmed_at, confirmed_by, note) VALUES (?, ?, ?, ?, ?, ?)',
      businessId,
      'murshe',
      effectiveDate,
      now,
      user.id,
      note,
    ),
    stmt(db, 'UPDATE businesses SET entity_type = ? WHERE id = ?', target, businessId),
    stmt(db, 'UPDATE series SET closed_at = ? WHERE id = ? AND closed_at IS NULL', now, paturReceiptSeries),
    ...MURSHE_SERIES_TYPES.map((code) =>
      stmt(
        db,
        `INSERT INTO series (id, doc_type, name_en, name_he, legal_mode, business_id)
         SELECT ?, code, name_en, name_he, 'murshe', ? FROM document_types
         WHERE code = ? AND NOT EXISTS (SELECT 1 FROM series WHERE id = ?)`,
        seriesIdFor(businessId, code),
        businessId,
        code,
        seriesIdFor(businessId, code),
      ),
    ),
    stmt(
      db,
      `INSERT INTO series (id, doc_type, name_en, name_he, legal_mode, business_id)
       SELECT ?, code, name_en, name_he, 'murshe', ? FROM document_types WHERE code = ?
         AND NOT EXISTS (SELECT 1 FROM series WHERE id = ?)`,
      mursheReceiptSeries,
      businessId,
      PATUR_RECEIPT_SERIES,
      mursheReceiptSeries,
    ),
    stmt(db, `UPDATE document_types SET enabled = 1 WHERE code IN (${MURSHE_SERIES_TYPES.map(() => '?').join(',')})`, ...MURSHE_SERIES_TYPES),
    ...(vatOfficeTaskDueAt
      ? [
          stmt(
            db,
            `INSERT INTO tasks (kind, title, due_at, alert_at, business_id) VALUES ('vat_office_notice', ?, ?, ?, ?)`,
            'Notify the VAT office of the switch to עוסק מורשה',
            vatOfficeTaskDueAt,
            addDays(vatOfficeTaskDueAt, -5),
            businessId,
          ),
        ]
      : []),
    auditStatement(db, actor, target === 'company' ? 'legal_mode.company_started' : 'legal_mode.switch_confirmed', 'legal_mode', effectiveDate, {
      kind,
      entityType: target,
      effectiveDate,
      reason,
      note,
      seriesClosed: [paturReceiptSeries],
      seriesOpened,
    }),
  ]);

  if (deps.itaConnectionCheck) {
    try {
      const { connected } = await deps.itaConnectionCheck(env, businessId);
      await auditAs(db, actor, 'legal_mode.ita_connection_check', 'legal_mode', effectiveDate, { connected });
    } catch {
      // The switch itself already committed. A check that can't run (ITA module not
      // configured, network hiccup) is surfaced on the ITA screen instead, not here.
      await auditAs(db, actor, 'legal_mode.ita_connection_check', 'legal_mode', effectiveDate, { connected: false, checkFailed: true });
    }
  }

  const openPaymentRequests = await listOpenFinalPaymentRequests(db, businessId);

  let repricedDrafts: number[] = [];
  if (repriceDrafts) {
    const ctx: Ctx = { db, actor, user, services: buildDocumentsServices(deps.documentsOptions, env) };
    repricedDrafts = await repriceOpenDraftsForSwitch(ctx, effectiveDate, actor);
    if (repricedDrafts.length > 0) {
      await auditAs(db, actor, 'legal_mode.switch_repriced_drafts', 'legal_mode', effectiveDate, { documentIds: repricedDrafts });
    }
  }

  return {
    effectiveDate,
    seriesOpened,
    seriesClosed: [paturReceiptSeries],
    openPaymentRequests,
    repricedDrafts,
    vatOfficeTaskDueAt,
    entityType: target,
  };
}
