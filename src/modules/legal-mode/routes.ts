import { type Context, Hono } from 'hono';
import { actorFrom, auditStatement } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { assertDate, stmt, todayIsrael, transaction } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import type { DocumentsModuleOptions } from '../documents';
import { ceilingMeter } from '../ceiling';
import { businessIdOf } from '../../core/business';
import { businessTypeStatus } from './business-type';
import { startCompanyInput, switchInput, vatReportingInput } from './schemas';
import type { SwitchDeps, SwitchResult } from './service';
import { switchToMurshe } from './service';

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

export interface LegalModeRoutesDeps {
  documentsOptions: DocumentsModuleOptions;
  itaConnectionCheck?: SwitchDeps['itaConnectionCheck'];
}

/**
 * Routes under /api/legal-mode. Owner only, same as any other Settings-area action
 * (docs/accountant-access.md, "Never available to the accountant": Settings, numbering,
 * business details).
 *
 * `POST /switch` is the "Confirm switch" action from the ceiling-crossing screen
 * (docs/legal-requirements.md, "Ceiling guard", point 3) and from the Settings tax screen. There
 * is no automatic switch (PLAN.md decision 2): this call, from the owner, is the only door.
 */
export function legalModeRoutes(deps: LegalModeRoutesDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', requireFeature('settings'));

  r.get('/status', async (c) => c.json(await businessTypeStatus(c.env, todayIsrael(), businessIdOf(c))));

  r.put('/vat-reporting', async (c) => {
    const { vatReporting } = vatReportingInput.parse(await body(c));
    await transaction(c.env.DB, [
      stmt(c.env.DB, 'UPDATE businesses SET vat_reporting = ? WHERE id = ?', vatReporting, businessIdOf(c)),
      auditStatement(c.env.DB, actorFrom(c), 'business.vat_reporting_set', 'business', businessIdOf(c), { vatReporting }),
    ]);
    return c.json(await businessTypeStatus(c.env, todayIsrael(), businessIdOf(c)));
  });

  r.post('/switch', async (c) => {
    const input = switchInput.parse(await body(c));
    const today = todayIsrael();
    // `registered`: the business is already מורשה, so the Ledger follows from today.
    const effectiveDate = input.kind === 'registered' ? today : input.effectiveDate;
    if (!effectiveDate) throw new ValidationError('Pick the start date.');
    assertDate(effectiveDate, 'effectiveDate');
    if (effectiveDate < today) throw new ValidationError('The effective date cannot be in the past.');

    const meter = await ceilingMeter(c.env.DB, today, businessIdOf(c));
    const result = await switchToMurshe(
      c.env,
      { documentsOptions: deps.documentsOptions, itaConnectionCheck: deps.itaConnectionCheck },
      { kind: input.kind, effectiveDate, reason: input.reason ?? null, repriceDrafts: input.repriceDrafts, target: 'osek_murshe', businessId: businessIdOf(c) },
      c.get('user'),
      actorFrom(c),
    );
    return c.json({ ok: true, status: 'confirmed', message: switchMessage(result, input.repriceDrafts), ...result, meter });
  });

  // R24: a company is VAT registered from its first day. Only on a fresh פטור Ledger, never afterwards.
  r.post('/start-company', async (c) => {
    const input = startCompanyInput.parse(await body(c));
    const today = todayIsrael();
    const result = await switchToMurshe(
      c.env,
      { documentsOptions: deps.documentsOptions, itaConnectionCheck: deps.itaConnectionCheck },
      { kind: 'registered', effectiveDate: today, reason: input.reason ?? null, repriceDrafts: false, target: 'company', businessId: businessIdOf(c) },
      c.get('user'),
      actorFrom(c),
    );
    return c.json({ ok: true, status: 'confirmed', message: switchMessage(result, false), ...result });
  });

  return r;
}

function switchMessage(result: SwitchResult, repriceDrafts: boolean): string {
  const openCount = result.openPaymentRequests.length;
  const openNote =
    openCount === 0
      ? 'No open payment requests need attention.'
      : `${openCount} open payment request${openCount === 1 ? '' : 's'} were left exactly as they are (CLAUDE.md rule 1): reissue or cancel each one from its own document screen.`;
  const repriceNote = repriceDrafts
    ? `Re-priced ${result.repricedDrafts.length} open draft${result.repricedDrafts.length === 1 ? '' : 's'} with VAT.`
    : 'Open drafts were left as they are; tick "reprice drafts" to update them now instead of on next edit.';
  const who = result.entityType === 'company' ? 'Started as a company (חברה בע"מ), VAT registered,' : 'Switched to עוסק מורשה';
  const vatNote = result.vatOfficeTaskDueAt ? ` Notify the VAT office by ${result.vatOfficeTaskDueAt}.` : '';
  return (
    `${who} from ${result.effectiveDate}. Closed the ${result.seriesClosed.join(', ')} series and opened ` +
    `${result.seriesOpened.join(', ')}. ${openNote} ${repriceNote}${vatNote}`
  );
}
