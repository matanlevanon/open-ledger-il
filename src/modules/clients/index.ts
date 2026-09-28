import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { todayIsrael } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { clientLedger } from '../documents/balances';
import { clientInput, clientListQuery, clientPatch, consentPatch, contactInput, contactPatch, ledgerQuery } from './schemas';
import {
  addContact,
  clientDetail,
  createClient,
  getClient,
  listClients,
  removeContact,
  setActive,
  updateClient,
  updateContact,
} from './service';

function num(c: Context<AppEnv>, name: string): number {
  const v = Number(c.req.param(name));
  if (!Number.isSafeInteger(v) || v <= 0) throw new NotFoundError(name === 'id' ? 'Client' : 'Contact', c.req.param(name));
  return v;
}

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

export interface ClientsModuleOptions {
  today?: () => string;
}

/** Routes under /api/clients. Reads need the `clients` feature. Writes are owner only. */
export function createClientsModule(options: ClientsModuleOptions = {}): ModuleDef {
  const today = options.today ?? (() => todayIsrael());
  const r = new Hono<AppEnv>();

  r.get('/', requireFeature('clients'), async (c) => {
    const q = clientListQuery.parse(c.req.query());
    return c.json({ clients: await listClients(c.env.DB, q, today()) });
  });

  r.post('/', requireRole('owner'), async (c) => {
    const raw = await body(c);
    const { consent } = consentPatch.parse(raw);
    const id = await createClient(c.env.DB, actorFrom(c), clientInput.parse(raw), consent);
    return c.json(await clientDetail(c.env.DB, id), 201);
  });

  r.get('/:id', requireFeature('clients'), async (c) => c.json(await clientDetail(c.env.DB, num(c, 'id'))));

  r.patch('/:id', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    const raw = await body(c);
    const { consent } = consentPatch.parse(raw);
    await updateClient(c.env.DB, actorFrom(c), id, clientPatch.parse(raw), consent);
    return c.json(await clientDetail(c.env.DB, id));
  });

  r.post('/:id/activate', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    await setActive(c.env.DB, actorFrom(c), id, true);
    return c.json(await clientDetail(c.env.DB, id));
  });

  r.post('/:id/deactivate', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    await setActive(c.env.DB, actorFrom(c), id, false);
    return c.json(await clientDetail(c.env.DB, id));
  });

  r.post('/:id/contacts', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    await addContact(c.env.DB, actorFrom(c), id, contactInput.parse(await body(c)));
    return c.json(await clientDetail(c.env.DB, id), 201);
  });

  r.patch('/:id/contacts/:contactId', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    await updateContact(c.env.DB, actorFrom(c), id, num(c, 'contactId'), contactPatch.parse(await body(c)));
    return c.json(await clientDetail(c.env.DB, id));
  });

  r.delete('/:id/contacts/:contactId', requireRole('owner'), async (c) => {
    const id = num(c, 'id');
    await removeContact(c.env.DB, actorFrom(c), id, num(c, 'contactId'));
    return c.json(await clientDetail(c.env.DB, id));
  });

  /** Client book (תוספת ה׳): every document and payment with a running balance per currency. */
  r.get('/:id/ledger', requireFeature('clients'), async (c) => {
    const id = num(c, 'id');
    const client = await getClient(c.env.DB, id);
    const q = ledgerQuery.parse(c.req.query());
    if (q.from && q.to && q.from > q.to) throw new ValidationError('The start date is after the end date.');
    const ledger = await clientLedger(c.env.DB, id, q.from, q.to, true);
    return c.json({ client: { id: client.id, name_en: client.name_en, name_he: client.name_he }, ...ledger });
  });

  return { name: 'clients', basePath: '/clients', routes: r };
}

export const clientsModule = createClientsModule();
