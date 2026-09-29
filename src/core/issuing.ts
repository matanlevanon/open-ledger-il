import { first } from './db';
import { DomainError } from './errors';

/**
 * Issuing switch. When it is off, this deployment issues no documents: no new drafts, no
 * finalize, no payments, credits, cancellations, conversions or recurring runs. Past documents,
 * imported documents, clients, expenses and reports keep working. A business that issues its
 * documents in another, registered system uses the Ledger for everything else this way.
 *
 * Stored in `settings` under `documents.issuing`. Missing means on. Only the owner changes it,
 * in Settings > Issuing (PUT /api/ops/issuing), and every change is in the audit log.
 */
export const ISSUING_KEY = 'documents.issuing';

export async function issuingEnabled(db: D1Database): Promise<boolean> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', ISSUING_KEY);
  return row?.value !== 'off';
}

export class IssuingOffError extends DomainError {
  constructor() {
    super('issuing_off', 'Issuing documents is turned off. The owner turns it on in Settings > Issuing.', 409);
  }
}

/** Every service call that creates or changes a document runs this first. */
export async function assertIssuing(db: D1Database): Promise<void> {
  if (!(await issuingEnabled(db))) throw new IssuingOffError();
}
