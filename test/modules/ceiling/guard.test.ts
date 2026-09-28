import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { all, run } from '../../../src/core/db';
import { DomainError } from '../../../src/core/errors';
import { createCeilingGuard } from '../../../src/modules/ceiling';
import type { Notifier } from '../../../src/modules/ita/notify';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

class RecordingNotifier implements Notifier {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return true;
  }
}

async function crossingError(amountIls: number, date = '2026-10-06') {
  const guard = createCeilingGuard(db(), new RecordingNotifier());
  return guard.check(amountIls, date).then(
    () => null,
    (err: unknown) => err,
  );
}

// runs/R08-reports.md, "Tests": crossing detection at the exact boundary. The seeded 2026
// ceiling is 12,283,300 agorot.
describe('CeilingGuard.check: crossing detection at the exact boundary', () => {
  it('allows a receipt that lands exactly on the ceiling', async () => {
    expect(await crossingError(12283300)).toBeNull();
  });

  it('blocks a receipt that would land one agora past the ceiling', async () => {
    const err = await crossingError(12283301);
    expect(err).toBeInstanceOf(DomainError);
    const domainErr = err as DomainError;
    expect(domainErr.code).toBe('CEILING_CROSSING');
    expect(domainErr.status).toBe(409);
    expect(domainErr.details).toMatchObject({
      year: 2026,
      currency: 'ILS',
      turnoverMinor: 0,
      amountMinor: 12283301,
      limitMinor: 12283300,
      gapMinor: 12283300,
    });

    // docs/legal-requirements.md, "Ceiling guard", point 5: "every... block... writes to audit_log."
    const audited = await all<{ action: string; entity_id: string }>(db(), "SELECT action, entity_id FROM audit_log WHERE action = 'ceiling.crossing_blocked'");
    expect(audited).toEqual([{ action: 'ceiling.crossing_blocked', entity_id: '2026' }]);
  });

  it('accounts for turnover already recorded this year, not just the new receipt', async () => {
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 12000000 });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    expect(await crossingError(283300)).toBeNull(); // 12,000,000 + 283,300 = 12,283,300 exactly
    const err = (await crossingError(283301)) as DomainError;
    expect(err.code).toBe('CEILING_CROSSING');
    expect((err.details as { turnoverMinor: number }).turnoverMinor).toBe(12000000);
  });

  it('does not block when the year has no ceiling row configured yet', async () => {
    expect(await crossingError(999999999, '2099-01-06')).toBeNull();
  });

  it('never blocks once the legal mode has switched to עוסק מורשה', async () => {
    await run(db(), `INSERT INTO legal_modes (mode, effective_from) VALUES ('murshe', '2026-01-01')`);
    expect(await crossingError(999999999)).toBeNull();
  });
});
