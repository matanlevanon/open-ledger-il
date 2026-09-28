import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { OWNER_ACTOR, makeDraft } from '../../helpers';
import { ACCOUNTANT_ENV, buildApp, call, env, json } from './helpers';

interface SeriesRow {
  id: string;
  doc_type: string;
  start_number: number;
  next_number: number;
  started_at: string | null;
}

describe('import: series starting numbers (owner confirmation required)', () => {
  it('lists every series', async () => {
    const app = buildApp();
    const res = await call(app, '/series');
    const { series } = (await res.json()) as { series: SeriesRow[] };
    expect(series.map((s) => s.id)).toEqual(expect.arrayContaining(['QT', 'PR', '300', '400', '405']));
  });

  it('requires an explicit confirm before setting the number', async () => {
    const app = buildApp();
    const res = await call(app, '/series/QT/start', json({ startNumber: 42 }));
    expect(res.status).toBe(400);
  });

  it('sets the starting number once confirmed, from the owner-supplied last SUMIT number', async () => {
    const app = buildApp();
    const res = await call(app, '/series/QT/start', json({ startNumber: 57, confirm: true, note: 'Last SUMIT quote was QT-56' }));
    expect(res.status).toBe(200);
    const { series } = (await res.json()) as { series: SeriesRow };
    expect(series).toMatchObject({ start_number: 57, next_number: 57 });
  });

  it('refuses once the series has issued its first document', async () => {
    const app = buildApp();
    const draftId = await makeDraft({ seriesId: 'PR' });
    await finalizeDocument(env.DB, draftId, { actor: OWNER_ACTOR });

    const res = await call(app, '/series/PR/start', json({ startNumber: 5, confirm: true }));
    expect(res.status).toBe(409);
  });

  it('refuses the accountant', async () => {
    const app = buildApp();
    const res = await call(app, '/series/QT/start', json({ startNumber: 10, confirm: true }), ACCOUNTANT_ENV);
    expect(res.status).toBe(403);
  });
});
