import { type AuditActor, auditAs } from '../../core/audit';
import { all, first, run } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import { issuingEnabled } from '../../core/issuing';
import { type Ctx, deleteDraft, duplicateDocument, finalize, updateDraft } from '../documents/service';
import { addDays } from '../fx/rates';

/**
 * Recurring documents. A schedule points at a template document and a frequency. On each run
 * date the daily cron copies the template (documents/service.ts duplicateDocument: same client,
 * lines, currency, rate options, payment methods and notes, new date, number on finalize).
 *
 * Mode `approve` stops at a draft and waits on the Recurring page for Approve or Skip.
 * Mode `auto` finalizes the copy and, with `send_email`, emails it to the client.
 *
 * Only documents that ask for money repeat: payment requests, pro formas and tax invoices. A
 * receipt records money received, so it never repeats on its own.
 */

export const RECURRING_KINDS = ['demand', 'invoice'] as const;
export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export type RecurringMode = 'approve' | 'auto';

export interface ScheduleRow {
  id: number;
  name: string | null;
  template_document_id: number;
  frequency: Frequency;
  anchor_day: number;
  next_run_date: string;
  end_date: string | null;
  mode: RecurringMode;
  send_email: number;
  active: number;
  last_run_at: string | null;
  /** Each copy is due this many days after it is issued. Null: the template's own gap. */
  due_days: number | null;
}

export interface ScheduleView extends ScheduleRow {
  template_type: string;
  template_number: number | null;
  template_type_name_en: string;
  template_type_name_he: string | null;
  client_id: number | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string;
  total_minor: number;
}

export interface RunView {
  id: number;
  schedule_id: number;
  schedule_name: string | null;
  run_date: string;
  document_id: number | null;
  document_type: string | null;
  document_number: number | null;
  document_status: string | null;
  client_name_en: string | null;
  client_name_he: string | null;
  currency: string | null;
  total_minor: number | null;
  status: 'pending_approval' | 'issued' | 'sent' | 'skipped' | 'failed';
  error: string | null;
  send_email: number;
}

/** Emails a final document to its client. Throws when it cannot (no consent, no email, no mail key). */
export type SendFn = (documentId: number, actor: { userId: number | null; email: string | null }) => Promise<void>;

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The run date after `date`. Monthly, quarterly and yearly runs keep the schedule's day of the
 * month, and fall on the month's last day when it is shorter (31 Jan, 28 Feb, 31 Mar).
 */
export function nextRunDate(date: string, frequency: Frequency, anchorDay: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (frequency === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const total = y * 12 + (m - 1) + step;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(anchorDay, daysInMonth(ny, nm)))}`;
}

async function templateOf(db: D1Database, documentId: number) {
  const doc = await first<{ id: number; status: string; kind: string; name_en: string }>(
    db,
    `SELECT d.id, d.status, dt.kind, dt.name_en FROM documents d JOIN document_types dt ON dt.code = d.type WHERE d.id = ?`,
    documentId,
  );
  if (!doc) throw new NotFoundError('Document', documentId);
  if (!(RECURRING_KINDS as readonly string[]).includes(doc.kind)) {
    throw new ValidationError('Only payment requests, pro formas and tax invoices can repeat.');
  }
  if (doc.status === 'cancelled') throw new ValidationError('A cancelled document cannot be a template.');
  return doc;
}

export interface CreateScheduleInput {
  templateDocumentId: number;
  name?: string | null;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  mode: RecurringMode;
  sendEmail: boolean;
  dueDays?: number | null;
}

export async function createSchedule(ctx: Ctx, input: CreateScheduleInput): Promise<number> {
  const { db, actor } = ctx;
  await templateOf(db, input.templateDocumentId);
  const today = ctx.services.today();
  if (input.startDate < today) throw new ValidationError('The first run date cannot be in the past.');
  if (input.endDate && input.endDate < input.startDate) throw new ValidationError('The end date is before the first run date.');
  const { lastRowId } = await run(
    db,
    `INSERT INTO recurring_schedules (name, template_document_id, frequency, anchor_day, next_run_date, end_date, mode, send_email, due_days, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.name?.trim() || null,
    input.templateDocumentId,
    input.frequency,
    Number(input.startDate.slice(8, 10)),
    input.startDate,
    input.endDate ?? null,
    input.mode,
    input.sendEmail ? 1 : 0,
    input.dueDays ?? null,
    actor.userId,
  );
  await auditAs(db, actor, 'recurring.create', 'recurring_schedule', lastRowId, input);
  return lastRowId;
}

export interface UpdateScheduleInput {
  name?: string | null;
  frequency?: Frequency;
  nextRunDate?: string;
  endDate?: string | null;
  mode?: RecurringMode;
  sendEmail?: boolean;
  active?: boolean;
  dueDays?: number | null;
}

export async function updateSchedule(ctx: Ctx, id: number, patch: UpdateScheduleInput): Promise<void> {
  const { db, actor } = ctx;
  const before = await first<ScheduleRow>(db, 'SELECT * FROM recurring_schedules WHERE id = ?', id);
  if (!before) throw new NotFoundError('Recurring schedule', id);
  if (patch.nextRunDate && patch.nextRunDate < ctx.services.today()) throw new ValidationError('The next run date cannot be in the past.');
  const next = patch.nextRunDate ?? before.next_run_date;
  const end = patch.endDate !== undefined ? patch.endDate : before.end_date;
  if (end && end < next) throw new ValidationError('The end date is before the next run date.');
  await run(
    db,
    `UPDATE recurring_schedules SET name = ?, frequency = ?, anchor_day = ?, next_run_date = ?, end_date = ?, mode = ?, send_email = ?, active = ?,
       due_days = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    patch.name !== undefined ? patch.name?.trim() || null : before.name,
    patch.frequency ?? before.frequency,
    patch.nextRunDate ? Number(patch.nextRunDate.slice(8, 10)) : before.anchor_day,
    next,
    end,
    patch.mode ?? before.mode,
    patch.sendEmail !== undefined ? (patch.sendEmail ? 1 : 0) : before.send_email,
    patch.active !== undefined ? (patch.active ? 1 : 0) : before.active,
    patch.dueDays !== undefined ? patch.dueDays : before.due_days,
    id,
  );
  await auditAs(db, actor, 'recurring.update', 'recurring_schedule', id, patch);
}

export async function listSchedules(db: D1Database): Promise<ScheduleView[]> {
  return all<ScheduleView>(
    db,
    `SELECT s.*, d.type AS template_type, d.number AS template_number, dt.name_en AS template_type_name_en, dt.name_he AS template_type_name_he,
       d.client_id, c.name_en AS client_name_en, c.name_he AS client_name_he, d.currency, d.total_minor
     FROM recurring_schedules s
     JOIN documents d ON d.id = s.template_document_id
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN clients c ON c.id = d.client_id
     ORDER BY s.active DESC, s.next_run_date, s.id`,
  );
}

export async function listRuns(db: D1Database, limit = 50): Promise<RunView[]> {
  return all<RunView>(
    db,
    `SELECT r.id, r.schedule_id, s.name AS schedule_name, r.run_date, r.document_id, d.type AS document_type, d.number AS document_number,
       d.status AS document_status, c.name_en AS client_name_en, c.name_he AS client_name_he, d.currency, d.total_minor, r.status, r.error,
       s.send_email
     FROM recurring_runs r
     JOIN recurring_schedules s ON s.id = r.schedule_id
     LEFT JOIN documents d ON d.id = r.document_id
     LEFT JOIN clients c ON c.id = d.client_id
     ORDER BY (r.status = 'pending_approval') DESC, r.run_date DESC, r.id DESC LIMIT ?`,
    limit,
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function setRun(db: D1Database, id: number, status: RunView['status'], error: string | null, documentId?: number | null) {
  await run(
    db,
    `UPDATE recurring_runs SET status = ?, error = ?, document_id = COALESCE(?, document_id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    status,
    error,
    documentId ?? null,
    id,
  );
}

/** Finalizes a run's draft and, when the schedule says so, emails it. A failed send leaves the document issued. */
async function issueAndSend(ctx: Ctx, runId: number, documentId: number, sendEmail: boolean, send: SendFn): Promise<void> {
  await finalize(ctx, documentId);
  await setRun(ctx.db, runId, 'issued', null);
  if (!sendEmail) return;
  try {
    await send(documentId, { userId: ctx.actor.userId, email: ctx.actor.email });
    await setRun(ctx.db, runId, 'sent', null);
  } catch (err) {
    await setRun(ctx.db, runId, 'issued', `Issued, not sent: ${message(err)}`);
  }
}

/** Sets a copy's due date to its issue date plus the schedule's payment terms, when it has them. */
async function applyDueDays(ctx: Ctx, documentId: number, date: string, dueDays: number | null): Promise<void> {
  if (dueDays === null || dueDays === undefined) return;
  await updateDraft(ctx, documentId, { dueDate: addDays(date, dueDays) } as never);
}

/** Tells the owner a copy waits for approval (Slack). Never fails the run. */
export type PendingNotifier = (pending: { runId: number; documentId: number; scheduleName: string | null }) => Promise<void>;

/** One run of one schedule. The UNIQUE (schedule_id, run_date) row makes a second call a no-op. */
async function runOne(ctx: Ctx, s: ScheduleRow, runDate: string, send: SendFn, notify?: PendingNotifier): Promise<void> {
  const { db } = ctx;
  const inserted = await run(db, `INSERT OR IGNORE INTO recurring_runs (schedule_id, run_date, status) VALUES (?, ?, 'failed')`, s.id, runDate);
  if (inserted.changes === 0) return;
  const runId = inserted.lastRowId;
  let documentId: number | null = null;
  try {
    documentId = await duplicateDocument(ctx, s.template_document_id, { date: ctx.services.today() });
    await applyDueDays(ctx, documentId, ctx.services.today(), s.due_days);
    if (s.mode === 'approve') {
      await setRun(db, runId, 'pending_approval', null, documentId);
      if (notify) {
        try {
          await notify({ runId, documentId, scheduleName: s.name });
        } catch {
          // A missed notice never blocks the run. The copy still waits on the Approvals page.
        }
      }
      return;
    }
    await setRun(db, runId, 'issued', null, documentId);
    await issueAndSend(ctx, runId, documentId, s.send_email === 1, send);
  } catch (err) {
    await setRun(db, runId, 'failed', message(err), documentId);
  }
}

export interface RunDueResult {
  schedules: number;
  runs: number;
  /** True when issuing is turned off, so nothing ran. */
  issuingOff?: boolean;
}

/**
 * Runs every active schedule whose next run date has come. A schedule that missed days runs once
 * per missed date, capped at 12, and moves on to its next date. Past its end date it turns off.
 */
export async function runDue(ctx: Ctx, send: SendFn, notify?: PendingNotifier): Promise<RunDueResult> {
  const { db } = ctx;
  if (!(await issuingEnabled(db))) return { schedules: 0, runs: 0, issuingOff: true };
  const today = ctx.services.today();
  const due = await all<ScheduleRow>(db, 'SELECT * FROM recurring_schedules WHERE active = 1 AND next_run_date <= ? ORDER BY next_run_date, id', today);
  let runs = 0;
  for (const s of due) {
    let runDate = s.next_run_date;
    for (let i = 0; i < 12 && runDate <= today && (!s.end_date || runDate <= s.end_date); i += 1) {
      await runOne(ctx, s, runDate, send, notify);
      runs += 1;
      runDate = nextRunDate(runDate, s.frequency, s.anchor_day);
    }
    const stillActive = !s.end_date || runDate <= s.end_date;
    await run(
      db,
      `UPDATE recurring_schedules SET next_run_date = ?, active = ?, last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      runDate,
      stillActive ? 1 : 0,
      s.id,
    );
  }
  return { schedules: due.length, runs };
}

async function pendingRun(db: D1Database, runId: number) {
  const r = await first<{ id: number; document_id: number | null; status: string; send_email: number; due_days: number | null }>(
    db,
    `SELECT r.id, r.document_id, r.status, s.send_email, s.due_days FROM recurring_runs r JOIN recurring_schedules s ON s.id = r.schedule_id WHERE r.id = ?`,
    runId,
  );
  if (!r) throw new NotFoundError('Recurring run', runId);
  if (r.status !== 'pending_approval' || r.document_id === null) throw new ValidationError('This run is not waiting for approval.');
  return r as typeof r & { document_id: number };
}

/** Approves a run waiting in `approve` mode: dates the draft today, finalizes it and sends it when the schedule says so. */
export async function approveRun(ctx: Ctx, runId: number, send: SendFn): Promise<void> {
  const r = await pendingRun(ctx.db, runId);
  const today = ctx.services.today();
  const doc = await first<{ status: string; date: string }>(ctx.db, 'SELECT status, date FROM documents WHERE id = ?', r.document_id);
  if (!doc || doc.status !== 'draft') throw new ValidationError('The draft for this run is gone or already final.');
  if (doc.date !== today) {
    await updateDraft(ctx, r.document_id, { date: today } as never);
    await applyDueDays(ctx, r.document_id, today, r.due_days);
  }
  await auditAs(ctx.db, ctx.actor as AuditActor, 'recurring.approve', 'recurring_run', runId, { documentId: r.document_id });
  await issueAndSend(ctx, runId, r.document_id, r.send_email === 1, send);
}

/** Skips a run waiting for approval and deletes its draft. The schedule carries on. */
export async function skipRun(ctx: Ctx, runId: number): Promise<void> {
  const r = await pendingRun(ctx.db, runId);
  await run(ctx.db, `UPDATE recurring_runs SET status = 'skipped', document_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, runId);
  const doc = await first<{ status: string }>(ctx.db, 'SELECT status FROM documents WHERE id = ?', r.document_id);
  if (doc?.status === 'draft') await deleteDraft(ctx, r.document_id);
  await auditAs(ctx.db, ctx.actor, 'recurring.skip', 'recurring_run', runId, { documentId: r.document_id });
}

/**
 * Moves every active schedule that fell behind to its next run date on or after `today`, so
 * turning issuing back on never issues a backlog of documents for the months it was off.
 * Answers how many schedules moved.
 */
export async function skipMissedRuns(db: D1Database, today: string): Promise<number> {
  const behind = await all<ScheduleRow>(db, 'SELECT * FROM recurring_schedules WHERE active = 1 AND next_run_date < ?', today);
  for (const s of behind) {
    let next = s.next_run_date;
    for (let i = 0; i < 1000 && next < today; i += 1) next = nextRunDate(next, s.frequency, s.anchor_day);
    await run(db, `UPDATE recurring_schedules SET next_run_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, next, s.id);
  }
  return behind.length;
}
