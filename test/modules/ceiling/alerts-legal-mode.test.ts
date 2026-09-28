import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { run } from '../../../src/core/db';
import { evaluateCeilingAlerts } from '../../../src/modules/ceiling';
import type { Notifier } from '../../../src/modules/ita/notify';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

class RecordingNotifier implements Notifier {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return true;
  }
}

describe('evaluateCeilingAlerts: no-op after the switch to עוסק מורשה', () => {
  it('never fires once the legal mode has switched, however far turnover is past the ceiling', async () => {
    await run(db(), `INSERT INTO legal_modes (mode, effective_from) VALUES ('murshe', '2026-01-01')`);
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 20000000 }); // well past the 12,283,300 ceiling
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    const notifier = new RecordingNotifier();
    expect(await evaluateCeilingAlerts(db(), '2026-10-06', notifier)).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });
});
