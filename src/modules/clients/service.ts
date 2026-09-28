import { type AuditActor, auditStatement } from '../../core/audit';
import { all, first, nowIso, stmt, transaction, type SqlValue } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { clientBalances, openDemands } from '../documents/balances';
import { uploadService } from '../import';
import { manualConsentDetail, manualConsentStatement } from '../sending/consent';
import { hasClientName, NO_NAME_MESSAGE, type ClientInput, type ClientPatch, type ConsentInput, type ContactInput } from './schemas';

export interface ClientRow {
  id: number;
  name_en: string;
  name_he: string | null;
  company_id: string | null;
  vat_number: string | null;
  country: string;
  foreign_resident: number;
  currency: string;
  client_copy_lang: 'en' | 'bilingual';
  email: string | null;
  phone: string | null;
  address_en: string | null;
  address_he: string | null;
  notes: string | null;
  payment_instructions: string | null;
  archived_at: string | null;
  /** R18 task 6, replacing archived_at as the field the app reads: default active. */
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: number;
  client_id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: number;
}

/** Input field to column. Order matters for INSERT. */
const COLUMNS: [keyof ClientInput, keyof ClientRow][] = [
  ['nameEn', 'name_en'],
  ['nameHe', 'name_he'],
  ['companyId', 'company_id'],
  ['vatNumber', 'vat_number'],
  ['country', 'country'],
  ['foreignResident', 'foreign_resident'],
  ['currency', 'currency'],
  ['clientCopyLang', 'client_copy_lang'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['addressEn', 'address_en'],
  ['addressHe', 'address_he'],
  ['notes', 'notes'],
  ['paymentInstructions', 'payment_instructions'],
];

export async function getClient(db: D1Database, id: number): Promise<ClientRow> {
  const row = await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ?', id);
  if (!row) throw new NotFoundError('Client', id);
  return row;
}

export async function listClients(db: D1Database, q: { q?: string; active: '0' | '1' | 'all' }, today: string) {
  const where: string[] = [];
  const params: string[] = [];
  if (q.active === '1') where.push('active = 1');
  if (q.active === '0') where.push('active = 0');
  if (q.q) {
    where.push('(name_en LIKE ? OR name_he LIKE ? OR company_id LIKE ? OR email LIKE ?)');
    const like = `%${q.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }
  const rows = await all<ClientRow>(
    db,
    // R19: a client may have only a Hebrew name; sort by the resolved display name (name_en,
    // falling back to name_he), not by name_en alone, so a Hebrew-only client is not stuck at
    // the top under an empty string.
    `SELECT * FROM clients ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(NULLIF(name_en, ''), name_he) COLLATE NOCASE`,
    ...params,
  );
  const balances = await clientBalances(db);
  const overdue = new Map<number, Record<string, number>>();
  for (const d of await openDemands(db)) {
    if (d.client_id === null || !d.due_date || d.due_date >= today) continue;
    const t = overdue.get(d.client_id) ?? {};
    t[d.currency] = (t[d.currency] ?? 0) + d.remaining_minor;
    overdue.set(d.client_id, t);
  }
  return rows.map((r) => ({ ...r, balances: balances.get(r.id) ?? {}, overdue: overdue.get(r.id) ?? {} }));
}

export async function clientDetail(db: D1Database, id: number) {
  const client = await getClient(db, id);
  const contacts = await all<ContactRow>(db, 'SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC, id', id);
  const balances = (await clientBalances(db)).get(id) ?? {};
  const consent = await manualConsentDetail(db, id);
  // R17 task 7: documents uploaded from another system (SUMIT, Wave, other), labeled by source.
  const externalDocuments = await uploadService.listExternalDocuments(db, { clientId: id });
  return { client, contacts, balances, consent, externalDocuments };
}

/** Writes a consent row plus its own audit entry. Called after the client id is known. */
async function writeConsent(db: D1Database, actor: AuditActor, clientId: number, consent: ConsentInput): Promise<void> {
  await transaction(db, [
    manualConsentStatement(db, clientId, consent),
    auditStatement(db, actor, consent.granted ? 'client.consent_grant' : 'client.consent_revoke', 'client', clientId, {
      source: consent.granted ? consent.source : null,
      date: consent.date,
    }),
  ]);
}

/** `clients.name_en` is `NOT NULL`; a missing English name stores '' there, never NULL. */
function columnValue(key: keyof ClientInput, value: SqlValue | boolean | undefined): SqlValue | boolean {
  return key === 'nameEn' ? value ?? '' : value ?? null;
}

export async function createClient(db: D1Database, actor: AuditActor, input: ClientInput, consent?: ConsentInput | null): Promise<number> {
  const cols = COLUMNS.map(([, col]) => col);
  const values = COLUMNS.map(([key]) => columnValue(key, input[key]));
  const results = await transaction(db, [
    stmt(db, `INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...values),
    auditStatement(db, actor, 'client.create', 'client', null, { nameEn: input.nameEn }),
  ]);
  const id = results[0]!.meta.last_row_id;
  if (consent) await writeConsent(db, actor, id, consent);
  return id;
}

export async function updateClient(
  db: D1Database,
  actor: AuditActor,
  id: number,
  patch: ClientPatch,
  consent?: ConsentInput | null,
): Promise<void> {
  const current = await getClient(db, id);
  const nextNameEn = patch.nameEn !== undefined ? patch.nameEn : current.name_en;
  const nextNameHe = patch.nameHe !== undefined ? patch.nameHe : current.name_he;
  if (!hasClientName({ nameEn: nextNameEn, nameHe: nextNameHe })) throw new ValidationError(NO_NAME_MESSAGE);
  const set = COLUMNS.filter(([key]) => patch[key] !== undefined);
  if (set.length > 0) {
    await transaction(db, [
      stmt(
        db,
        `UPDATE clients SET ${set.map(([, col]) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...set.map(([key]) => columnValue(key, patch[key])),
        nowIso(),
        id,
      ),
      auditStatement(db, actor, 'client.update', 'client', id, { fields: set.map(([, col]) => col) }),
    ]);
  }
  if (consent) await writeConsent(db, actor, id, consent);
}

/**
 * A client is never deleted, only made not active (R18 task 6, replacing the old archive action).
 * Not-active clients keep all their documents, ledger and reports; they are only hidden from the
 * client picker when creating a document, unless "Show inactive" is ticked.
 */
export async function setActive(db: D1Database, actor: AuditActor, id: number, active: boolean): Promise<void> {
  const client = await getClient(db, id);
  if (active === (client.active === 1)) {
    throw new ConflictError('no_change', active ? 'This client is already active.' : 'This client is already not active.');
  }
  await transaction(db, [
    stmt(db, 'UPDATE clients SET active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, nowIso(), id),
    auditStatement(db, actor, active ? 'client.activate' : 'client.deactivate', 'client', id),
  ]);
}

const CONTACT_COLUMNS: [keyof ContactInput, keyof ContactRow][] = [
  ['name', 'name'],
  ['role', 'role'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['isPrimary', 'is_primary'],
];

export async function addContact(db: D1Database, actor: AuditActor, clientId: number, input: ContactInput): Promise<number> {
  await getClient(db, clientId);
  const statements = [];
  if (input.isPrimary) statements.push(stmt(db, 'UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', clientId));
  statements.push(
    stmt(
      db,
      'INSERT INTO client_contacts (client_id, name, role, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?)',
      clientId,
      input.name,
      input.role ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.isPrimary,
    ),
  );
  const insertAt = statements.length - 1;
  statements.push(auditStatement(db, actor, 'client.contact_add', 'client', clientId, { name: input.name }));
  const results = await transaction(db, statements);
  return results[insertAt]!.meta.last_row_id;
}

async function getContact(db: D1Database, clientId: number, contactId: number): Promise<ContactRow> {
  const row = await first<ContactRow>(db, 'SELECT * FROM client_contacts WHERE id = ? AND client_id = ?', contactId, clientId);
  if (!row) throw new NotFoundError('Contact', contactId);
  return row;
}

export async function updateContact(
  db: D1Database,
  actor: AuditActor,
  clientId: number,
  contactId: number,
  patch: Partial<ContactInput>,
): Promise<void> {
  await getContact(db, clientId, contactId);
  const set = CONTACT_COLUMNS.filter(([key]) => patch[key] !== undefined);
  if (set.length === 0) return;
  await transaction(db, [
    ...(patch.isPrimary ? [stmt(db, 'UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', clientId)] : []),
    stmt(
      db,
      `UPDATE client_contacts SET ${set.map(([, col]) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...set.map(([key]) => patch[key] ?? null),
      nowIso(),
      contactId,
    ),
    auditStatement(db, actor, 'client.contact_update', 'client', clientId, { contactId }),
  ]);
}

export async function removeContact(db: D1Database, actor: AuditActor, clientId: number, contactId: number): Promise<void> {
  await getContact(db, clientId, contactId);
  await transaction(db, [
    stmt(db, 'DELETE FROM client_contacts WHERE id = ?', contactId),
    auditStatement(db, actor, 'client.contact_remove', 'client', clientId, { contactId }),
  ]);
}
