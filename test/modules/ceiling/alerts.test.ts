import { describe, expect, it } from 'vitest';
import { all } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { CEILING_ALERT_THRESHOLDS, evaluateCeilingAlerts } from '../../../src/modules/ceiling';
import type { Notifier } from '../../../src/modules/ita/notify';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

class RecordingNotifier implements Notifier {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return true;
  }
}

async function receipt(totalMinor: number): Promise<void> {
  const id = await makeDraft({ seriesId: '400', totalMinor });
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
}

// The seeded 2026 ceiling is 12,283,300 agorot. These thresholds divide it evenly.
const CEILING_2026 = 12283300;
const AT_70 = 8598310;
const AT_85 = 10440805;
const AT_100 = CEILING_2026;

describe('evaluateCeilingAlerts: each threshold fires once per year (runs/R08-reports.md)', () => {
  it('lists the thresholds in ascending order', () => {
    expect(CEILING_ALERT_THRESHOLDS).toEqual([70, 85, 95, 100]);
  });

  it('fires 70 percent once turnover reaches it, and never repeats it on a later call at the same level', async () => {
    await receipt(AT_70);
    const notifier = new RecordingNotifier();

    const first = await evaluateCeilingAlerts(db(), '2026-10-06', notifier);
    expect(first.map((a) => a.thresholdPct)).toEqual([70]);
    expect(notifier.sent).toHaveLength(1);

    const second = await evaluateCeilingAlerts(db(), '2026-10-06', notifier);
    expect(second).toEqual([]);
    expect(notifier.sent).toHaveLength(1);

    // docs/legal-requirements.md, "Ceiling guard", point 5: "every alert... writes to audit_log."
    const audited = await all<{ action: string; entity_id: string }>(db(), "SELECT action, entity_id FROM audit_log WHERE action = 'ceiling.alert'");
    expect(audited).toEqual([{ action: 'ceiling.alert', entity_id: '2026:70' }]);
  });

  it('fires only the newly-crossed thresholds as turnover climbs further, in order', async () => {
    const notifier = new RecordingNotifier();

    await receipt(AT_85 - AT_70); // turnover now exactly 85%
    expect((await evaluateCeilingAlerts(db(), '2026-10-06', notifier)).map((a) => a.thresholdPct)).toEqual([85]);

    await receipt(AT_100 - AT_85); // turnover now exactly 100%, crossing 95 and 100 together
    expect((await evaluateCeilingAlerts(db(), '2026-10-06', notifier)).map((a) => a.thresholdPct)).toEqual([95, 100]);

    expect(notifier.sent).toHaveLength(3);

    // Every threshold has now fired for 2026. A further call, even well past the ceiling, fires nothing new.
    await receipt(1000000);
    expect(await evaluateCeilingAlerts(db(), '2026-10-06', notifier)).toEqual([]);
    expect(notifier.sent).toHaveLength(3);
  });
});
