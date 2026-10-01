import { type AuditActor, auditStatement } from '../../core/audit';
import { assertBusinessReady } from '../ops/settings-service';
import { type AuthUser, hasFeature } from '../../core/auth';
import { legalModeOn, thresholdOn, vatRateOn } from '../../core/config';
import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import { assertIssuing } from '../../core/issuing';
import { finalizeDocument } from '../../core/numbering';
import { type Currency, HOME_CURRENCY, assertCurrency, convert, divRound, normalizeRate, percentOf } from '../../core/money';
import { assertMethodIdsExist, getPaymentMethod, legacyMethodBucket, parseMethodIds } from '../payment-methods';
import { type AllocationCheckClient, type AllocationRequester, needsAllocation } from './allocation';
import { demandBalance } from './balances';
import type { CeilingGuard } from './ceiling';
import { conflict, invalid, mapError, mapped } from './errors';
import { type RateSource, storedFxSource } from './fx';
import {
  type DocRow,
  type LineRow,
  type LoadedDraft,
  type MetaRow,
  type PaymentRow,
  getDoc,
  loadFull,
} from './repo';
import type { DraftInput, DraftPatch, LineInput, PaymentInput } from './schemas';
import { backdateDays, quotesEditableUntilConverted, signatureMode } from './settings';
import { CONVERSIONS, type DocTypeRow, RECEIPT_TYPES, REVISABLE_TYPES, displayNumber, getType } from './types';

export interface Services {
  fx: RateSource;
  ceiling: CeilingGuard;
  today: () => string;
  /** Opens R12's ITA allocation request right after finalize writes a qualifying tax invoice as `awaiting_allocation`. */
  allocation: AllocationRequester;
}

export interface Ctx {
  db: D1Database;
  actor: AuditActor;
  user: AuthUser;
  services: Services;
}

// ---------------------------------------------------------------------------
// Draft state and computation
// ---------------------------------------------------------------------------

interface PaymentState extends PaymentInput {
  /** Rate and ILS fixed by the caller, for credit documents. */
  preset?: { fxRate: string | null; fxRateDate: string | null; fxSource: string | null; amountIls: number };
}

interface DraftState {
  type: DocTypeRow;
  clientId: number | null;
  date: string;
  dueDate: string | null;
  currency: Currency;
  notes: string | null;
  /** Printed on a quote or demand only (R16 task 7); saved back to the client on finalize. */
  paymentInstructions: string | null;
  /** The payment methods multi-select (R17 task 2), same save-back rule as paymentInstructions. */
  paymentMethodIds: number[];
  langVariant: 'en' | 'bilingual';
  lines: LineInput[];
  payments: PaymentState[];
  showIls: boolean;
  overrideRate: string | null;
  /** The day the typed rate belongs to (for example the original document's date). Null when unknown. */
  overrideRateDate: string | null;
  /** Receipt only: each payment at the Bank of Israel rate of its day, not the source document's rate. */
  latestRate: boolean;
  carryRate: boolean;
  sourceId: number | null;
  sourceKind: MetaRow['source_kind'];
  revisesId: number | null;
  backdateReason: string | null;
  creditReason: string | null;
  /**
   * VAT rate lock for a credit document (405, 330): set from the credited document's own
   * vat_rate_bp (creditDocument()), so a credit always mirrors the original's VAT treatment
   * instead of today's rate. `undefined` (every non-credit draft): compute fresh from the legal
   * mode and VAT rate in force on `date`. `null`: an override of zero VAT (the credited document
   * carried none).
   */
  vatRateBpOverride?: number | null;
}

interface Computed {
  doc: {
    legal_mode: string;
    client_id: number | null;
    date: string;
    due_date: string | null;
    currency: string;
    fx_rate: string | null;
    fx_rate_date: string | null;
    fx_source: string | null;
    subtotal_minor: number;
    vat_rate_bp: number | null;
    vat_amount_minor: number;
    total_minor: number;
    total_ils_minor: number | null;
    lang_variant: string;
    notes: string | null;
    payment_instructions: string | null;
    payment_method_ids: string | null;
  };
  lines: (LineInput & { lineTotal: number })[];
  payments: (PaymentState & { fxRate: string | null; fxRateDate: string | null; fxSource: string | null; amountIls: number })[];
}

const isReceiptKind = (t: DocTypeRow) => ['receipt', 'credit', 'invoice_receipt', 'credit_invoice'].includes(t.kind);

export function lineTotal(l: Pick<LineInput, 'quantityMilli' | 'unitPriceMinor' | 'discountMinor'>): number {
  return Number(divRound(BigInt(l.quantityMilli) * BigInt(l.unitPriceMinor), 1000n)) - l.discountMinor;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function openSeriesFor(db: D1Database, type: string): Promise<string> {
  const row = await first<{ id: string }>(db, 'SELECT id FROM series WHERE doc_type = ? AND closed_at IS NULL', type);
  if (!row) conflict('series_closed', `No open number series for type ${type}.`);
  return row.id;
}

async function assertModeAllows(db: D1Database, type: DocTypeRow, date: string): Promise<string> {
  const mode = (await legalModeOn(db, date)).mode;
  if (type.modes !== 'both' && type.modes !== mode) {
    conflict('wrong_legal_mode', `${type.name_en} is not issued in ${mode === 'patur' ? 'עוסק פטור' : 'עוסק מורשה'} mode.`);
  }
  return mode;
}

/** Instruction 18ב(ד): with a secured signature, money comes in by card, crossed cheque or bank transfer only. */
export async function assertPaymentMethods(db: D1Database, type: DocTypeRow, payments: PaymentInput[]): Promise<void> {
  if (!RECEIPT_TYPES.includes(type.code) && type.kind !== 'invoice_receipt') return;
  if ((await signatureMode(db)) !== 'secured') return;
  for (const p of payments) {
    const ok = p.method === 'card' || p.method === 'bank_transfer' || (p.method === 'cheque' && p.chequeCrossed);
    if (!ok) {
      throw new ConflictError(
        'payment_method_not_allowed',
        'With a secured signature, accept card, crossed cheque or bank transfer only.',
      );
    }
  }
}

async function compute(ctx: Ctx, s: DraftState): Promise<Computed> {
  const { db, services } = ctx;
  const mode = await assertModeAllows(db, s.type, s.date);
  const receiptKind = isReceiptKind(s.type);
  if (!receiptKind && s.payments.length > 0) invalid('Only receipts carry payments.');
  if (s.carryRate && !(s.overrideRate || s.showIls)) invalid('Set a rate or show ILS before you carry the rate to the receipt.');
  if (s.currency === HOME_CURRENCY && (s.overrideRate || s.carryRate)) invalid('Rates apply to foreign-currency documents only.');

  const lines = s.lines.map((l) => ({ ...l, lineTotal: lineTotal(l) }));

  // Carried rate: a foreign-currency receipt made from a document takes that document's rate, so
  // its shekel amount matches the document it pays. The source's own rate when it has one (agreed,
  // indicative or carried), otherwise the Bank of Israel rate of the source's date. A rate typed on
  // the receipt (overrideRate) still wins, below.
  let carried: { rate: string; rateDate: string | null; label: string } | null = null;
  if ((s.type.kind === 'receipt' || s.type.kind === 'invoice_receipt') && s.sourceId && s.currency !== HOME_CURRENCY && !s.latestRate) {
    const src = await first<DocRow>(db, 'SELECT * FROM documents WHERE id = ?', s.sourceId);
    if (src && src.currency === s.currency) {
      const label = displayNumber(src.type, src.number) ?? '';
      if (src.fx_rate) {
        carried = { rate: src.fx_rate, rateDate: src.fx_rate_date, label };
      } else {
        try {
          const q = await services.fx.rateFor(s.currency, src.date);
          carried = { rate: q.rate, rateDate: q.rateDate, label };
        } catch {
          // No rate on file for that day: each payment falls back to its own day's rate.
        }
      }
    }
  }

  // A payment naming a catalog entry (R17 task 2) takes its legacy `method` bucket from that
  // entry rather than trusting whatever the caller sent, so the instruction 18ב(ד) secured-
  // signature check and the printed receipt always agree on what was actually chosen.
  const resolvedPayments: PaymentState[] = [];
  for (const p of s.payments) {
    if (p.methodId == null) {
      resolvedPayments.push(p);
      continue;
    }
    const methodRow = await getPaymentMethod(db, p.methodId);
    resolvedPayments.push({ ...p, method: legacyMethodBucket(methodRow) });
  }

  const payments: Computed['payments'] = [];
  for (const p of resolvedPayments) {
    if (p.preset) {
      payments.push({ ...p, ...p.preset });
    } else if (s.currency === HOME_CURRENCY) {
      payments.push({ ...p, fxRate: null, fxRateDate: null, fxSource: null, amountIls: p.amountMinor });
    } else if (s.overrideRate && !s.latestRate) {
      // A rate typed on the receipt itself wins over the carried and the Bank of Israel rate.
      const agreed = normalizeRate(s.overrideRate);
      payments.push({ ...p, fxRate: agreed, fxRateDate: s.overrideRateDate, fxSource: 'agreed', amountIls: convert(p.amountMinor, agreed) });
    } else if (carried) {
      payments.push({
        ...p,
        fxRate: carried.rate,
        fxRateDate: carried.rateDate,
        fxSource: 'carried',
        amountIls: convert(p.amountMinor, carried.rate),
      });
    } else {
      const q = await services.fx.rateFor(s.currency, p.paidOn);
      payments.push({ ...p, fxRate: q.rate, fxRateDate: q.rateDate, fxSource: storedFxSource(q.source), amountIls: convert(p.amountMinor, q.rate) });
    }
  }

  // VAT (docs/legal-requirements.md, עוסק מורשה section; docs/israel-invoices-api.md §1). The rate
  // depends on the legal mode of the document's own date, never on its type: once registered, a
  // plain payment request quotes VAT-inclusive pricing exactly like a tax invoice does. A credit
  // document is the one exception, set by creditDocument(): it carries the credited document's
  // own rate (s.vatRateBpOverride), never today's, so a rate change between the two never
  // reopens the question of how much VAT the original charged.
  // Foreign-resident clients stay at 0% under section 30(a)(5) regardless of mode.
  let vatRateBp: number | null;
  if (s.vatRateBpOverride !== undefined) {
    vatRateBp = s.vatRateBpOverride;
  } else if (mode === 'murshe') {
    const client = s.clientId ? await loadClient(db, s.clientId) : null;
    vatRateBp = client?.foreign_resident === 1 ? 0 : (await vatRateOn(db, s.date)).rate_bp;
  } else {
    vatRateBp = null;
  }
  const rate = vatRateBp ?? 0;

  let subtotal: number;
  let vatAmount: number;
  let total: number;
  let totalIls: number | null;
  let fx: { rate: string | null; date: string | null; source: string | null } = { rate: null, date: null, source: null };

  if (receiptKind) {
    // Payments carry the VAT-inclusive amount actually received. Split it back into the pre-VAT
    // amount and the VAT at the resolved rate; at rate 0 the split is a no-op.
    total = payments.reduce((sum, p) => sum + p.amountMinor, 0);
    subtotal = rate > 0 ? Number(divRound(BigInt(total) * 10_000n, BigInt(10_000 + rate))) : total;
    vatAmount = total - subtotal;
    totalIls = payments.reduce((sum, p) => sum + p.amountIls, 0);
    const first = payments[0];
    if (s.currency !== HOME_CURRENCY && first && payments.every((p) => p.fxRate === first.fxRate && p.fxRateDate === first.fxRateDate)) {
      fx = { rate: first.fxRate, date: first.fxRateDate, source: first.fxSource };
    }
  } else {
    subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    vatAmount = rate > 0 ? percentOf(subtotal, rate) : 0;
    total = subtotal + vatAmount;
    totalIls = null;
    if (s.currency === HOME_CURRENCY) {
      totalIls = total;
    } else if (s.overrideRate) {
      fx = { rate: normalizeRate(s.overrideRate), date: s.overrideRateDate ?? s.date, source: 'agreed' };
      totalIls = convert(total, fx.rate!);
    } else if (s.showIls) {
      const q = await services.fx.rateFor(s.currency, s.date);
      fx = { rate: q.rate, date: q.rateDate, source: 'indicative' };
      totalIls = convert(total, q.rate);
    }
  }

  return {
    doc: {
      legal_mode: mode,
      client_id: s.clientId,
      date: s.date,
      due_date: s.dueDate,
      currency: s.currency,
      fx_rate: fx.rate,
      fx_rate_date: fx.date,
      fx_source: fx.source,
      subtotal_minor: subtotal,
      vat_rate_bp: vatRateBp,
      vat_amount_minor: vatAmount,
      total_minor: total,
      total_ils_minor: totalIls,
      lang_variant: s.langVariant,
      notes: s.notes,
      payment_instructions: s.paymentInstructions,
      payment_method_ids: s.paymentMethodIds.length > 0 ? JSON.stringify(s.paymentMethodIds) : null,
    },
    lines,
    payments,
  };
}

function childStatements(db: D1Database, docId: number, s: DraftState, c: Computed): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  c.lines.forEach((l, i) => {
    out.push(
      stmt(
        db,
        `INSERT INTO document_lines (document_id, position, item_id, description_en, description_he, detail_en, detail_he,
           quantity_milli, unit_price_minor, discount_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        docId,
        i + 1,
        l.itemId ?? null,
        l.description,
        l.descriptionHe ?? null,
        l.detail ?? null,
        l.detailHe ?? null,
        l.quantityMilli,
        l.unitPriceMinor,
        l.discountMinor,
        l.lineTotal,
      ),
    );
  });
  for (const p of c.payments) {
    out.push(
      stmt(
        db,
        `INSERT INTO payments (document_id, method, method_id, paid_on, reference, amount_minor, currency, fx_rate, fx_rate_date,
           fx_source, amount_ils_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        docId,
        p.method,
        p.methodId ?? null,
        p.paidOn,
        p.reference ?? null,
        p.amountMinor,
        s.currency,
        p.fxRate,
        p.fxRateDate,
        p.fxSource,
        p.amountIls,
      ),
      stmt(
        db,
        'INSERT INTO payment_details (payment_id, cheque_crossed, bank_number, branch_number, account_number) VALUES (last_insert_rowid(), ?, ?, ?, ?)',
        p.chequeCrossed,
        p.bankNumber || null,
        p.branchNumber || null,
        p.accountNumber || null,
      ),
    );
  }
  out.push(
    stmt(
      db,
      `INSERT INTO document_meta (document_id, source_id, source_kind, revises_id, show_ils, carry_rate, latest_rate, backdate_reason, credit_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (document_id) DO UPDATE SET source_id = excluded.source_id, source_kind = excluded.source_kind,
         revises_id = excluded.revises_id, show_ils = excluded.show_ils, carry_rate = excluded.carry_rate,
         latest_rate = excluded.latest_rate, backdate_reason = excluded.backdate_reason, credit_reason = excluded.credit_reason`,
      docId,
      s.sourceId,
      s.sourceKind,
      s.revisesId,
      s.showIls,
      s.carryRate,
      s.latestRate,
      s.backdateReason,
      s.creditReason,
    ),
  );
  return out;
}

function eventStatement(db: D1Database, actor: AuditActor, docId: number, kind: string, details?: unknown): D1PreparedStatement {
  return stmt(
    db,
    'INSERT INTO document_events (document_id, kind, at, user_id, user_email, details) VALUES (?, ?, ?, ?, ?, ?)',
    docId,
    kind,
    nowIso(),
    actor.userId,
    actor.email,
    details === undefined ? null : JSON.stringify(details),
  );
}

interface ClientRow {
  id: number;
  currency: string;
  client_copy_lang: 'en' | 'bilingual';
  country: string;
  foreign_resident: number;
  vat_number: string | null;
  company_id: string | null;
  payment_instructions: string | null;
  payment_method_ids: string | null;
}

async function loadClient(db: D1Database, clientId: number): Promise<ClientRow> {
  const client = await first<ClientRow>(
    db,
    'SELECT id, currency, client_copy_lang, country, foreign_resident, vat_number, company_id, payment_instructions, payment_method_ids FROM clients WHERE id = ?',
    clientId,
  );
  if (!client) throw new NotFoundError('Client', clientId);
  return client;
}

function allocationClientOf(client: ClientRow | null): AllocationCheckClient | null {
  if (!client) return null;
  return { foreignResident: client.foreign_resident === 1, vatNumber: client.vat_number, companyId: client.company_id };
}

/** Business-level default payment instructions (R16 task 7), the fallback when a client has none of its own. */
async function defaultPaymentInstructions(db: D1Database): Promise<string | null> {
  const row = await first<{ payment_instructions: string | null }>(db, 'SELECT payment_instructions FROM business_profile WHERE id = 1');
  return row?.payment_instructions ?? null;
}

/** Business-level default payment methods (R17 task 2), the fallback when a client has none of its own. */
async function defaultPaymentMethodIds(db: D1Database): Promise<number[]> {
  const row = await first<{ payment_method_ids: string | null }>(db, 'SELECT payment_method_ids FROM business_profile WHERE id = 1');
  return parseMethodIds(row?.payment_method_ids);
}

async function insertDraft(ctx: Ctx, s: DraftState, event: { kind: string; details?: unknown }): Promise<number> {
  await assertBusinessReady(ctx.db);
  const { db, actor } = ctx;
  const seriesId = await openSeriesFor(db, s.type.code);
  await assertMethodIdsExist(db, s.paymentMethodIds);
  const c = await compute(ctx, s);
  await assertPaymentMethods(db, s.type, s.payments);
  const d = c.doc;
  const { lastRowId: id } = await run(
    db,
    `INSERT INTO documents (type, series_id, status, legal_mode, client_id, date, due_date, currency, fx_rate, fx_rate_date,
       fx_source, subtotal_minor, vat_rate_bp, vat_amount_minor, total_minor, total_ils_minor, lang_variant, notes, payment_instructions,
       payment_method_ids, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.type.code,
    seriesId,
    d.legal_mode,
    d.client_id,
    d.date,
    d.due_date,
    d.currency,
    d.fx_rate,
    d.fx_rate_date,
    d.fx_source,
    d.subtotal_minor,
    d.vat_rate_bp,
    d.vat_amount_minor,
    d.total_minor,
    d.total_ils_minor,
    d.lang_variant,
    d.notes,
    d.payment_instructions,
    d.payment_method_ids,
    actor.userId,
  );
  try {
    await transaction(db, [
      ...childStatements(db, id, s, c),
      eventStatement(db, actor, id, event.kind, event.details),
      auditStatement(db, actor, 'document.create_draft', 'document', id, { type: s.type.code, ...((event.details as object) ?? {}) }),
    ]);
  } catch (err) {
    await run(db, 'DELETE FROM documents WHERE id = ? AND status = ?', id, 'draft').catch(() => undefined);
    throw mapError(err);
  }
  return id;
}

async function saveDraft(ctx: Ctx, id: number, s: DraftState, auditAction = 'document.update_draft'): Promise<void> {
  const { db, actor } = ctx;
  await assertMethodIdsExist(db, s.paymentMethodIds);
  const c = await compute(ctx, s);
  await assertPaymentMethods(db, s.type, s.payments);
  const d = c.doc;
  await mapped(
    transaction(db, [
      stmt(
        db,
        `UPDATE documents SET legal_mode = ?, client_id = ?, date = ?, due_date = ?, currency = ?, fx_rate = ?,
           fx_rate_date = ?, fx_source = ?, subtotal_minor = ?, vat_rate_bp = ?, vat_amount_minor = ?, total_minor = ?,
           total_ils_minor = ?, lang_variant = ?, notes = ?, payment_instructions = ?, payment_method_ids = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
        d.legal_mode,
        d.client_id,
        d.date,
        d.due_date,
        d.currency,
        d.fx_rate,
        d.fx_rate_date,
        d.fx_source,
        d.subtotal_minor,
        d.vat_rate_bp,
        d.vat_amount_minor,
        d.total_minor,
        d.total_ils_minor,
        d.lang_variant,
        d.notes,
        d.payment_instructions,
        d.payment_method_ids,
        nowIso(),
        id,
      ),
      stmt(db, 'DELETE FROM document_lines WHERE document_id = ?', id),
      stmt(db, 'DELETE FROM payment_details WHERE payment_id IN (SELECT id FROM payments WHERE document_id = ?)', id),
      stmt(db, 'DELETE FROM payments WHERE document_id = ?', id),
      ...childStatements(db, id, s, c),
      auditStatement(db, actor, auditAction, 'document', id, { type: s.type.code }),
    ]),
  );
}

function linesFromRows(lines: LineRow[]): LineInput[] {
  return lines.map((l) => ({
    description: l.description_en,
    descriptionHe: l.description_he,
    detail: l.detail_en,
    detailHe: l.detail_he,
    itemId: l.item_id,
    quantityMilli: l.quantity_milli,
    unitPriceMinor: l.unit_price_minor,
    discountMinor: l.discount_minor,
  }));
}

function paymentsFromRows(payments: PaymentRow[], keepRates: boolean): PaymentState[] {
  return payments.map((p) => ({
    method: p.method,
    methodId: p.method_id,
    paidOn: p.paid_on,
    reference: p.reference,
    amountMinor: p.amount_minor,
    chequeCrossed: p.cheque_crossed === 1,
    bankNumber: p.bank_number,
    branchNumber: p.branch_number,
    accountNumber: p.account_number,
    ...(keepRates
      ? { preset: { fxRate: p.fx_rate, fxRateDate: p.fx_rate_date, fxSource: p.fx_source, amountIls: p.amount_ils_minor ?? 0 } }
      : {}),
  }));
}

async function stateFromDb(db: D1Database, loaded: LoadedDraft): Promise<DraftState> {
  const { doc, meta } = loaded;
  const type = await getType(db, doc.type);
  return {
    type,
    clientId: doc.client_id,
    date: doc.date,
    dueDate: doc.due_date,
    currency: assertCurrency(doc.currency),
    notes: doc.notes,
    paymentInstructions: doc.payment_instructions,
    paymentMethodIds: parseMethodIds(doc.payment_method_ids),
    langVariant: doc.lang_variant,
    lines: linesFromRows(loaded.lines),
    payments: paymentsFromRows(loaded.payments, type.kind === 'credit' || type.kind === 'credit_invoice'),
    showIls: meta?.show_ils === 1,
    overrideRate: doc.fx_source === 'agreed' ? doc.fx_rate : null,
    overrideRateDate: doc.fx_source === 'agreed' ? doc.fx_rate_date : null,
    carryRate: meta?.carry_rate === 1,
    latestRate: meta?.latest_rate === 1,
    sourceId: meta?.source_id ?? null,
    sourceKind: meta?.source_kind ?? null,
    revisesId: meta?.revises_id ?? null,
    backdateReason: meta?.backdate_reason ?? null,
    creditReason: meta?.credit_reason ?? null,
    // A credit draft reloaded from the DB (for example on finalize) keeps the rate it was created
    // with rather than recomputing it from today's mode and rate table.
    vatRateBpOverride: type.kind === 'credit' || type.kind === 'credit_invoice' ? doc.vat_rate_bp : undefined,
  };
}

function assertCanSeeType(user: AuthUser, type: string) {
  if (type === 'QT' && !hasFeature(user, 'quotes')) throw new ForbiddenError();
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function createDraft(ctx: Ctx, input: DraftInput): Promise<number> {
  const { db } = ctx;
  await assertIssuing(db);
  assertCanSeeType(ctx.user, input.type);
  const type = await getType(db, input.type);
  if (type.enabled !== 1) conflict('type_disabled', `${type.name_en} is not available yet.`);
  if (type.kind === 'credit') invalid('Create a credit receipt from the receipt it credits.');
  const client = input.clientId ? await loadClient(db, input.clientId) : null;
  const date = input.date ?? ctx.services.today();
  // A new quote or payment request prefills from the client's own payment instructions, falling
  // back to the business default, unless the caller already sent its own text (R16 task 7).
  const paymentInstructions =
    input.paymentInstructions !== undefined && input.paymentInstructions !== null
      ? input.paymentInstructions
      : (client?.payment_instructions ?? (await defaultPaymentInstructions(db)));
  // Same prefill rule as paymentInstructions (R16 task 7): a caller-sent selection wins;
  // otherwise the client's last-used methods, falling back to the business default (R17 task 2).
  const clientMethodIds = parseMethodIds(client?.payment_method_ids);
  const paymentMethodIds =
    input.paymentMethodIds.length > 0 ? input.paymentMethodIds : clientMethodIds.length > 0 ? clientMethodIds : await defaultPaymentMethodIds(db);
  return insertDraft(
    ctx,
    {
      type,
      clientId: client?.id ?? null,
      date,
      dueDate: input.dueDate ?? null,
      currency: assertCurrency(input.currency ?? client?.currency ?? HOME_CURRENCY),
      notes: input.notes ?? null,
      paymentInstructions,
      paymentMethodIds,
      langVariant: input.langVariant ?? client?.client_copy_lang ?? 'en',
      lines: input.lines,
      payments: input.payments,
      showIls: input.showIls,
      overrideRate: input.overrideRate ?? null,
      overrideRateDate: input.overrideRate ? (input.overrideRateDate ?? null) : null,
      carryRate: input.carryRate,
      latestRate: input.latestRate,
      sourceId: null,
      sourceKind: null,
      revisesId: null,
      backdateReason: null,
      creditReason: null,
    },
    { kind: 'created' },
  );
}

export async function updateDraft(ctx: Ctx, id: number, patch: DraftPatch): Promise<void> {
  const { db } = ctx;
  await assertIssuing(db);
  const loaded = await loadFull(db, id);
  assertCanSeeType(ctx.user, loaded.doc.type);
  if (loaded.doc.status !== 'draft') throw new ConflictError('not_draft', 'Only a draft can be edited. Cancel or credit instead.');
  const s = await stateFromDb(db, loaded);
  if (s.type.kind === 'credit') conflict('credit_locked', 'A credit draft cannot be edited. Delete it and credit again.');
  if (patch.clientId !== undefined && patch.clientId !== s.clientId) {
    if (s.sourceId) conflict('client_locked', 'The client comes from the source document.');
    s.clientId = patch.clientId;
  }
  if (patch.currency !== undefined && patch.currency !== s.currency) {
    if (s.sourceId) conflict('currency_locked', 'The currency comes from the source document.');
    s.currency = assertCurrency(patch.currency);
  }
  if (patch.date !== undefined) s.date = patch.date;
  if (patch.dueDate !== undefined) s.dueDate = patch.dueDate ?? null;
  if (patch.notes !== undefined) s.notes = patch.notes ?? null;
  if (patch.paymentInstructions !== undefined) s.paymentInstructions = patch.paymentInstructions ?? null;
  if (patch.paymentMethodIds !== undefined) s.paymentMethodIds = patch.paymentMethodIds;
  if (patch.langVariant !== undefined) s.langVariant = patch.langVariant;
  if (patch.lines !== undefined) s.lines = patch.lines;
  if (patch.payments !== undefined) s.payments = patch.payments;
  if (patch.showIls !== undefined) s.showIls = patch.showIls;
  if (patch.overrideRate !== undefined) {
    s.overrideRate = patch.overrideRate ?? null;
    s.overrideRateDate = s.overrideRate ? (patch.overrideRateDate ?? null) : null;
  }
  if (patch.carryRate !== undefined) s.carryRate = patch.carryRate;
  if (patch.latestRate !== undefined) s.latestRate = patch.latestRate;
  await saveDraft(ctx, id, s);
}

export async function deleteDraft(ctx: Ctx, id: number): Promise<void> {
  const { db, actor } = ctx;
  const doc = await getDoc(db, id);
  assertCanSeeType(ctx.user, doc.type);
  if (doc.status !== 'draft') throw new ConflictError('not_draft', 'Only a draft can be deleted. Cancel or credit instead.');
  await mapped(
    transaction(db, [
      stmt(db, 'DELETE FROM payment_details WHERE payment_id IN (SELECT id FROM payments WHERE document_id = ?)', id),
      stmt(db, 'DELETE FROM payments WHERE document_id = ?', id),
      stmt(db, 'DELETE FROM document_lines WHERE document_id = ?', id),
      stmt(db, 'DELETE FROM document_meta WHERE document_id = ?', id),
      stmt(db, 'DELETE FROM document_events WHERE document_id = ?', id),
      stmt(db, "DELETE FROM documents WHERE id = ? AND status = 'draft'", id),
      auditStatement(db, actor, 'document.delete_draft', 'document', id, { type: doc.type }),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

export interface FinalizeOutcome {
  id: number;
  number: number;
  alreadyFinal: boolean;
  /** 'awaiting_allocation' for a qualifying tax invoice (docs/israel-invoices-api.md §7), else 'final'. */
  status: 'final' | 'awaiting_allocation';
}

async function validateForFinalize(ctx: Ctx, s: DraftState, doc: DocRow, backdateReason: string | null): Promise<string | null> {
  const { db, services, user } = ctx;
  const today = services.today();
  if (s.type.enabled !== 1) conflict('type_disabled', `${s.type.name_en} is not available yet.`);
  if (!s.clientId) invalid('Pick a client before you finalize.');
  const client = await loadClient(db, s.clientId);

  if (isReceiptKind(s.type)) {
    if (s.payments.length === 0) invalid('Add at least one payment.');
    for (const p of s.payments) {
      if ((s.type.kind === 'receipt' || s.type.kind === 'invoice_receipt') && p.amountMinor <= 0) invalid('Payment amounts must be above zero.');
      if ((s.type.kind === 'credit' || s.type.kind === 'credit_invoice') && p.amountMinor >= 0) invalid('Credit amounts must be below zero.');
      if (p.paidOn > today) invalid('A payment date cannot be in the future.');
      if (p.paidOn > s.date) invalid('A payment date cannot be after the receipt date.');
    }
  } else {
    if (s.lines.length === 0) invalid('Add at least one line.');
    if (s.lines.some((l) => lineTotal(l) < 0)) invalid('Line totals cannot be below zero.');
    if (doc.total_minor <= 0) invalid('The total must be above zero.');
  }

  // VAT law amendment 37: client ID or VAT number is required on a tax invoice above the
  // allocation threshold before VAT (docs/legal-requirements.md, עוסק מורשה section).
  if (doc.vat_amount_minor > 0 && !client.foreign_resident) {
    const threshold = await thresholdOn(db, 'allocation', s.date);
    const beforeVatIls = doc.currency === HOME_CURRENCY || !doc.fx_rate ? doc.subtotal_minor : convert(doc.subtotal_minor, doc.fx_rate);
    if (threshold && beforeVatIls > threshold.amount_minor && !client.vat_number && !client.company_id) {
      invalid('This client needs a VAT number or ID before you can finalize a tax invoice above the allocation threshold.');
    }
  }

  // Date rules. Bookkeeping documents are never dated ahead. Back-dating past the limit needs the owner and a reason.
  if (s.type.bookkeeping === 1 && s.date > today) invalid('A bookkeeping document cannot be dated in the future.');
  const limit = addDays(today, -(await backdateDays(db)));
  let backdate: string | null = null;
  if (s.date < limit) {
    if (user.role !== 'owner') throw new ForbiddenError('Only the owner can back-date a document.');
    const reason = (backdateReason ?? s.backdateReason ?? '').trim();
    if (!reason) {
      throw new ConflictError('backdate_reason_required', `The date is more than ${await backdateDays(db)} days back. Add a reason.`);
    }
    backdate = reason;
  }
  const last = await first<{ date: string }>(
    db,
    `SELECT MAX(d.date) AS date FROM finalizations f JOIN documents d ON d.id = f.document_id WHERE f.series_id = ?`,
    doc.series_id,
  );
  if (last?.date && s.date < last.date) {
    conflict('date_before_last_in_series', `The last ${s.type.name_en.toLowerCase()} is dated ${last.date}. Pick that date or later.`);
  }

  await assertPaymentMethods(db, s.type, s.payments);

  if (s.sourceId) {
    const src = await getDoc(db, s.sourceId);
    if (src.status !== 'final') conflict('source_not_open', 'The source document is no longer open.');
    if (src.currency !== s.currency) conflict('currency_mismatch', 'The currency must match the source document.');
    if (s.sourceKind === 'payment') {
      const srcTypeForBalance = await getType(db, src.type);
      if (srcTypeForBalance.kind === 'demand') {
        const bal = await demandBalance(db, src.id);
        if (!bal || bal.remaining_minor <= 0) conflict('source_paid', 'The source document is already paid.');
        if (doc.total_minor > bal.remaining_minor) {
          conflict('payment_exceeds_balance', 'The payment is more than the open balance of the source document.');
        }
      }
      // A non-demand source (a standalone 305 tax invoice, fix 1) has no app-level balance
      // tracking (demandBalance() is scoped to kind='demand'); document_links_payment_cap
      // (migrations/0100_documents.sql) still refuses a payment that would exceed its total_minor.
    }
  }
  if (s.revisesId) await assertRevisable(db, s.revisesId);
  return backdate;
}

/** Freezes a draft: number, hash chain, links, timeline. Calling it again on a final document returns the same number. */
export async function finalize(ctx: Ctx, id: number, opts: { backdateReason?: string | null } = {}): Promise<FinalizeOutcome> {
  const { db } = ctx;
  await assertIssuing(db);
  const loaded = await loadFull(db, id);
  assertCanSeeType(ctx.user, loaded.doc.type);
  if (loaded.doc.status !== 'draft') {
    if (loaded.doc.number !== null && loaded.doc.status !== 'cancelled') {
      return { id, number: loaded.doc.number, alreadyFinal: true, status: loaded.doc.status === 'final' ? 'final' : 'awaiting_allocation' };
    }
    throw new ConflictError('not_draft', 'Only a draft can be finalized.');
  }

  try {
    return await finalizeDraft(ctx, loaded, opts);
  } catch (err) {
    // A concurrent finalize of the same draft won. Return its number.
    const now = await getDoc(db, id);
    if (now.number !== null && now.status !== 'draft' && now.status !== 'cancelled') {
      return { id, number: now.number, alreadyFinal: true, status: now.status === 'final' ? 'final' : 'awaiting_allocation' };
    }
    throw mapError(err);
  }
}

async function finalizeDraft(ctx: Ctx, loaded: LoadedDraft, opts: { backdateReason?: string | null }): Promise<FinalizeOutcome> {
  const { db, actor, services } = ctx;
  const id = loaded.doc.id;
  const s = await stateFromDb(db, loaded);
  const backdate = await validateForFinalize(ctx, s, loaded.doc, opts.backdateReason ?? null);

  // Recompute from the current rates and freeze the reason, then read the draft again.
  s.backdateReason = backdate;
  await saveDraft(ctx, id, s, 'document.prepare_finalize');
  await run(db, "UPDATE documents SET issuance_date = ? WHERE id = ? AND status = 'draft'", services.today(), id);
  const fresh = await loadFull(db, id);
  const doc = fresh.doc;

  if (RECEIPT_TYPES.includes(doc.type)) await services.ceiling.check(doc.total_ils_minor ?? 0, doc.date);

  const source = s.sourceId ? await getDoc(db, s.sourceId) : null;
  const sourceBalance = source && s.sourceKind === 'payment' ? await demandBalance(db, source.id) : null;
  const carried = fresh.payments.some((p) => p.fx_source === 'carried');
  const client = doc.client_id ? await loadClient(db, doc.client_id) : null;
  const needsAlloc = await needsAllocation(
    db,
    { type: doc.type, date: doc.date, subtotalMinor: doc.subtotal_minor, vatAmountMinor: doc.vat_amount_minor, currency: assertCurrency(doc.currency), fxRate: doc.fx_rate },
    allocationClientOf(client),
  );
  const targetStatus: 'final' | 'awaiting_allocation' = needsAlloc ? 'awaiting_allocation' : 'final';

  try {
    const result = await finalizeDocument(db, id, {
      actor,
      status: targetStatus,
      extraStatements: (fc) => {
        const label = displayNumber(doc.type, fc.number);
        const out: D1PreparedStatement[] = [eventStatement(db, actor, id, 'finalized', { number: fc.number, label })];
        // R16 task 7 (payment_instructions) and R17 task 2 (payment_method_ids): a quote,
        // payment request, proforma or transaction invoice's payment note and method selection,
        // as finalized, become the client's own defaults, so the next one for them starts there.
        if (doc.client_id !== null && (s.type.kind === 'quote' || s.type.kind === 'demand')) {
          out.push(
            stmt(
              db,
              'UPDATE clients SET payment_instructions = ?, payment_method_ids = ?, updated_at = ? WHERE id = ?',
              doc.payment_instructions,
              doc.payment_method_ids,
              fc.finalizedAt,
              doc.client_id,
            ),
          );
        }
        if (source && s.sourceKind) {
          const amount = s.sourceKind === 'credit' ? -doc.total_minor : doc.total_minor;
          out.push(
            stmt(
              db,
              'INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, ?, ?, ?)',
              source.id,
              id,
              s.sourceKind,
              amount,
              doc.currency,
            ),
            eventStatement(db, actor, source.id, s.sourceKind === 'converted' ? 'converted' : s.sourceKind === 'payment' ? 'payment' : 'credited', {
              documentId: id,
              label,
              amountMinor: amount,
              currency: doc.currency,
            }),
          );
          if (sourceBalance && sourceBalance.remaining_minor - doc.total_minor === 0) {
            out.push(eventStatement(db, actor, source.id, 'paid', { by: label }));
          }
          if (carried) {
            out.push(
              stmt(
                db,
                "INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'carried_rate', NULL, NULL)",
                source.id,
                id,
              ),
            );
          }
        }
        if (s.revisesId) {
          const reason = `Replaced by ${label}`;
          out.push(
            stmt(
              db,
              "UPDATE documents SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'final'",
              fc.finalizedAt,
              reason,
              fc.finalizedAt,
              s.revisesId,
            ),
            eventStatement(db, actor, s.revisesId, 'revised', { documentId: id, label }),
            auditStatement(db, actor, 'document.cancel', 'document', s.revisesId, { reason }),
          );
        }
        if (backdate) {
          out.push(auditStatement(db, actor, 'document.backdate', 'document', id, { date: doc.date, reason: backdate }));
        }
        return out;
      },
    });
    if (targetStatus === 'awaiting_allocation') {
      // Opens R12's allocation request (docs/israel-invoices-api.md §7, step 3). A network or
      // config failure here (ITA not yet connected, for example) never fails the finalize call:
      // the document is already correctly numbered and awaiting_allocation, and R12's retry
      // queue (or a manual request from the ITA screen) picks it up from there.
      try {
        await services.allocation.request(id, actor);
      } catch {
        // Left for the retry queue or a manual request.
      }
    }
    return { id, number: result.number, alreadyFinal: false, status: targetStatus };
  } catch (err) {
    throw mapError(err);
  }
}

// ---------------------------------------------------------------------------
// Links: convert, record payment, revise
// ---------------------------------------------------------------------------

async function hasLiveTargets(db: D1Database, sourceId: number, kinds: string[]): Promise<boolean> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM document_links l JOIN documents t ON t.id = l.target_id
     WHERE l.source_id = ? AND t.status <> 'cancelled' AND l.kind IN (${kinds.map(() => '?').join(',')})`,
    sourceId,
    ...kinds,
  );
  return (row?.n ?? 0) > 0;
}

export async function convertDocument(
  ctx: Ctx,
  sourceId: number,
  input: { type: string; date?: string; payments?: PaymentInput[]; notes?: string | null; overrideRate?: string | null; latestRate?: boolean },
): Promise<number> {
  await assertIssuing(ctx.db);
  const { db } = ctx;
  const loaded = await loadFull(db, sourceId);
  const src = loaded.doc;
  assertCanSeeType(ctx.user, src.type);
  assertCanSeeType(ctx.user, input.type);
  if (src.status !== 'final') conflict('source_not_open', 'Create from a final, open document.');
  const rule = CONVERSIONS[src.type]?.find((r) => r.to === input.type);
  if (!rule) invalid(`A ${input.type} cannot be created from a ${src.type}.`);
  const type = await getType(db, input.type);
  if (type.enabled !== 1) conflict('type_disabled', `${type.name_en} is not available yet.`);
  const srcType = await getType(db, src.type);

  if (srcType.kind === 'quote' && (await hasLiveTargets(db, sourceId, ['converted']))) {
    conflict('source_converted', 'This quote is already converted.');
  }
  let remaining = src.total_minor;
  if (srcType.kind === 'demand') {
    const bal = await demandBalance(db, sourceId);
    if (!bal || bal.superseded) conflict('source_converted', 'This document is already converted.');
    remaining = bal.remaining_minor;
    if (rule.kind === 'converted' && bal.paid_minor > 0) {
      conflict('source_has_payments', 'This document already has payments. Record the rest as a receipt.');
    }
    if (rule.kind === 'payment' && remaining <= 0) conflict('source_paid', 'This document is already paid.');
  }

  const date = input.date ?? ctx.services.today();
  const payments: PaymentInput[] =
    input.payments ?? (type.kind === 'receipt' ? [{ method: 'bank_transfer', paidOn: date, amountMinor: remaining, chequeCrossed: false }] : []);
  const label = displayNumber(src.type, src.number);
  return insertDraft(
    ctx,
    {
      type,
      clientId: src.client_id,
      date,
      dueDate: type.kind === 'demand' ? src.due_date : null,
      currency: assertCurrency(src.currency),
      notes: input.notes !== undefined ? input.notes : src.notes,
      paymentInstructions: src.payment_instructions,
      paymentMethodIds: parseMethodIds(src.payment_method_ids),
      langVariant: src.lang_variant,
      lines: linesFromRows(loaded.lines),
      payments,
      showIls: type.kind === 'receipt' ? false : loaded.meta?.show_ils === 1,
      // A receipt-kind document takes only a rate typed for it, never the source's agreed rate
      // (that one reaches it through carryRate when the source asks for it).
      overrideRate: isReceiptKind(type) ? (input.overrideRate ?? null) : src.fx_source === 'agreed' ? src.fx_rate : null,
      overrideRateDate: isReceiptKind(type) ? null : src.fx_source === 'agreed' ? src.fx_rate_date : null,
      carryRate: type.kind !== 'receipt' && loaded.meta?.carry_rate === 1,
      latestRate: isReceiptKind(type) ? (input.latestRate ?? false) : false,
      sourceId,
      sourceKind: rule.kind,
      revisesId: null,
      backdateReason: null,
      creditReason: null,
    },
    { kind: 'created', details: { from: label } },
  );
}

/** Records a payment against a demand: creates the receipt and, by default, finalizes it in the same step. */
export async function recordPayment(
  ctx: Ctx,
  sourceId: number,
  input: { date?: string; payments: PaymentInput[]; notes?: string | null; finalize: boolean; backdateReason?: string | null; overrideRate?: string | null; latestRate?: boolean },
): Promise<{ receiptId: number; finalized: FinalizeOutcome | null }> {
  await assertIssuing(ctx.db);
  const src = await getDoc(ctx.db, sourceId);
  const srcType = await getType(ctx.db, src.type);
  if (srcType.kind !== 'demand' && srcType.kind !== 'invoice') {
    invalid('Record payments against a payment request, a transaction invoice or a tax invoice.');
  }
  // From the confirmed switch, a demand (300 or PR) records its payment as a חשבונית מס/קבלה
  // (320), not a plain receipt (docs/legal-requirements.md, מורשה default flow). The legal mode
  // of the payment's own date decides, the same rule compute() uses for VAT. A standalone tax
  // invoice (305) is already the invoice: its payment is a plain receipt (400), the series R11
  // keeps open through the switch precisely so this stays possible (runs/R11-murshe.md fix 1).
  const date = input.date ?? ctx.services.today();
  const mode = (await legalModeOn(ctx.db, date)).mode;
  const receiptType = srcType.kind === 'invoice' ? RECEIPT_TYPES[0]! : mode === 'murshe' ? '320' : RECEIPT_TYPES[0]!;
  const receiptId = await convertDocument(ctx, sourceId, {
    type: receiptType,
    date: input.date,
    payments: input.payments,
    overrideRate: input.overrideRate ?? null,
    latestRate: input.latestRate ?? false,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
  if (!input.finalize) return { receiptId, finalized: null };
  const finalized = await finalize(ctx, receiptId, { backdateReason: input.backdateReason });
  return { receiptId, finalized };
}

async function assertRevisable(db: D1Database, id: number): Promise<DocRow> {
  const doc = await getDoc(db, id);
  if (!REVISABLE_TYPES.includes(doc.type)) conflict('not_revisable', 'Only quotes and payment requests can be revised.');
  if (!(await quotesEditableUntilConverted(db))) conflict('not_revisable', 'Revising quotes and payment requests is off in settings.');
  if (doc.status !== 'final') conflict('not_revisable', 'Only a final, open document can be revised.');
  if (await hasLiveTargets(db, id, ['converted', 'payment', 'credit'])) {
    conflict('not_revisable', 'This document is already converted or paid.');
  }
  return doc;
}

/** Opens a new draft that replaces a final quote or payment request. Finalizing it cancels the original. */
export async function reviseDocument(ctx: Ctx, id: number): Promise<number> {
  const { db } = ctx;
  await assertIssuing(db);
  const loaded = await loadFull(db, id);
  assertCanSeeType(ctx.user, loaded.doc.type);
  await assertRevisable(db, id);
  const s = await stateFromDb(db, loaded);
  s.revisesId = id;
  s.date = ctx.services.today();
  s.backdateReason = null;
  return insertDraft(ctx, s, { kind: 'created', details: { revises: displayNumber(loaded.doc.type, loaded.doc.number) } });
}

/** Kinds a copy can be made of. A credit is made from the document it credits. */
const DUPLICABLE_KINDS = new Set(['quote', 'demand', 'invoice', 'receipt', 'invoice_receipt']);

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Opens a new draft that copies a document: type, client, lines and services, currency, rate
 * options, payment methods and instructions, notes and language. Only the dates change: the date
 * moves to `date` (today by default) and the due date keeps its distance from it. The number
 * comes on finalize, like any draft. Payments on a receipt are copied to the new date, and their
 * exchange rate is looked up again for that date. Used by Duplicate and by recurring documents.
 */
export async function duplicateDocument(ctx: Ctx, id: number, opts: { date?: string } = {}): Promise<number> {
  const { db } = ctx;
  await assertIssuing(db);
  const loaded = await loadFull(db, id);
  assertCanSeeType(ctx.user, loaded.doc.type);
  const s = await stateFromDb(db, loaded);
  if (!DUPLICABLE_KINDS.has(s.type.kind)) conflict('not_duplicable', 'A credit is made from the document it credits. It cannot be duplicated.');
  if (s.type.enabled !== 1) conflict('type_disabled', `${s.type.name_en} is not available in the current legal mode.`);
  const date = opts.date ?? ctx.services.today();
  const shift = daysFrom(s.date, date);
  s.dueDate = s.dueDate ? addDays(s.dueDate, shift) : null;
  s.date = date;
  s.payments = s.payments.map(({ preset: _preset, ...p }) => ({ ...p, paidOn: date }));
  s.sourceId = null;
  s.sourceKind = null;
  s.revisesId = null;
  s.backdateReason = null;
  s.creditReason = null;
  s.vatRateBpOverride = undefined;
  return insertDraft(ctx, s, { kind: 'created', details: { duplicateOf: displayNumber(loaded.doc.type, loaded.doc.number) } });
}

// ---------------------------------------------------------------------------
// Cancel, credit, sent
// ---------------------------------------------------------------------------

export async function cancelDocument(ctx: Ctx, id: number, reason: string): Promise<void> {
  const { db, actor } = ctx;
  await assertIssuing(db);
  const doc = await getDoc(db, id);
  assertCanSeeType(ctx.user, doc.type);
  if (doc.status === 'draft') conflict('not_final', 'Delete a draft instead of cancelling it.');
  if (doc.status !== 'final') conflict('not_final', 'Only a final document can be cancelled.');
  const sent = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM document_events WHERE document_id = ? AND kind = 'sent'", id);
  if ((sent?.n ?? 0) > 0) conflict('already_sent', 'This document was sent. Issue a credit instead.');
  if (await hasLiveTargets(db, id, ['converted', 'payment', 'credit'])) {
    conflict('has_dependents', 'Cancel the documents created from this one first.');
  }
  const at = nowIso();
  const meta = await first<MetaRow>(db, 'SELECT * FROM document_meta WHERE document_id = ?', id);
  await mapped(
    transaction(db, [
      stmt(
        db,
        "UPDATE documents SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'final'",
        at,
        reason,
        at,
        id,
      ),
      eventStatement(db, actor, id, 'cancelled', { reason }),
      ...(meta?.source_id
        ? [eventStatement(db, actor, meta.source_id, 'target_cancelled', { documentId: id, label: displayNumber(doc.type, doc.number) })]
        : []),
      auditStatement(db, actor, 'document.cancel', 'document', id, { reason }),
    ]),
  );
}

export async function creditDocument(
  ctx: Ctx,
  id: number,
  input: {
    mode: 'full' | 'partial';
    amountMinor?: number;
    date?: string;
    reason?: string | null;
    refundMethod?: PaymentInput['method'];
    finalize: boolean;
    backdateReason?: string | null;
  },
): Promise<{ creditId: number; finalized: FinalizeOutcome | null }> {
  await assertIssuing(ctx.db);
  const { db } = ctx;
  const loaded = await loadFull(db, id);
  const orig = loaded.doc;
  assertCanSeeType(ctx.user, orig.type);
  if (orig.status !== 'final') conflict('not_final', 'Only a final document can be credited.');
  const origType = await getType(db, orig.type);
  if (!origType.credit_type) conflict('not_creditable', `A ${origType.name_en.toLowerCase()} is not credited. Cancel it instead.`);
  const creditType = await getType(db, origType.credit_type);

  const prior = await first<{ amount: number | null; ils: number | null }>(
    db,
    `SELECT SUM(l.amount_minor) AS amount, SUM(t.total_ils_minor) AS ils
     FROM document_links l JOIN documents t ON t.id = l.target_id
     WHERE l.source_id = ? AND l.kind = 'credit' AND t.status <> 'cancelled'`,
    id,
  );
  const creditedAmount = prior?.amount ?? 0;
  const creditedIls = -(prior?.ils ?? 0);
  const creditable = orig.total_minor - creditedAmount;
  if (creditable <= 0) conflict('fully_credited', 'This document is already fully credited.');

  let amount: number;
  if (input.mode === 'full') amount = creditable;
  else {
    if (!input.amountMinor) invalid('Enter the amount to credit.');
    amount = input.amountMinor;
    if (amount > creditable) conflict('credit_exceeds_document', 'The credit is more than what is left to credit on this document.');
  }

  // Credit documents use the rate of the credited document (currency-and-fx.md).
  let ils: number;
  if (orig.currency === HOME_CURRENCY) ils = amount;
  else if (amount === creditable) ils = (orig.total_ils_minor ?? 0) - creditedIls;
  else if (orig.fx_rate) ils = convert(amount, orig.fx_rate);
  else ils = Number(divRound(BigInt(orig.total_ils_minor ?? 0) * BigInt(amount), BigInt(orig.total_minor)));

  const date = input.date ?? ctx.services.today();
  const label = displayNumber(orig.type, orig.number) ?? '';
  const method = input.refundMethod ?? loaded.payments[0]?.method ?? 'bank_transfer';
  const creditId = await insertDraft(
    ctx,
    {
      type: creditType,
      clientId: orig.client_id,
      date,
      dueDate: null,
      currency: assertCurrency(orig.currency),
      notes: input.reason ?? null,
      paymentInstructions: null,
      paymentMethodIds: [],
      langVariant: orig.lang_variant,
      lines: [
        {
          description: `Credit for ${origType.name_en} ${label}`,
          descriptionHe: `זיכוי ל${origType.name_he} ${orig.number}`,
          quantityMilli: 1000,
          unitPriceMinor: -amount,
          discountMinor: 0,
        },
      ],
      payments: [
        {
          method,
          paidOn: date,
          reference: `Credit for ${label}`,
          amountMinor: -amount,
          chequeCrossed: false,
          preset: {
            fxRate: orig.currency === HOME_CURRENCY ? null : orig.fx_rate,
            fxRateDate: orig.currency === HOME_CURRENCY ? null : orig.fx_rate_date,
            fxSource: orig.currency === HOME_CURRENCY ? null : 'credited',
            amountIls: -ils,
          },
        },
      ],
      showIls: false,
      overrideRate: null,
      overrideRateDate: null,
      carryRate: false,
      latestRate: false,
      sourceId: id,
      sourceKind: 'credit',
      revisesId: null,
      backdateReason: null,
      creditReason: input.reason ?? null,
      // Always the credited document's own rate (docs/currency-and-fx.md, "Credit documents"),
      // never today's: null for a document that carried no VAT.
      vatRateBpOverride: orig.vat_rate_bp,
    },
    { kind: 'created', details: { credits: label, mode: input.mode } },
  );
  if (!input.finalize) return { creditId, finalized: null };
  return { creditId, finalized: await finalize(ctx, creditId, { backdateReason: input.backdateReason }) };
}

/** Records that a final document went out. R06 calls this after a send. A sent document can no longer be cancelled. */
export async function markSent(ctx: Ctx, id: number, input: { channel: string; to?: string | null }): Promise<void> {
  const { db, actor } = ctx;
  const doc = await getDoc(db, id);
  assertCanSeeType(ctx.user, doc.type);
  if (doc.status !== 'final') conflict('not_final', 'Finalize the document before you send it.');
  await mapped(
    transaction(db, [
      eventStatement(db, actor, id, 'sent', { channel: input.channel, to: input.to ?? null }),
      auditStatement(db, actor, 'document.sent', 'document', id, { channel: input.channel }),
    ]),
  );
}

// ---------------------------------------------------------------------------
// עוסק מורשה switch support
// ---------------------------------------------------------------------------

export interface OpenPaymentRequestSummary {
  id: number;
  displayNumber: string | null;
  clientId: number | null;
  clientNameEn: string | null;
  clientNameHe: string | null;
  date: string;
  currency: string;
  totalMinor: number;
}

/**
 * Open, untouched payment requests at the moment of the switch (docs/legal-requirements.md,
 * "Switch from פטור to מורשה", point 4). CLAUDE.md rule 1: a final document never changes, so the
 * switch itself never edits or reprices one of these. It only lists them, so the owner can act on
 * each one from its own document screen: reissue it (revise, which cancels this one and opens a
 * new version dated in מורשה, priced with VAT the same rule any new document gets), or leave it
 * and credit or cancel whatever of it still applies once it is paid or otherwise resolved. A PR
 * that already has a payment, conversion or credit against it is not "open" in this sense and is
 * left out: the owner is already handling it document by document.
 */
export async function listOpenFinalPaymentRequests(db: D1Database): Promise<OpenPaymentRequestSummary[]> {
  const rows = await all<{
    id: number;
    number: number | null;
    client_id: number | null;
    client_name_en: string | null;
    client_name_he: string | null;
    date: string;
    currency: string;
    total_minor: number;
  }>(
    db,
    `SELECT d.id, d.number, d.client_id, c.name_en AS client_name_en, c.name_he AS client_name_he, d.date, d.currency, d.total_minor
     FROM documents d LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.type = 'PR' AND d.status = 'final' ORDER BY d.date, d.id`,
  );
  const out: OpenPaymentRequestSummary[] = [];
  for (const r of rows) {
    if (await hasLiveTargets(db, r.id, ['converted', 'payment', 'credit'])) continue;
    out.push({
      id: r.id,
      displayNumber: displayNumber('PR', r.number),
      clientId: r.client_id,
      clientNameEn: r.client_name_en,
      clientNameHe: r.client_name_he,
      date: r.date,
      currency: r.currency,
      totalMinor: r.total_minor,
    });
  }
  return out;
}

/**
 * Re-saves every open draft (any type, not only payment requests) when the owner ticks the
 * "reprice drafts" option at the switch. A draft is never frozen, so this is not a rule-1
 * concern: saveDraft() just recomputes it, the same compute() call any edit already triggers, so
 * its stored total picks up VAT (or stays 0% for a foreign-resident client, compute()'s own rule)
 * from the new legal mode immediately instead of waiting for the owner to next open it.
 *
 * compute() prices a document by the legal mode in force on its own date (mode of `date`, not
 * "now"), so a draft dated before the switch's effective date would still price at 0% even after
 * a re-save: correct for that date, but not what "reprice this draft for עוסק מורשה" means to the
 * owner ticking the option. So a draft dated before `effectiveDate` is brought forward to it,
 * same as a brand-new draft created after the switch would be dated; a draft already dated on or
 * after `effectiveDate` keeps its own date.
 */
export async function repriceOpenDraftsForSwitch(ctx: Ctx, effectiveDate: string, actor: AuditActor): Promise<number[]> {
  const { db } = ctx;
  const drafts = await all<{ id: number }>(db, "SELECT id FROM documents WHERE status = 'draft' ORDER BY id");
  const repriced: number[] = [];
  for (const row of drafts) {
    try {
      const loaded = await loadFull(db, row.id);
      const s = await stateFromDb(db, loaded);
      if (s.date < effectiveDate) s.date = effectiveDate;
      await saveDraft({ ...ctx, actor }, row.id, s, 'document.reprice_draft');
      repriced.push(row.id);
    } catch {
      // Left as it was. The owner re-saves it by hand from the document screen.
    }
  }
  return repriced;
}

export { assertCanSeeType };
