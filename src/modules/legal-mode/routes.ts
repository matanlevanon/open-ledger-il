import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { assertDate, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import type { DocumentsModuleOptions } from '../documents';
import { ceilingMeter } from '../ceiling';
import { switchInput } from './schemas';
import type { SwitchDeps } from './service';
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

  r.post('/switch', async (c) => {
    const input = switchInput.parse(await body(c));
    assertDate(input.effectiveDate, 'effectiveDate');
    const today = todayIsrael();
    if (input.effectiveDate < today) throw new ValidationError('The effective date cannot be in the past.');

    const meter = await ceilingMeter(c.env.DB, today);
    const result = await switchToMurshe(
      c.env,
      { documentsOptions: deps.documentsOptions, itaConnectionCheck: deps.itaConnectionCheck },
      input.effectiveDate,
      input.reason ?? null,
      input.repriceDrafts,
      c.get('user'),
      actorFrom(c),
    );

    const openCount = result.openPaymentRequests.length;
    const openNote =
      openCount === 0
        ? 'No open payment requests need attention.'
        : `${openCount} open payment request${openCount === 1 ? '' : 's'} were left exactly as they are (CLAUDE.md rule 1): reissue or cancel each one from its own document screen.`;
    const repriceNote = input.repriceDrafts
      ? `Re-priced ${result.repricedDrafts.length} open draft${result.repricedDrafts.length === 1 ? '' : 's'} with VAT.`
      : 'Open drafts were left as they are; tick "reprice drafts" to update them now instead of on next edit.';

    return c.json({
      ok: true,
      status: 'confirmed',
      message:
        `Switched to עוסק מורשה from ${result.effectiveDate}. Closed the ${result.seriesClosed.join(', ')} series and opened ` +
        `${result.seriesOpened.join(', ')}. ${openNote} ${repriceNote} ` +
        `Notify the VAT office by ${result.vatOfficeTaskDueAt}.`,
      ...result,
      meter,
    });
  });

  return r;
}
