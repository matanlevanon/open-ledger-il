import { ConflictError, DomainError, ValidationError, mapDbError } from '../../core/errors';

/** Codes raised by the triggers in migrations/0100_documents.sql. */
const MODULE_CODES: Record<string, () => DomainError> = {
  date_before_last_in_series: () =>
    new ConflictError('date_before_last_in_series', 'The date is before the last final document in this series. Pick a later date.'),
  payment_exceeds_balance: () =>
    new ConflictError('payment_exceeds_balance', 'The payment is more than the open balance of the source document.'),
  source_not_open: () => new ConflictError('source_not_open', 'The source document is no longer open.'),
  credit_exceeds_document: () =>
    new ConflictError('credit_exceeds_document', 'The credit is more than what is left to credit on this document.'),
};

/** Maps module and core trigger errors to typed domain errors. */
export function mapError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  for (const code of Object.keys(MODULE_CODES)) {
    if (message.includes(code)) return MODULE_CODES[code]!();
  }
  return mapDbError(err);
}

export async function mapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    throw mapError(err);
  }
}

export function invalid(message: string, details?: unknown): never {
  throw new ValidationError(message, details);
}

export function conflict(code: string, message: string): never {
  throw new ConflictError(code, message);
}
