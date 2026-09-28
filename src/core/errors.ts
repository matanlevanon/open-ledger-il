import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Base class for every error the API reports as `{error:{code,message}}`. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ContentfulStatusCode = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, 400, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Sign in to continue.') {
    super('unauthorized', message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have access to this.') {
    super('forbidden', message, 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string | number) {
    super('not_found', id === undefined ? `${entity} not found.` : `${entity} ${id} not found.`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

/** A final document, its lines or payments were about to change. */
export class ImmutableError extends DomainError {
  constructor(message = 'Final documents never change. Cancel or credit instead.') {
    super('immutable_document', message, 409);
  }
}

export class NumberingError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class ConfigError extends DomainError {
  constructor(message: string) {
    super('config_missing', message, 500);
  }
}

/** A client has not granted consent to receive digital documents (instruction 18ב). */
export class ConsentRequiredError extends DomainError {
  constructor(
    clientName: string,
    readonly clientId: number,
  ) {
    super('consent_required', `${clientName} has not consented to digital documents yet.`, 409, { clientId, clientName });
  }
}

/**
 * Codes raised by D1 triggers with RAISE(ABORT, '<code>').
 * Keep in sync with migrations/0001_core.sql and 0002_integrity.sql.
 */
const TRIGGER_CODES: Record<string, () => DomainError> = {
  immutable_document: () => new ImmutableError(),
  immutable_line: () => new ImmutableError('Lines of a final document never change.'),
  immutable_payment: () => new ImmutableError('Payments of a final document never change.'),
  immutable_link: () => new ImmutableError('Links to a final document never change.'),
  invalid_status_transition: () =>
    new ImmutableError('This status change is not allowed on a final document.'),
  final_requires_finalization: () =>
    new NumberingError('final_requires_finalization', 'Only the finalize transaction sets a document to final.'),
  append_only: () => new ImmutableError('This record is append-only.'),
  series_closed: () => new NumberingError('series_closed', 'This number series is closed.'),
  series_missing: () => new NumberingError('series_missing', 'This number series does not exist.'),
  number_conflict: () => new NumberingError('number_conflict', 'The next number changed. Try again.'),
  chain_conflict: () => new NumberingError('chain_conflict', 'The hash chain moved. Try again.'),
  draft_changed: () =>
    new NumberingError('draft_changed', 'The draft changed while it was being finalized. Try again.'),
  not_draft: () => new NumberingError('not_draft', 'Only a draft can be finalized.'),
  series_mismatch: () => new NumberingError('series_mismatch', 'The document belongs to another series.'),
  series_started: () =>
    new NumberingError('series_started', 'The starting number is fixed once the series is in use.'),
  series_sequence: () => new NumberingError('series_sequence', 'Series numbers only move forward by one.'),
  series_reopen: () => new NumberingError('series_reopen', 'A closed series never reopens.'),
};

/** Maps a D1 trigger error to a typed domain error. Returns the input when no code matches. */
export function mapDbError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  for (const code of Object.keys(TRIGGER_CODES)) {
    if (message.includes(code)) return TRIGGER_CODES[code]!();
  }
  return err;
}

/** The trigger code inside a D1 error message, if any. */
export function dbErrorCode(err: unknown): string | undefined {
  const message = err instanceof Error ? err.message : String(err);
  return Object.keys(TRIGGER_CODES).find((code) => message.includes(code));
}
