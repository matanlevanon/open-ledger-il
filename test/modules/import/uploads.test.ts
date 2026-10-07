import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { sqlError } from '../../helpers';
import { buildAppWithUpload, call, env, json, uploadForm } from './helpers';

interface UploadResult {
  uploadId: number;
  extraction: Record<string, unknown>;
  extractionError: string | null;
}

function pdfBytes(): ArrayBuffer {
  return new TextEncoder().encode('%PDF-1.4 fake external document').buffer as ArrayBuffer;
}

function extracted(originalNumber: string) {
  return {
    source: 'sumit',
    documentType: 'Tax invoice',
    originalNumber,
    issueDate: '2026-09-23',
    clientName: 'Example Client',
    clientTaxId: null,
    currency: 'USD',
    amountBeforeVat: '300.00',
    vatAmount: '0',
    total: '300.00',
    exchangeRate: '3.7000',
    totalIls: null,
    paidStatus: 'paid',
  };
}

function fileBody(uploadId: number, originalNumber: string) {
  return { uploadId, clientId: null, ...extracted(originalNumber) };
}

/** external_documents is append-only (no delete either); every test uses its own originalNumber,
 * the way other suites use random client names, instead of clearing the table between tests. */
let counter = 0;
function uniqueNumber(): string {
  counter += 1;
  return `40${String(counter).padStart(3, '0')}`;
}

describe('import: upload existing documents (R17 task 7)', () => {
  beforeEach(async () => {
    // Only unconsumed uploads: a filed one is referenced by its external_documents row.
    await run(env.DB, 'DELETE FROM external_document_uploads WHERE filed_document_id IS NULL');
  });

  it('uploads a file, extracts its fields and stores it in R2', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'invoice.pdf': extracted(number) });
    const res = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'invoice.pdf', 'application/pdf') });
    expect(res.status).toBe(201);
    const body = (await res.json()) as UploadResult;
    expect(body.extraction).toMatchObject(extracted(number));
    expect(body.extractionError).toBeNull();

    const row = await env.DB.prepare('SELECT * FROM external_document_uploads WHERE id = ?').bind(body.uploadId).first<{ r2_key: string }>();
    expect(row).toBeTruthy();
    const object = await env.FILES.get(row!.r2_key);
    expect(object).not.toBeNull();
  });

  it('returns empty fields for manual entry when extraction fails', async () => {
    const app = buildAppWithUpload();
    const res = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'unknown.pdf', 'application/pdf') });
    const body = (await res.json()) as UploadResult;
    expect(body.extraction.source).toBeNull();
    expect(body.extraction.total).toBeNull();
  });

  it('files a reviewed upload, immutable from then on', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'invoice.pdf': extracted(number) });
    const uploaded = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'invoice.pdf', 'application/pdf') });
    const { uploadId } = (await uploaded.json()) as UploadResult;

    const res = await call(app, '/uploads/file', json(fileBody(uploadId, number)));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: { id: number; source: string; total_minor: number; total_ils_minor: number | null } };
    expect(body.document.source).toBe('sumit');
    expect(body.document.total_minor).toBe(30000);
    // The ILS total comes from the rate printed on the document, never an assumed one.
    expect(body.document.total_ils_minor).toBe(111000);

    const updateError = await sqlError("UPDATE external_documents SET r2_key = 'other' WHERE id = ?", body.document.id);
    expect(updateError).toContain('append_only');
    const deleteError = await sqlError('DELETE FROM external_documents WHERE id = ?', body.document.id);
    expect(deleteError).toContain('append_only');
  });

  it('rejects a duplicate (source, originalNumber)', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'invoice.pdf': extracted(number) });
    const first = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'invoice.pdf', 'application/pdf') });
    const { uploadId: firstId } = (await first.json()) as UploadResult;
    await call(app, '/uploads/file', json(fileBody(firstId, number)));

    const second = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'invoice2.pdf', 'application/pdf') });
    const { uploadId: secondId } = (await second.json()) as UploadResult;
    const res = await call(app, '/uploads/file', json(fileBody(secondId, number)));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('duplicate_external_document');
  });

  it('corrects a filed document through the API, audits it, and keeps the file frozen', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'fix.pdf': extracted(number) });
    const uploaded = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'fix.pdf', 'application/pdf') });
    const { uploadId } = (await uploaded.json()) as UploadResult;
    const filed = (await (await call(app, '/uploads/file', json(fileBody(uploadId, number)))).json()) as { document: { id: number } };
    const res = await call(app, `/external-documents/${filed.document.id}`, { ...json({ issueDate: '2026-08-01', paidStatus: 'unpaid' }), method: 'PATCH' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { issue_date: string; paid_status: string } };
    expect(body.document).toMatchObject({ issue_date: '2026-08-01', paid_status: 'unpaid' });
    const audit = await env.DB.prepare("SELECT details FROM audit_log WHERE action = 'external_document.update' AND entity_id = ? ORDER BY id DESC")
      .bind(String(filed.document.id))
      .first<{ details: string }>();
    expect(audit?.details).toContain('2026-08-01');
  });

  it('files a quote and a payment request with the same number as two documents', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'quote.pdf': extracted(number), 'request.pdf': extracted(number) });
    const quote = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'quote.pdf', 'application/pdf') });
    const { uploadId: quoteId } = (await quote.json()) as UploadResult;
    const filedQuote = await call(app, '/uploads/file', json({ ...fileBody(quoteId, number), documentType: 'Quote' }));
    expect(filedQuote.status).toBe(201);

    const request = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'request.pdf', 'application/pdf') });
    const { uploadId: requestId } = (await request.json()) as UploadResult;
    const filedRequest = await call(app, '/uploads/file', json({ ...fileBody(requestId, number), documentType: 'Payment Request' }));
    expect(filedRequest.status).toBe(201);
  });

  it('lists filed documents, optionally filtered by client', async () => {
    const number = uniqueNumber();
    const app = buildAppWithUpload({ 'invoice.pdf': extracted(number) });
    const uploaded = await call(app, '/uploads', { method: 'POST', body: uploadForm(pdfBytes(), 'invoice.pdf', 'application/pdf') });
    const { uploadId } = (await uploaded.json()) as UploadResult;
    await call(app, '/uploads/file', json(fileBody(uploadId, number)));
    const res = await call(app, '/external-documents', {});
    const body = (await res.json()) as { documents: { original_number: string }[] };
    expect(body.documents.map((d) => d.original_number)).toContain(number);
  });
});
