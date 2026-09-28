import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { todayIsrael } from '../../core/db';
import * as driveImport from './drive-import';
import { readFile } from './files';
import * as service from './service';
import type { Deps } from './service';
import {
  CategoryInputSchema,
  CategoryUpdateSchema,
  EXPENSE_STATUSES,
  type ExpenseStatus,
  ExpenseAccountantUpdateSchema,
  ExpenseUpdateSchema,
  StatusUpdateSchema,
  SupplierInputSchema,
} from './types';

function idParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Expected a positive integer id.');
  return id;
}

function isStatus(value: string | undefined): value is ExpenseStatus {
  return value !== undefined && (EXPENSE_STATUSES as readonly string[]).includes(value);
}

const listQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const driveRootFolderInput = z.object({ folderId: z.string().trim().min(1) });
const importMonthInput = z.object({ yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() });
const dailySyncInput = z.object({ enabled: z.boolean() });
const indexTitleInput = z.object({ pattern: z.string().trim().min(1).max(200) });

/** Builds the /expenses router. `resolveDeps` reads env at request time (Drive, extractor and FX need secrets/bindings). */
export function createExpensesRoutes(resolveDeps: (env: AppEnv['Bindings']) => Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireFeature('expenses'));

  app.get('/', async (c) => {
    const q = c.req.query();
    const status = isStatus(q.status) ? q.status : undefined;
    const parsed = listQuerySchema.parse(q);
    const rows = await service.listExpenses(c.env.DB, { status, ...parsed });
    return c.json({ expenses: rows });
  });

  app.get('/next', async (c) => {
    const exclude = c.req.query('excludeId');
    const row = await service.nextForReview(c.env.DB, exclude ? idParam(exclude) : undefined);
    return c.json({ expense: row });
  });

  app.get('/suppliers', async (c) => c.json({ suppliers: await service.listSuppliers(c.env.DB) }));

  app.post('/suppliers', requireRole('owner'), async (c) => {
    const input = SupplierInputSchema.parse(await c.req.json());
    const supplier = await service.createSupplier(c.env.DB, input, actorFrom(c));
    return c.json({ supplier }, 201);
  });

  app.patch('/suppliers/:id', requireRole('owner'), async (c) => {
    const input = SupplierInputSchema.partial().parse(await c.req.json());
    const supplier = await service.updateSupplier(c.env.DB, idParam(c.req.param('id')), input, actorFrom(c));
    return c.json({ supplier });
  });

  app.get('/categories', async (c) => c.json({ categories: await service.listCategories(c.env.DB, c.req.query('all') === '1') }));

  app.post('/categories', requireRole('owner'), async (c) => {
    const input = CategoryInputSchema.parse(await c.req.json());
    const category = await service.createCategory(c.env.DB, input, actorFrom(c));
    return c.json({ category }, 201);
  });

  app.patch('/categories/:id', requireRole('owner'), async (c) => {
    const input = CategoryUpdateSchema.parse(await c.req.json());
    const category = await service.updateCategory(c.env.DB, idParam(c.req.param('id')), input, actorFrom(c));
    return c.json({ category });
  });

  // docs/accountant-access.md: the accountant's Expenses rights are "view files, set status,
  // set category" only. Creating a new expense record/file is an owner action, same as the
  // Drive ingest route below.
  app.post('/upload', requireRole('owner'), async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Attach a file under the "file" field.');
    const deps = resolveDeps(c.env);
    const expense = await service.ingestFile(
      c.env,
      deps,
      { bytes: await file.arrayBuffer(), filename: file.name, contentType: file.type || 'application/octet-stream', source: 'upload' },
      actorFrom(c),
    );
    return c.json({ expense }, 201);
  });

  app.get('/settings/drive-root-folder', requireRole('owner'), async (c) =>
    c.json({ folderId: await service.getDriveRootFolder(c.env.DB) }),
  );

  app.put('/settings/drive-root-folder', requireRole('owner'), async (c) => {
    const { folderId } = driveRootFolderInput.parse(await c.req.json());
    await service.setDriveRootFolder(c.env.DB, folderId, actorFrom(c));
    return c.json({ folderId });
  });

  // R20: the Settings > Expenses tab reads this in one call.
  app.get('/settings/drive', requireRole('owner'), async (c) =>
    c.json({
      folderId: await driveImport.effectiveDriveRoot(c.env.DB),
      folderIdSaved: (await service.getDriveRootFolder(c.env.DB)) !== null,
      indexTitlePattern: await driveImport.getIndexTitlePattern(c.env.DB),
      dailySync: await driveImport.getDailySync(c.env.DB),
      runs: await driveImport.listImportRuns(c.env.DB),
    }),
  );

  app.put('/settings/drive-daily-sync', requireRole('owner'), async (c) => {
    const { enabled } = dailySyncInput.parse(await c.req.json());
    await driveImport.setDailySync(c.env.DB, enabled, actorFrom(c));
    return c.json({ dailySync: enabled });
  });

  app.put('/settings/drive-index-title', requireRole('owner'), async (c) => {
    const { pattern } = indexTitleInput.parse(await c.req.json());
    await driveImport.setIndexTitlePattern(c.env.DB, pattern, actorFrom(c));
    return c.json({ indexTitlePattern: pattern });
  });

  app.get('/import/runs', requireRole('owner'), async (c) => c.json({ runs: await driveImport.listImportRuns(c.env.DB) }));

  // Import month button. Works whether the daily sync is on or off. Defaults to this month.
  app.post('/import/month', requireRole('owner'), async (c) => {
    const body = importMonthInput.parse(await c.req.json().catch(() => ({})));
    const yearMonth = body.yearMonth ?? todayIsrael().slice(0, 7);
    const summary = await driveImport.importMonth(c.env, resolveDeps(c.env), yearMonth, 'manual', actorFrom(c));
    return c.json({ summary });
  });

  app.get('/files/:id/download', async (c) => {
    const fileId = idParam(c.req.param('id'));
    const file = await service.getExpenseFile(c.env.DB, fileId);
    const object = await readFile(c.env, file.r2_key);
    if (!object) throw new NotFoundError('File', fileId);
    return new Response(object.body, {
      headers: { 'Content-Type': file.content_type, 'Content-Disposition': `inline; filename="${file.filename}"` },
    });
  });

  app.get('/:id', async (c) => c.json({ expense: await service.getExpense(c.env.DB, idParam(c.req.param('id'))) }));

  app.patch('/:id', requireRole('owner'), async (c) => {
    const deps = resolveDeps(c.env);
    const input = ExpenseUpdateSchema.parse(await c.req.json());
    const expense = await service.updateExpense(c.env.DB, deps, idParam(c.req.param('id')), input, actorFrom(c));
    return c.json({ expense });
  });

  app.patch('/:id/review', async (c) => {
    const input = ExpenseAccountantUpdateSchema.parse(await c.req.json());
    const expense = await service.updateExpenseCategoryAndNotes(c.env.DB, idParam(c.req.param('id')), input, actorFrom(c));
    return c.json({ expense });
  });

  app.post('/:id/status', async (c) => {
    const input = StatusUpdateSchema.parse(await c.req.json());
    const expense = await service.setStatus(c.env.DB, idParam(c.req.param('id')), input, actorFrom(c));
    return c.json({ expense });
  });

  return app;
}
