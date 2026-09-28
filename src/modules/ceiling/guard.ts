import { env } from 'cloudflare:workers';
import { SYSTEM_ACTOR, auditAs } from '../../core/audit';
import { ceilingFor, legalModeOn } from '../../core/config';
import { DomainError } from '../../core/errors';
import { assertCurrency, formatMinor } from '../../core/money';
import type { CeilingGuard } from '../documents/ceiling';
import { turnoverIls } from '../dashboard';
import { type Notifier, slackNotifier } from '../ita/notify';
import { evaluateCeilingAlerts } from './alerts';

export interface CeilingCrossingDetails {
  year: number;
  currency: string;
  /** Recorded turnover before this receipt. */
  turnoverMinor: number;
  /** This receipt's ILS amount. */
  amountMinor: number;
  limitMinor: number;
  /** Headroom left before this receipt (limitMinor - turnoverMinor). Negative if already over. */
  gapMinor: number;
}

/** docs/legal-requirements.md, "Ceiling guard": "returns a CEILING_CROSSING error with turnover, ceiling and gap." */
export class CeilingCrossingError extends DomainError {
  constructor(readonly crossing: CeilingCrossingDetails) {
    const currency = assertCurrency(crossing.currency);
    const projected = crossing.turnoverMinor + crossing.amountMinor;
    super(
      'CEILING_CROSSING',
      `This receipt of ${formatMinor(crossing.amountMinor, currency)} would take ${crossing.year} turnover to ` +
        `${formatMinor(projected, currency)}, past the ${formatMinor(crossing.limitMinor, currency)} עוסק פטור ceiling. ` +
        `Confirm the switch to עוסק מורשה, issue a smaller receipt, or cancel.`,
      409,
      crossing,
    );
  }
}

/**
 * The real CeilingGuard (docs/legal-requirements.md, "Ceiling guard", point 3 "Crossing block").
 *
 * The block checks recorded turnover only, not open payment requests: a request is a projection,
 * not money in, so an open request alone never blocks a receipt (only the running alert in
 * `alerts.ts` reacts to that). Alerts are evaluated first, against the full meter (turnover plus
 * open requests, `meter.ts`), so a receipt near the ceiling still raises the 70/85/95 percent
 * warnings even when it does not itself get blocked.
 */
export function createCeilingGuard(db: D1Database, notifier: Notifier): CeilingGuard {
  return {
    async check(amountIls, date) {
      await evaluateCeilingAlerts(db, date, notifier);

      const legalMode = await legalModeOn(db, date);
      if (legalMode.mode !== 'patur') return; // the ceiling only gates the עוסק פטור series

      const ceiling = await ceilingFor(db, date);
      if (!ceiling) return; // nothing configured for this year yet (Settings), nothing to enforce

      const year = Number(date.slice(0, 4));
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const turnoverMinor = await turnoverIls(db, yearStart, yearEnd);
      const projected = turnoverMinor + amountIls;
      if (projected <= ceiling.amount_minor) return;

      // docs/legal-requirements.md, "Ceiling guard", point 5: "every alert, block and decision
      // writes to audit_log". This is the block itself; the owner's eventual choice (confirm
      // switch, issue smaller, cancel) is audited separately where each of those actions happens.
      await auditAs(db, SYSTEM_ACTOR, 'ceiling.crossing_blocked', 'ceiling', String(year), {
        turnoverMinor,
        amountMinor: amountIls,
        limitMinor: ceiling.amount_minor,
      });

      throw new CeilingCrossingError({
        year,
        currency: ceiling.currency,
        turnoverMinor,
        amountMinor: amountIls,
        limitMinor: ceiling.amount_minor,
        gapMinor: ceiling.amount_minor - turnoverMinor,
      });
    },
  };
}

/**
 * The guard wired into the registered `documents` module (`src/modules/index.ts`). `CeilingGuard`
 * (R01, `src/modules/documents/ceiling.ts`) takes no `db` parameter, and this object is built once
 * at module-registry load time, before any request exists. So it reads bindings through
 * `cloudflare:workers`'s `env` export at call time instead, the same binding object `c.env` would
 * hand a route handler (bindings are fixed for the Worker's lifetime, never per-request).
 */
export const ceilingGuard: CeilingGuard = {
  check: (amountIls, date) => createCeilingGuard(env.DB, slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init))).check(amountIls, date),
};
