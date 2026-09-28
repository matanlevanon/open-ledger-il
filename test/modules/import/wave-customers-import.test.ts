import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { WAVE_CUSTOMERS_CSV } from '../../fixtures/import/wave';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, uploadForm } from './helpers';

interface ClientRow {
  id: number;
  name_en: string;
  email: string | null;
  currency: string;
  country: string;
  company_id: string | null;
}
interface Summary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

async function clientsByName(name: string): Promise<ClientRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM clients WHERE name_en = ?').bind(name).all<ClientRow>();
  return results;
}

describe('import: Wave customers CSV', () => {
  beforeEach(async () => {
    await run(env.DB, 'DELETE FROM clients');
    await run(env.DB, 'DELETE FROM import_batches');
  });

  it('previews headers, sample rows and a guessed mapping without writing anything', async () => {
    const app = buildApp();
    const res = await call(app, '/wave/customers/preview', {
      method: 'POST',
      body: uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'customers.csv', 'text/csv'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { headers: string[]; totalRows: number; suggestedMapping: Record<string, string | null> };
    expect(body.totalRows).toBe(3);
    expect(body.suggestedMapping.nameEn).toBe('Customer Name');
    expect(await clientsByName('Example Client Ltd')).toHaveLength(0);
  });

  it('creates a client per row using the guessed mapping', async () => {
    const app = buildApp();
    const res = await call(app, '/wave/customers/commit', {
      method: 'POST',
      body: uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'customers.csv', 'text/csv'),
    });
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as { summary: Summary };
    expect(summary).toMatchObject({ totalRows: 3, created: 3, updated: 0, skipped: 0 });

    const [exampleClient] = await clientsByName('Example Client Ltd');
    expect(exampleClient).toMatchObject({ currency: 'EUR', country: 'IL', company_id: '514000000' });

    const [solo] = await clientsByName('Solo Client');
    expect(solo).toMatchObject({ currency: 'USD', country: 'US', email: null });
  });

  it('is idempotent: importing the same file twice never duplicates a client', async () => {
    const app = buildApp();
    const body = () => uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'customers.csv', 'text/csv');
    await call(app, '/wave/customers/commit', { method: 'POST', body: body() });
    const second = await call(app, '/wave/customers/commit', { method: 'POST', body: body() });
    const { summary } = (await second.json()) as { summary: Summary };
    expect(summary).toMatchObject({ created: 0, updated: 3 });
    expect(await clientsByName('Example Client Ltd')).toHaveLength(1);
  });

  it('only overwrites fields the mapping actually maps, on a matching re-import', async () => {
    const app = buildApp();
    // First import maps only the name, so the client is created with defaults elsewhere.
    await call(app, '/wave/customers/commit', {
      method: 'POST',
      body: uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'c.csv', 'text/csv', { nameEn: 'Customer Name' }),
    });
    const [before] = await clientsByName('Example Client Ltd');
    expect(before!.email).toBeNull();

    // A hand edit in Open Ledger IL between imports must survive a re-import that never maps email.
    await run(env.DB, "UPDATE clients SET notes = 'hand-added note' WHERE id = ?", before!.id);
    await call(app, '/wave/customers/commit', {
      method: 'POST',
      body: uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'c.csv', 'text/csv', { nameEn: 'Customer Name' }),
    });
    const [after] = await clientsByName('Example Client Ltd');
    expect(after!.email).toBeNull();
    const notes = await env.DB.prepare('SELECT notes FROM clients WHERE id = ?').bind(before!.id).first<{ notes: string }>();
    expect(notes?.notes).toBe('hand-added note');
  });

  it('skips a row with an invalid email and reports it, but still imports the rest', async () => {
    const csv = 'Customer Name,Email\nBad Row,not-an-email\nGood Row,good@example.com\n';
    const app = buildApp();
    const res = await call(app, '/wave/customers/commit', { method: 'POST', body: uploadForm(bytesFrom(csv), 'c.csv', 'text/csv') });
    const { summary } = (await res.json()) as { summary: Summary };
    expect(summary).toMatchObject({ totalRows: 2, created: 1, skipped: 1 });
    expect(summary.errors[0]).toMatchObject({ row: 2 });
    expect(await clientsByName('Bad Row')).toHaveLength(0);
    expect(await clientsByName('Good Row')).toHaveLength(1);
  });

  it('refuses a commit with no client-name mapping possible', async () => {
    const app = buildApp();
    const res = await call(app, '/wave/customers/commit', {
      method: 'POST',
      body: uploadForm(bytesFrom('Email\nsomeone@example.com\n'), 'c.csv', 'text/csv'),
    });
    expect(res.status).toBe(400);
  });

  it('refuses the accountant', async () => {
    const app = buildApp();
    const res = await call(
      app,
      '/wave/customers/preview',
      { method: 'POST', body: uploadForm(bytesFrom(WAVE_CUSTOMERS_CSV), 'c.csv', 'text/csv') },
      ACCOUNTANT_ENV,
    );
    expect(res.status).toBe(403);
  });
});
