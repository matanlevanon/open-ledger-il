/**
 * R29: the visitor's view of the shared sample Ledger. Every visitor opens the same master
 * businesses. A row a visitor creates carries its session key in demo_session_id, and the sample
 * set has NULL there. This wrapper sits on env.DB for a visitor's requests, so the Ledger's own
 * queries need no change:
 *
 *   - a read of a tagged table (FROM or JOIN) sees the sample rows plus this session's rows only.
 *     The table name becomes a subquery with the same alias, so column references still resolve.
 *   - an INSERT into a tagged table writes the session key into demo_session_id.
 *
 * An INSERT into a tagged table in a form the rewrite does not know fails closed: the row would
 * otherwise join the sample set.
 */

/** The tables a visitor's rows are tagged in. Child rows (lines, payments, events) follow their parent. */
export const DEMO_TAGGED_TABLES = ['documents', 'clients', 'contracts', 'expenses', 'expense_files', 'suppliers', 'demo_outbox'] as const;

const NAMES = DEMO_TAGGED_TABLES.join('|');
/** Words that can follow a table name and are not an alias. */
const KEYWORDS =
  'WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|NATURAL|ON|USING|ORDER|GROUP|LIMIT|HAVING|UNION|EXCEPT|INTERSECT|WINDOW|SET|VALUES|RETURNING|INDEXED|NOT|AND|OR|WHEN|THEN|ELSE|END';

const READ = new RegExp(`\\b(FROM|JOIN)(\\s+)("?)(${NAMES})\\3(?![\\w.])(?:\\s+(?:AS\\s+)?(?!(?:${KEYWORDS})\\b)([A-Za-z_]\\w*))?`, 'gi');
const INSERT = new RegExp(`^(\\s*INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+"?(?:${NAMES})"?\\s*\\()`, 'i');
const INSERT_ANY = new RegExp(`^\\s*INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+"?(?:${NAMES})"?(?![\\w])`, 'i');

export class DemoScopeError extends Error {}

function assertKey(key: string | null): void {
  if (key !== null && !/^[a-z0-9-]{8,64}$/.test(key)) throw new DemoScopeError('Bad demo session key.');
}

/**
 * The SQL a demo request runs instead of `sql`. Pure, so tests read it directly. A null key is the
 * admin's sample-set session: it reads the sample rows only and its inserts join the sample set.
 */
export function scopeSql(sql: string, key: string | null): string {
  assertKey(key);
  const visible = (table: string) =>
    key === null ? `(SELECT * FROM ${table} WHERE demo_session_id IS NULL)` : `(SELECT * FROM ${table} WHERE demo_session_id IS NULL OR demo_session_id = '${key}')`;
  let out = sql.replace(READ, (match, kw: string, space: string, _q: string, table: string, alias: string | undefined, offset: number) => {
    // DELETE FROM names its target table, not a source. The guard decides who may delete.
    if (kw.toUpperCase() === 'FROM' && /\bDELETE\s+$/i.test(sql.slice(0, offset))) return match;
    return `${kw}${space}${visible(table.toLowerCase())} AS ${alias ?? table}`;
  });
  if (key !== null && INSERT_ANY.test(out)) out = tagInsert(out, key);
  return out;
}

function tagInsert(sql: string, key: string): string {
  const head = INSERT.exec(sql);
  if (!head) throw new DemoScopeError('A demo insert needs a column list.');
  const afterOpen = head[1]!.length;
  const close = sql.indexOf(')', afterOpen);
  if (close < 0) throw new DemoScopeError('A demo insert needs a column list.');
  const cols = sql.slice(afterOpen, close);
  if (/\bdemo_session_id\b/i.test(cols)) return sql;
  const rest = sql.slice(close + 1);
  const values = /^(\s*VALUES\s*\()/i.exec(rest);
  const select = /^(\s*SELECT\s+(?:DISTINCT\s+)?)/i.exec(rest);
  let tail: string;
  if (values) {
    // One row only: a second VALUES tuple would be short of a column and fail, which is the point.
    tail = `${values[1]}'${key}', ${rest.slice(values[1]!.length)}`;
  } else if (select) {
    tail = `${select[1]}'${key}', ${rest.slice(select[1]!.length)}`;
  } else {
    throw new DemoScopeError('A demo insert needs VALUES or SELECT.');
  }
  return `${sql.slice(0, afterOpen)}demo_session_id, ${cols}${')'}${tail}`;
}

/** env.DB for a demo request: the same database, every statement scoped to the session. */
export function scopedDb(db: D1Database, key: string | null): D1Database {
  assertKey(key);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') return (sql: string) => target.prepare(scopeSql(sql, key));
      if (prop === 'exec') return () => Promise.reject(new DemoScopeError('exec is not available in a demo session.'));
      if (prop === 'withSession') return () => scopedDb(target, key);
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
