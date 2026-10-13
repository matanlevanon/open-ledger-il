import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { DemoScopeError, scopeSql, scopedDb } from '../../../src/modules/demo/scoped-db';

/** R29 task 3: a visitor's queries see the sample set plus the session's own rows, and its inserts carry the session key. */
const KEY = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const VISIBLE = `demo_session_id IS NULL OR demo_session_id = '${KEY}'`;

describe('the scoped SQL', () => {
  it('turns every read of a tagged table into the visible rows, keeping the alias', () => {
    expect(scopeSql('SELECT * FROM documents WHERE id = ?', KEY)).toBe(`SELECT * FROM (SELECT * FROM documents WHERE ${VISIBLE}) AS documents WHERE id = ?`);
    expect(scopeSql('SELECT d.id FROM documents d JOIN clients AS c ON c.id = d.client_id', KEY)).toBe(
      `SELECT d.id FROM (SELECT * FROM documents WHERE ${VISIBLE}) AS d JOIN (SELECT * FROM clients WHERE ${VISIBLE}) AS c ON c.id = d.client_id`,
    );
    expect(scopeSql('SELECT COUNT(*) FROM expenses\n  WHERE business_id = ?', KEY)).toContain(`(SELECT * FROM expenses WHERE ${VISIBLE}) AS expenses\n  WHERE`);
    expect(scopeSql('SELECT * FROM documents LEFT JOIN payments p ON p.document_id = documents.id', KEY)).toContain('AS documents LEFT JOIN payments p');
  });

  it('leaves other tables, look-alike names and DELETE targets alone', () => {
    for (const sql of ['SELECT * FROM document_lines WHERE document_id = ?', 'SELECT * FROM client_contacts', 'SELECT * FROM expense_categories', 'DELETE FROM documents WHERE id = ?', 'UPDATE documents SET notes = ? WHERE id = ?']) {
      expect(scopeSql(sql, KEY)).toBe(sql);
    }
    expect(scopeSql('DELETE FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE business_id = ?)', KEY)).toContain('FROM (SELECT * FROM documents');
  });

  it('tags an insert, by VALUES or by SELECT', () => {
    expect(scopeSql('INSERT INTO clients (name_en, business_id) VALUES (?, ?)', KEY)).toBe(`INSERT INTO clients (demo_session_id, name_en, business_id) VALUES ('${KEY}', ?, ?)`);
    expect(scopeSql('INSERT OR IGNORE INTO suppliers (name) SELECT name FROM suppliers WHERE id = ?', KEY)).toBe(
      `INSERT OR IGNORE INTO suppliers (demo_session_id, name) SELECT '${KEY}', name FROM (SELECT * FROM suppliers WHERE ${VISIBLE}) AS suppliers WHERE id = ?`,
    );
    expect(scopeSql('INSERT INTO document_lines (document_id) VALUES (?)', KEY)).toBe('INSERT INTO document_lines (document_id) VALUES (?)');
  });

  it('fails closed on an insert it cannot tag, and on a bad key', () => {
    expect(() => scopeSql('INSERT INTO documents DEFAULT VALUES', KEY)).toThrow(DemoScopeError);
    expect(() => scopeSql('SELECT 1', "x' OR 1=1 --")).toThrow(DemoScopeError);
  });

  it('the admin key (null) reads the sample set only and inserts into it', () => {
    expect(scopeSql('SELECT * FROM clients', null)).toBe('SELECT * FROM (SELECT * FROM clients WHERE demo_session_id IS NULL) AS clients');
    expect(scopeSql('INSERT INTO clients (name_en) VALUES (?)', null)).toBe('INSERT INTO clients (name_en) VALUES (?)');
  });
});

describe('the scoped database', () => {
  it('a visitor sees the sample rows and its own, never another visitor’s', async () => {
    await run(env.DB, "INSERT INTO suppliers (name, country, business_id) VALUES ('Sample supplier', 'IL', 1)");
    const mine = scopedDb(env.DB, KEY);
    const theirs = scopedDb(env.DB, OTHER);
    await run(mine, "INSERT INTO suppliers (name, country, business_id) VALUES ('Mine', 'IL', 1)");
    await run(theirs, "INSERT INTO suppliers (name, country, business_id) VALUES ('Theirs', 'IL', 1)");
    const names = async (db: D1Database) => (await all<{ name: string }>(db, 'SELECT name FROM suppliers WHERE business_id = 1 ORDER BY id')).map((r) => r.name);
    expect(await names(mine)).toEqual(['Sample supplier', 'Mine']);
    expect(await names(theirs)).toEqual(['Sample supplier', 'Theirs']);
    expect((await first<{ demo_session_id: string }>(env.DB, "SELECT demo_session_id FROM suppliers WHERE name = 'Mine'"))!.demo_session_id).toBe(KEY);
    // A batch goes through the same rewrite.
    await mine.batch([mine.prepare("INSERT INTO suppliers (name, country, business_id) VALUES ('Batched', 'IL', 1)")]);
    expect(await names(theirs)).not.toContain('Batched');
    await expect(mine.exec('SELECT 1')).rejects.toThrow(DemoScopeError);
  });
});
