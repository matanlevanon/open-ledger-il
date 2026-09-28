import type { Context } from 'hono';
import { Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import * as service from './service';
import { setSeriesStartSchema, waveCustomerMappingSchema, waveInvoiceMappingSchema } from './types';
import { type UploadDeps, fileExternalDocument, linkReceipt, listExternalDocuments, updateExternalDocument, uploadExternalDocument } from './upload-service';
import { FileExternalDocSchema, LinkReceiptSchema, UpdateExternalDocSchema } from './upload-types';

interface Upload {
  bytes: ArrayBuffer;
  filename: string;
  mapping?: Record<string, string | null | undefined>;
}

/** Reads the multipart body once: the "file" field, and an optional JSON "mapping" field. */
async function readUpload(c: Context<AppEnv>, mappingSchema?: typeof waveCustomerMappingSchema): Promise<Upload> {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ValidationError('Attach a file under the "file" field.');
  const rawMapping = form.get('mapping');
  const mapping =
    mappingSchema && typeof rawMapping === 'string' && rawMapping.trim() ? mappingSchema.parse(JSON.parse(rawMapping)) : undefined;
  return { bytes: await file.arrayBuffer(), filename: file.name, mapping };
}

export function createImportRoutes(resolveUploadDeps: (env: AppEnv['Bindings']) => UploadDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole('owner'));

  app.get('/series', async (c) => c.json({ series: await service.listSeries(c.env.DB) }));

  app.post('/series/:id/start', async (c) => {
    const input = setSeriesStartSchema.parse(await c.req.json());
    const series = await service.confirmSeriesStart(c.env.DB, actorFrom(c), c.req.param('id'), input.startNumber, input.note ?? null);
    return c.json({ series });
  });

  app.get('/history', async (c) => {
    const q = c.req.query();
    const source = q.source === 'wave' || q.source === 'sumit' ? q.source : undefined;
    const history = await service.listHistory(c.env.DB, {
      source,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
    return c.json({ history });
  });

  app.post('/wave/customers/preview', async (c) => {
    const { bytes } = await readUpload(c);
    return c.json(service.previewWaveCustomers(bytes));
  });

  app.post('/wave/customers/commit', async (c) => {
    const { bytes, filename, mapping } = await readUpload(c, waveCustomerMappingSchema);
    const summary = await service.commitWaveCustomers(c.env.DB, actorFrom(c), bytes, filename, mapping);
    return c.json({ summary });
  });

  app.post('/wave/invoices/preview', async (c) => {
    const { bytes } = await readUpload(c);
    return c.json(service.previewWaveInvoices(bytes));
  });

  app.post('/wave/invoices/commit', async (c) => {
    const { bytes, filename, mapping } = await readUpload(c, waveInvoiceMappingSchema);
    const summary = await service.commitWaveInvoices(c.env.DB, actorFrom(c), bytes, filename, mapping);
    return c.json({ summary });
  });

  app.post('/sumit/unified/preview', async (c) => {
    const { bytes } = await readUpload(c);
    return c.json(service.previewSumitUnified(bytes));
  });

  app.post('/sumit/unified/commit', async (c) => {
    const { bytes, filename } = await readUpload(c);
    const summary = await service.commitSumitUnified(c.env.DB, actorFrom(c), bytes, filename);
    return c.json({ summary });
  });

  // R17 task 7: "Upload existing documents", a document issued in another system before this
  // ledger existed. Two steps: upload (stores the file, runs extraction) then file (confirms or
  // corrects the fields, matches the client, freezes the row).
  app.post('/uploads', async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Attach a file under the "file" field.');
    const deps = resolveUploadDeps(c.env);
    const result = await uploadExternalDocument(
      c.env.DB,
      deps.files,
      deps.extractor,
      actorFrom(c),
      { bytes: await file.arrayBuffer(), contentType: file.type || 'application/pdf', filename: file.name },
    );
    return c.json(result, 201);
  });

  app.post('/uploads/file', async (c) => {
    const input = FileExternalDocSchema.parse(await c.req.json());
    const deps = resolveUploadDeps(c.env);
    const document = await fileExternalDocument(c.env.DB, deps.fx, actorFrom(c), input);
    return c.json({ document }, 201);
  });

  /** Corrects a filed past document's fields. Its PDF and source stay as filed. */
  app.patch('/external-documents/:id', async (c) => {
    const input = UpdateExternalDocSchema.parse(await c.req.json());
    const deps = resolveUploadDeps(c.env);
    const document = await updateExternalDocument(c.env.DB, deps.fx, actorFrom(c), Number(c.req.param('id')), input);
    return c.json({ document });
  });

  /** Links a receipt in this ledger to the imported document it pays. */
  app.post('/external-documents/:id/receipts', async (c) => {
    const { documentId } = LinkReceiptSchema.parse(await c.req.json());
    await linkReceipt(c.env.DB, actorFrom(c), Number(c.req.param('id')), documentId);
    return c.json({ ok: true }, 201);
  });

  /** The original PDF of a filed past document, shown inline. */
  app.get('/external-documents/:id/file', async (c) => {
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT r2_key, original_number FROM external_documents WHERE id = ?').bind(id).first<{ r2_key: string; original_number: string }>();
    if (!row) throw new NotFoundError('Document', id);
    const object = await c.env.FILES.get(row.r2_key);
    if (!object) throw new NotFoundError('Document file', id);
    return new Response(object.body, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${row.original_number.replace(/[^\w.-]/g, '_')}.pdf"` },
    });
  });

  app.get('/external-documents', async (c) => {
    const q = c.req.query();
    const documents = await listExternalDocuments(c.env.DB, {
      clientId: q.clientId ? Number(q.clientId) : undefined,
      from: q.from,
      to: q.to,
    });
    return c.json({ documents });
  });

  return app;
}
