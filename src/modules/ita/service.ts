import { type AuditActor, auditStatement } from '../../core/audit';
import { first, stmt, transaction } from '../../core/db';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../core/errors';
import { ItaClient } from './client';
import {
  type ItaEnv,
  type ItaEnvironment,
  type ItaPath,
  ITA_PATHS,
  ITA_SERVICE_PAGE_URL,
  itaIdentity,
} from './config';
import { ALLOCATION_STATUSES, type AllocationDocumentStore, D1AllocationDocuments } from './documents';
import { ItaReconnectError, ItaUnavailableError } from './errors';
import { type Notifier, slackNotifier } from './notify';
import { type AllocationDocument, buildApprovalBody, buildDecisionBody, buildMultiApprovalBody } from './payload';
import {
  type ApprovalOutcome,
  type ItaFix,
  approvalOutcome,
  decisionOutcome,
  multiApprovalOutcome,
  shortAllocationNumber,
} from './responses';
import { type ClockAndFetch, ItaTokenStore } from './tokens';

/**
 * AllocationService: gets the ITA allocation number for a numbered tax invoice
 * (docs/israel-invoices-api.md §5 to §8). R11 calls `request` right after the finalize
 * transaction writes the document in status `awaiting_allocation`.
 */

export type RefusalChoice = 'cancel' | 'continue' | 'reverse_charge' | 'further_objection';
export const REFUSAL_CHOICES: readonly RefusalChoice[] = ['cancel', 'continue', 'reverse_charge', 'further_objection'];

export type AllocationRowStatus = 'pending' | 'stalled' | 'failed' | 'refused' | 'decided' | 'approved';

export interface AllocationRow {
  id: number;
  document_id: number;
  invoice_id: string;
  environment: ItaEnvironment;
  status: AllocationRowStatus;
  attempts: number;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  deadline_at: string | null;
  alerted_at: string | null;
  last_http_status: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  confirmation_number: string | null;
  short_number: string | null;
  source: string | null;
  source_note: string | null;
  decision: RefusalChoice | null;
  decision_at: string | null;
  replacement_document_id: number | null;
}

export interface AllocationResult {
  document_id: number;
  status: AllocationRowStatus;
  outcome: ApprovalOutcome['kind'] | 'decision_sent' | 'manual' | 'unchanged';
  confirmation_number: string | null;
  short_number: string | null;
  error_code: string | null;
  message: string;
  fix: ItaFix | null;
  decision: RefusalChoice | null;
  replacement_document_id: number | null;
  hearing_url: string | null;
}

export interface AllocationService {
  request(documentId: number, actor: AuditActor): Promise<AllocationResult>;
  requestMany(documentIds: number[], actor: AuditActor): Promise<AllocationResult[]>;
  decide(documentId: number, choice: RefusalChoice, actor: AuditActor): Promise<AllocationResult>;
  enterManual(documentId: number, confirmationNumber: string, note: string, actor: AuditActor): Promise<AllocationResult>;
}

/** Outside services and the clock. Tests swap every one of them. */
export interface ItaDeps extends ClockAndFetch {
  notifier: (env: ItaEnv) => Notifier;
  documents: (env: ItaEnv) => AllocationDocumentStore;
}

export function defaultDeps(): ItaDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    notifier: (env) => slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init)),
    documents: (env) => new D1AllocationDocuments(env.DB),
  };
}

/** Retry cadence for ITA outages. Operational settings, not tax rules. */
export const RETRY_INTERVAL_MS = 15 * 60_000;
export const RETRY_WINDOW_MS = 24 * 60 * 60_000;

const OK_MESSAGES: Record<string, string> = {
  approved: 'The ITA granted an allocation number.',
  manual: 'The allocation number from the ITA web app is saved.',
  pending: 'The ITA is not answering. Open Ledger IL retries every 15 minutes for 24 hours.',
  unauthorized: 'Reconnect to ITA. Open Ledger IL retries every 15 minutes after that.',
};

interface Prepared {
  doc: AllocationDocument;
  row: AllocationRow;
  body: Record<string, unknown>;
  source: 'api' | 'after_hearing';
}

export class ItaAllocationService implements AllocationService {
  readonly tokens: ItaTokenStore;
  readonly client: ItaClient;
  readonly docs: AllocationDocumentStore;

  constructor(
    private readonly env: ItaEnv,
    private readonly deps: ItaDeps,
  ) {
    this.tokens = new ItaTokenStore(env, deps);
    this.client = new ItaClient(env, this.tokens, deps);
    this.docs = deps.documents(env);
  }

  private get db() {
    return this.env.DB;
  }

  private now(): string {
    return this.deps.now().toISOString();
  }

  private later(ms: number): string {
    return new Date(this.deps.now().getTime() + ms).toISOString();
  }

  row(documentId: number): Promise<AllocationRow | null> {
    return first<AllocationRow>(this.db, 'SELECT * FROM ita_allocations WHERE document_id = ?', documentId);
  }

  private async rowById(id: number): Promise<AllocationRow> {
    const row = await first<AllocationRow>(this.db, 'SELECT * FROM ita_allocations WHERE id = ?', id);
    if (!row) throw new NotFoundError('Allocation', id);
    return row;
  }

  private checkEnvironment(row: AllocationRow): void {
    if (row.environment !== this.tokens.environment) {
      throw new ConflictError(
        'ita_environment_mismatch',
        `This request started in the ITA ${row.environment} environment. Enter the number by hand or switch ITA_ENV back.`,
      );
    }
  }

  /** Creates the allocation row once per document. A 332 conversion reuses the 332's invoice_id. */
  private async ensureRow(doc: AllocationDocument): Promise<AllocationRow> {
    const existing = await this.row(doc.id);
    if (existing) {
      this.checkEnvironment(existing);
      return existing;
    }
    let invoiceId: string = crypto.randomUUID();
    if (doc.proformaDocumentId !== null) {
      const proforma = await this.row(doc.proformaDocumentId);
      if (proforma?.status === 'approved') invoiceId = proforma.invoice_id;
    }
    await stmt(
      this.db,
      `INSERT INTO ita_allocations (document_id, invoice_id, environment, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?) ON CONFLICT (document_id) DO NOTHING`,
      doc.id,
      invoiceId,
      this.tokens.environment,
      this.now(),
      this.now(),
    ).run();
    const row = await this.row(doc.id);
    if (!row) throw new NotFoundError('Allocation for document', doc.id);
    return row;
  }

  private attemptStatement(rowId: number, endpoint: ItaPath, httpStatus: number | null, outcome: string, code: string | null, message: string) {
    return stmt(
      this.db,
      `INSERT INTO ita_allocation_attempts (allocation_id, at, endpoint, http_status, outcome, error_code, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      rowId,
      this.now(),
      endpoint,
      httpStatus,
      outcome,
      code,
      message.slice(0, 300),
    );
  }

  private async isProformaConversion(doc: AllocationDocument, row: AllocationRow): Promise<boolean> {
    if (doc.proformaDocumentId === null) return false;
    const proforma = await this.row(doc.proformaDocumentId);
    return proforma?.invoice_id === row.invoice_id;
  }

  /** Checks one document and builds its Approval body. */
  private async prepare(documentId: number): Promise<Prepared | AllocationResult> {
    const doc = await this.docs.get(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    const existing = await this.row(documentId);
    if (existing?.status === 'approved') {
      // Idempotent: the number is already granted. Bring the document in line if a step was missed.
      if ((ALLOCATION_STATUSES as readonly string[]).includes(doc.status)) {
        await this.docs.setStatus(doc.id, 'final', existing.confirmation_number);
      }
      return this.result(existing, 'unchanged', OK_MESSAGES.approved!);
    }
    if (!(ALLOCATION_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictError('not_awaiting_allocation', 'This document is not waiting for an allocation number.');
    }
    if (existing?.status === 'refused') {
      throw new ConflictError('choice_required', 'The ITA refused this invoice. Pick one of the four choices first.');
    }
    if (existing?.status === 'decided' && existing.decision !== 'further_objection') {
      throw new ConflictError('decision_sent', 'A decision was already sent to the ITA for this invoice.');
    }
    const row = await this.ensureRow(doc);
    const action = (await this.isProformaConversion(doc, row)) ? 4 : undefined;
    const body = buildApprovalBody(doc, itaIdentity(this.env), { invoiceId: row.invoice_id, action });
    return { doc, row, body, source: row.decision === 'further_objection' ? 'after_hearing' : 'api' };
  }

  async request(documentId: number, actor: AuditActor): Promise<AllocationResult> {
    const prepared = await this.prepare(documentId);
    if (!('body' in prepared)) return prepared;
    const outcome = approvalOutcome(await this.client.post(ITA_PATHS.approval, prepared.body));
    return this.apply(prepared, outcome, prepared.source, ITA_PATHS.approval, actor);
  }

  /** One MultiApproval call for many documents. Used by the retry queue. */
  async requestMany(documentIds: number[], actor: AuditActor): Promise<AllocationResult[]> {
    const ready: Prepared[] = [];
    const results: AllocationResult[] = [];
    const seen = new Set<string>();
    for (const id of documentIds) {
      try {
        const p = await this.prepare(id);
        if (!('body' in p)) {
          results.push(p);
        } else if (p.body.action !== undefined || seen.has(p.row.invoice_id)) {
          results.push(await this.request(id, actor));
        } else {
          seen.add(p.row.invoice_id);
          ready.push(p);
        }
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
      }
    }
    if (ready.length === 1) {
      const p = ready[0]!;
      const outcome = approvalOutcome(await this.client.post(ITA_PATHS.approval, p.body));
      results.push(await this.apply(p, outcome, p.source, ITA_PATHS.approval, actor));
      return results;
    }
    if (ready.length === 0) return results;
    const body = buildMultiApprovalBody(
      ready.map((p) => p.body),
      itaIdentity(this.env),
      ready.map((p) => p.doc),
    );
    const multi = multiApprovalOutcome(await this.client.post(ITA_PATHS.multiApproval, body));
    for (const p of ready) {
      const outcome: ApprovalOutcome = multi.mainError ??
        multi.byInvoiceId.get(p.row.invoice_id) ?? { kind: 'unavailable', httpStatus: null, message: 'The ITA did not answer for this invoice.' };
      results.push(await this.apply(p, outcome, p.source === 'api' ? 'multi_api' : p.source, ITA_PATHS.multiApproval, actor));
    }
    return results;
  }

  private async apply(
    p: Prepared,
    outcome: ApprovalOutcome,
    source: string,
    endpoint: ItaPath,
    actor: AuditActor,
  ): Promise<AllocationResult> {
    const { doc, row } = p;
    const now = this.now();
    const httpStatus = 'httpStatus' in outcome ? outcome.httpStatus : null;
    const code = 'code' in outcome ? outcome.code : outcome.kind === 'unauthorized' ? 'http_401' : null;
    const message =
      outcome.kind === 'approved' ? OK_MESSAGES.approved! : outcome.kind === 'unavailable' ? OK_MESSAGES.pending! : outcome.kind === 'unauthorized' ? OK_MESSAGES.unauthorized! : outcome.message;
    const log = this.attemptStatement(row.id, endpoint, httpStatus, outcome.kind, code, outcome.kind === 'unavailable' ? outcome.message : message);
    const audit = (action: string, details: Record<string, unknown>) =>
      auditStatement(this.db, actor, action, 'document', doc.id, { invoice_id: row.invoice_id, ...details });

    switch (outcome.kind) {
      case 'approved': {
        await transaction(this.db, [
          stmt(
            this.db,
            `UPDATE ita_allocations SET status = 'approved', confirmation_number = ?, short_number = ?, source = ?,
               attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?), last_attempt_at = ?,
               next_attempt_at = NULL, last_http_status = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
             WHERE id = ?`,
            outcome.confirmationNumber,
            outcome.shortNumber,
            source,
            now,
            now,
            httpStatus,
            now,
            row.id,
          ),
          log,
          audit('ita.allocation.approved', { short_number: outcome.shortNumber, source }),
        ]);
        await this.docs.setStatus(doc.id, 'final', outcome.confirmationNumber);
        break;
      }
      case 'refused':
      case 'already_decided': {
        const status = outcome.kind === 'refused' ? 'refused' : 'decided';
        await transaction(this.db, [
          stmt(
            this.db,
            `UPDATE ita_allocations SET status = ?, attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?),
               last_attempt_at = ?, next_attempt_at = NULL, last_http_status = ?, last_error_code = ?, last_error_message = ?,
               updated_at = ? WHERE id = ?`,
            status,
            now,
            now,
            httpStatus,
            outcome.code,
            outcome.message,
            now,
            row.id,
          ),
          log,
          audit(`ita.allocation.${outcome.kind}`, { code: outcome.code }),
        ]);
        if (doc.status !== 'allocation_refused') await this.docs.setStatus(doc.id, 'allocation_refused');
        break;
      }
      case 'invalid': {
        await transaction(this.db, [
          stmt(
            this.db,
            `UPDATE ita_allocations SET status = 'failed', attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?),
               last_attempt_at = ?, next_attempt_at = NULL, last_http_status = ?, last_error_code = ?, last_error_message = ?,
               updated_at = ? WHERE id = ?`,
            now,
            now,
            httpStatus,
            outcome.code,
            outcome.message,
            now,
            row.id,
          ),
          log,
          audit('ita.allocation.rejected', { code: outcome.code, fix: outcome.fix }),
        ]);
        break;
      }
      case 'unauthorized':
      case 'unavailable': {
        await transaction(this.db, [
          stmt(
            this.db,
            `UPDATE ita_allocations SET status = 'pending', attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?),
               deadline_at = COALESCE(deadline_at, ?), last_attempt_at = ?, next_attempt_at = ?, last_http_status = ?,
               last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ?`,
            now,
            this.later(RETRY_WINDOW_MS),
            now,
            this.later(RETRY_INTERVAL_MS),
            httpStatus,
            code,
            outcome.message,
            now,
            row.id,
          ),
          log,
          audit('ita.allocation.queued', { reason: outcome.kind }),
        ]);
        if (doc.status === 'awaiting_allocation') await this.docs.setStatus(doc.id, 'allocation_pending');
        break;
      }
    }
    const fresh = await this.rowById(row.id);
    return this.result(fresh, outcome.kind, message, outcome.kind === 'invalid' ? outcome.fix : null);
  }

  result(row: AllocationRow, outcome: AllocationResult['outcome'], message: string, fix: ItaFix | null = null): AllocationResult {
    return {
      document_id: row.document_id,
      status: row.status,
      outcome,
      confirmation_number: row.confirmation_number,
      short_number: row.short_number,
      error_code: row.status === 'approved' ? null : row.last_error_code,
      message,
      fix,
      decision: row.decision,
      replacement_document_id: row.replacement_document_id,
      hearing_url: row.decision === 'further_objection' ? ITA_SERVICE_PAGE_URL : null,
    };
  }

  /** One of the four choices after a refusal (spec §2.2.2 and §4). */
  async decide(documentId: number, choice: RefusalChoice, actor: AuditActor): Promise<AllocationResult> {
    if (!REFUSAL_CHOICES.includes(choice)) throw new ValidationError('Pick one of the four choices.');
    const row = await this.row(documentId);
    if (!row) throw new NotFoundError('Allocation for document', documentId);
    this.checkEnvironment(row);
    const afterHearing = row.status === 'decided' && row.decision === 'further_objection' && choice !== 'further_objection';
    if (row.status !== 'refused' && !afterHearing) {
      throw new ConflictError('no_refusal', 'This invoice has no refusal waiting for a choice.');
    }
    const doc = await this.docs.get(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (choice === 'reverse_charge') return this.reverseCharge(row, doc, actor);

    const path =
      choice === 'cancel' ? ITA_PATHS.decisionCancel : choice === 'continue' ? ITA_PATHS.decisionContinue : ITA_PATHS.decisionFurtherObjection;
    const out = decisionOutcome(await this.client.post(path, buildDecisionBody(row.invoice_id, itaIdentity(this.env))));
    const now = this.now();
    const failMessage = out.kind === 'accepted' ? '' : out.message;
    if (out.kind !== 'accepted') {
      await transaction(this.db, [
        this.attemptStatement(row.id, path, null, `decision_${out.kind}`, out.kind === 'rejected' ? out.code : null, failMessage),
      ]);
      if (out.kind === 'unauthorized') throw new ItaReconnectError(out.message);
      if (out.kind === 'unavailable') throw new ItaUnavailableError(out.message);
      throw new ConflictError('ita_decision_rejected', out.message);
    }
    await transaction(this.db, [
      stmt(
        this.db,
        `UPDATE ita_allocations SET status = 'decided', decision = ?, decision_at = ?, decision_by = ?, updated_at = ? WHERE id = ?`,
        choice,
        now,
        actor.userId,
        now,
        row.id,
      ),
      this.attemptStatement(row.id, path, 200, 'decision_sent', null, choice),
      auditStatement(this.db, actor, 'ita.allocation.decision', 'document', documentId, { invoice_id: row.invoice_id, choice }),
    ]);
    if (choice === 'cancel') {
      await this.docs.cancel(documentId, 'The ITA refused the allocation number. Cancelled by the owner.', actor);
    } else if (choice === 'continue') {
      await this.docs.setStatus(documentId, 'final', null);
    }
    const messages: Record<string, string> = {
      cancel: 'The invoice is cancelled and the ITA knows.',
      continue: 'The invoice is issued without a number. It prints the no input VAT note.',
      further_objection: 'The hearing request is sent. Follow it in the ITA portal, then request the number again.',
    };
    return this.result(await this.rowById(row.id), 'decision_sent', messages[choice]!);
  }

  /** Choice 3: zero-VAT copy, Approval with action 3 and the original invoice_id, then cancel the original. */
  private async reverseCharge(row: AllocationRow, doc: AllocationDocument, actor: AuditActor): Promise<AllocationResult> {
    if (doc.type === '332') throw new ValidationError('A 332 advance approval has no reverse charge option.');
    let replacementId = row.replacement_document_id;
    if (replacementId === null) {
      replacementId = await this.docs.createReverseChargeReplacement(doc.id, actor);
      await stmt(
        this.db,
        'UPDATE ita_allocations SET replacement_document_id = ?, updated_at = ? WHERE id = ?',
        replacementId,
        this.now(),
        row.id,
      ).run();
    }
    const replacement = await this.docs.get(replacementId);
    if (!replacement) throw new NotFoundError('Document', replacementId);
    if (replacement.vatAmountMinor !== 0) throw new ValidationError('A reverse-charge invoice has zero VAT.');

    const body = buildApprovalBody(replacement, itaIdentity(this.env), { invoiceId: row.invoice_id, action: 3 });
    const outcome = approvalOutcome(await this.client.post(ITA_PATHS.approval, body));
    const now = this.now();
    if (outcome.kind !== 'approved') {
      const code = 'code' in outcome ? outcome.code : null;
      await transaction(this.db, [this.attemptStatement(row.id, ITA_PATHS.approval, 'httpStatus' in outcome ? outcome.httpStatus : null, `reverse_charge_${outcome.kind}`, code, outcome.message)]);
      if (outcome.kind === 'unauthorized') throw new ItaReconnectError(outcome.message);
      if (outcome.kind === 'unavailable') throw new ItaUnavailableError(outcome.message);
      throw new ConflictError('ita_reverse_charge_rejected', outcome.message);
    }
    await transaction(this.db, [
      stmt(
        this.db,
        `UPDATE ita_allocations SET status = 'approved', decision = 'reverse_charge', decision_at = ?, decision_by = ?,
           confirmation_number = ?, short_number = ?, source = 'reverse_charge', last_error_code = NULL,
           last_error_message = NULL, last_attempt_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        now,
        actor.userId,
        outcome.confirmationNumber,
        outcome.shortNumber,
        now,
        now,
        row.id,
      ),
      this.attemptStatement(row.id, ITA_PATHS.approval, outcome.httpStatus, 'reverse_charge_approved', null, OK_MESSAGES.approved!),
      auditStatement(this.db, actor, 'ita.allocation.decision', 'document', doc.id, {
        invoice_id: row.invoice_id,
        choice: 'reverse_charge',
        replacement_document_id: replacementId,
        short_number: outcome.shortNumber,
      }),
    ]);
    await this.docs.setStatus(replacementId, 'final', outcome.confirmationNumber);
    await this.docs.cancel(doc.id, 'Replaced by a reverse-charge invoice after the ITA refused the allocation number.', actor);
    return this.result(
      await this.rowById(row.id),
      'decision_sent',
      'The zero-VAT invoice has its number. The client reports it as a self invoice. The original is cancelled.',
    );
  }

  /** A number requested by hand in the ITA web app (docs/israel-invoices-api.md §8). */
  async enterManual(documentId: number, confirmationNumber: string, note: string, actor: AuditActor): Promise<AllocationResult> {
    const number = confirmationNumber.replace(/[\s-]/g, '');
    if (!/^\d{9,30}$/.test(number)) throw new ValidationError('An allocation number has 9 to 30 digits.');
    const doc = await this.docs.get(documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    if (!(ALLOCATION_STATUSES as readonly string[]).includes(doc.status)) {
      throw new ConflictError('not_awaiting_allocation', 'This document is not waiting for an allocation number.');
    }
    const row = await this.ensureRow(doc);
    if (row.status === 'approved') throw new ConflictError('already_allocated', 'This invoice already has an allocation number.');
    if (row.status === 'refused' || row.status === 'decided') {
      throw new ConflictError('choice_required', 'The ITA refused this invoice. Use one of the four choices.');
    }
    const now = this.now();
    const short = shortAllocationNumber(number);
    await transaction(this.db, [
      stmt(
        this.db,
        `UPDATE ita_allocations SET status = 'approved', confirmation_number = ?, short_number = ?, source = 'manual_web_app',
           source_note = ?, entered_by = ?, next_attempt_at = NULL, last_error_code = NULL, last_error_message = NULL,
           updated_at = ? WHERE id = ?`,
        number,
        short,
        note.trim().slice(0, 500) || null,
        actor.userId,
        now,
        row.id,
      ),
      auditStatement(this.db, actor, 'ita.allocation.manual', 'document', documentId, {
        invoice_id: row.invoice_id,
        short_number: short,
        source: 'manual_web_app',
      }),
    ]);
    await this.docs.setStatus(documentId, 'final', number);
    return this.result(await this.rowById(row.id), 'manual', OK_MESSAGES.manual!);
  }
}

export function createAllocationService(env: ItaEnv, deps: ItaDeps = defaultDeps()): ItaAllocationService {
  return new ItaAllocationService(env, deps);
}
