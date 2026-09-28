import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { WAVE_INVOICES_CSV } from '../../fixtures/import/wave';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, uploadForm } from './helpers';

describe('import: routes', () => {
  beforeEach(async () => {
    await run(env.DB, 'DELETE FROM history');
    await run(env.DB, 'DELETE FROM import_batches');
  });

  it('lists imported history, newest first, filterable by source', async () => {
    const app = buildApp();
    await call(app, '/wave/invoices/commit', { method: 'POST', body: uploadForm(bytesFrom(WAVE_INVOICES_CSV), 'i.csv', 'text/csv') });

    const all = (await (await call(app, '/history')).json()) as { history: { source: string }[] };
    expect(all.history).toHaveLength(2);

    const waveOnly = (await (await call(app, '/history?source=wave')).json()) as { history: { source: string }[] };
    expect(waveOnly.history.every((h) => h.source === 'wave')).toBe(true);

    const sumitOnly = (await (await call(app, '/history?source=sumit')).json()) as { history: unknown[] };
    expect(sumitOnly.history).toHaveLength(0);
  });

  it('refuses every route to the accountant', async () => {
    const app = buildApp();
    for (const path of ['/series', '/history']) {
      const res = await call(app, path, {}, ACCOUNTANT_ENV);
      expect(res.status).toBe(403);
    }
  });
});
