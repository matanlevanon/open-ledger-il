import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv, Env } from '../../env';
import {
  cancelInput,
  convertInput,
  creditInput,
  draftInput,
  draftPatch,
  finalizeInput,
  listQuery,
  recordPaymentInput,
  sentInput,
} from './schemas';
import {
  type Ctx,
  type Services,
  assertCanSeeType,
  cancelDocument,
  convertDocument,
  createDraft,
  creditDocument,
  deleteDraft,
  finalize,
  markSent,
  recordPayment,
  reviseDocument,
  updateDraft,
} from './service';
import { listTypes } from './types';
import { documentView, listDocuments } from './views';
import { getDoc } from './repo';

export type ServiceFactory = (env: Env) => Services;

function idParam(c: Context<AppEnv>): number {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError('Document', c.req.param('id'));
  return id;
}

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

/** Routes under /api/documents. Reads need `income_documents`. Writes need `issue_documents` (owner only). */
export function documentRoutes(services: ServiceFactory): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const ctx = (c: Context<AppEnv>): Ctx => ({ db: c.env.DB, actor: actorFrom(c), user: c.get('user'), services: services(c.env) });
  const view = async (c: Context<AppEnv>, id: number) => documentView(c.env.DB, id, services(c.env).today());

  r.get('/types', requireFeature('income_documents'), async (c) => c.json({ types: await listTypes(c.env.DB) }));

  r.get('/', requireFeature('income_documents'), async (c) => {
    const q = listQuery.parse(c.req.query());
    return c.json(await listDocuments(c.env.DB, c.get('user'), q, services(c.env).today()));
  });

  r.post('/', requireFeature('issue_documents'), async (c) => {
    const id = await createDraft(ctx(c), draftInput.parse(await body(c)));
    return c.json(await view(c, id), 201);
  });

  r.get('/:id', requireFeature('income_documents'), async (c) => {
    const id = idParam(c);
    assertCanSeeType(c.get('user'), (await getDoc(c.env.DB, id)).type);
    return c.json(await view(c, id));
  });

  r.patch('/:id', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c);
    await updateDraft(ctx(c), id, draftPatch.parse(await body(c)));
    return c.json(await view(c, id));
  });

  r.delete('/:id', requireFeature('issue_documents'), async (c) => {
    await deleteDraft(ctx(c), idParam(c));
    return c.json({ ok: true });
  });

  r.post('/:id/finalize', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c);
    const input = finalizeInput.parse(await body(c));
    const outcome = await finalize(ctx(c), id, { backdateReason: input.backdateReason });
    return c.json({ ...(await view(c, id)), already_final: outcome.alreadyFinal });
  });

  r.post('/:id/convert', requireFeature('issue_documents'), async (c) => {
    const input = convertInput.parse(await body(c));
    const newId = await convertDocument(ctx(c), idParam(c), input);
    return c.json(await view(c, newId), 201);
  });

  r.post('/:id/record-payment', requireFeature('issue_documents'), async (c) => {
    const input = recordPaymentInput.parse(await body(c));
    const { receiptId } = await recordPayment(ctx(c), idParam(c), input);
    return c.json(await view(c, receiptId), 201);
  });

  r.post('/:id/revise', requireFeature('issue_documents'), async (c) => {
    const newId = await reviseDocument(ctx(c), idParam(c));
    return c.json(await view(c, newId), 201);
  });

  r.post('/:id/cancel', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c);
    await cancelDocument(ctx(c), id, cancelInput.parse(await body(c)).reason);
    return c.json(await view(c, id));
  });

  r.post('/:id/credit', requireFeature('issue_documents'), async (c) => {
    const input = creditInput.parse(await body(c));
    const { creditId } = await creditDocument(ctx(c), idParam(c), input);
    return c.json(await view(c, creditId), 201);
  });

  r.post('/:id/sent', requireFeature('issue_documents'), async (c) => {
    const id = idParam(c);
    await markSent(ctx(c), id, sentInput.parse(await body(c)));
    return c.json(await view(c, id));
  });

  return r;
}
