import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { ProviderBusyError } from '../../../src/modules/ai';
import type { Extractor, ExtractInput } from '../../../src/modules/expenses/extractor';
import { noteWithNotRead, noteWithoutNotRead } from '../../../src/modules/expenses/service';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, json, uploadForm } from './helpers';

/** R39 task 3: Read again on an expense the reader could not read. */

const fields: ExtractedExpense = {
  supplierName: 'Reread Ltd',
  supplierId: '515000001',
  documentNumber: 'RR-1',
  date: '2026-09-15',
  currency: 'ILS',
  amount: '236.00',
  vatAmount: '36.00',
  documentType: 'Tax invoice',
};

/** Fails until `answer` is set. Records what it was given. */
class SwitchExtractor implements Extractor {
  answer: ExtractedExpense | null = null;
  error: Error = new Error('Gemini is busy right now (HTTP 503). High demand.');
  configured = true;
  calls: ExtractInput[] = [];
  available(): boolean {
    return this.configured;
  }
  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    this.calls.push(input);
    if (!this.answer) throw this.error;
    return this.answer;
  }
}

async function unreadUpload(app: ReturnType<typeof buildApp>, name: string, text = `${name}-${crypto.randomUUID()}`, type = 'application/pdf'): Promise<ExpenseRow> {
  const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom(text), name, type) });
  const body = (await res.json()) as { expense: ExpenseRow; read: boolean };
  expect(body.read).toBe(false);
  return body.expense;
}

async function readAgain(app: ReturnType<typeof buildApp>, id: number, envOverride: Record<string, unknown> = {}) {
  const res = await call(app, `/${id}/read`, { method: 'POST' }, envOverride);
  return { status: res.status, body: (await res.json()) as { expense: ExpenseRow; read: boolean; message: string | null; error?: { code: string; message: string } } };
}

describe('R39: Read again', () => {
  let extractor: SwitchExtractor;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'UPDATE expense_files SET expense_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await run(env.DB, 'DELETE FROM expense_files');
    extractor = new SwitchExtractor();
    app = buildApp({ extractor });
  });

  it('fills the fields, marks it read, clears the reason and audits it', async () => {
    const unread = await unreadUpload(app, 'r.pdf');
    await run(env.DB, 'UPDATE expenses SET notes = ? WHERE id = ?', `${unread.notes} | Paid by card`, unread.id);
    extractor.answer = fields;

    const { status, body } = await readAgain(app, unread.id);
    expect(status).toBe(200);
    expect(body.read).toBe(true);
    expect(body.message).toBeNull();
    expect(body.expense).toMatchObject({
      status: 'new',
      document_number: 'RR-1',
      document_date: '2026-09-15',
      document_type: 'Tax invoice',
      currency: 'ILS',
      amount_minor: 23600,
      vat_amount_minor: 3600,
      amount_ils_minor: 23600,
      read_status: 'read',
      read_attempts: 2,
      read_error: null,
      notes: 'Paid by card',
    });
    expect(body.expense.read_at).not.toBeNull();
    const supplier = await env.DB.prepare('SELECT name FROM suppliers WHERE id = ?').bind(body.expense.supplier_id).first<{ name: string }>();
    expect(supplier?.name).toBe('Reread Ltd');
    const audit = await env.DB.prepare("SELECT details FROM audit_log WHERE action = 'expense.reread' AND entity_id = ?").bind(String(unread.id)).first<{ details: string }>();
    expect(JSON.parse(audit!.details)).toMatchObject({ read: true, attempts: 2 });
  });

  it('keeps every field the person already typed', async () => {
    const unread = await unreadUpload(app, 'typed.pdf');
    await call(app, `/${unread.id}`, json({ amount: '50.00', currency: 'ILS', documentNumber: 'MINE-7', documentDate: '2026-08-01' }, { method: 'PATCH' }));
    extractor.answer = fields;

    const { body } = await readAgain(app, unread.id);
    expect(body.expense).toMatchObject({
      amount_minor: 5000,
      document_number: 'MINE-7',
      document_date: '2026-08-01',
      vat_amount_minor: 3600,
      document_type: 'Tax invoice',
      read_status: 'read',
    });
  });

  it('a failed read answers 200 with the reason, counts the attempt and stays New', async () => {
    const unread = await unreadUpload(app, 'again.pdf');
    extractor.error = new ProviderBusyError('Anthropic', 529, 'Overloaded');

    const { status, body } = await readAgain(app, unread.id);
    expect(status).toBe(200);
    expect(body.read).toBe(false);
    expect(body.message).toBe('Anthropic is busy right now (HTTP 529). Overloaded');
    expect(body.expense).toMatchObject({
      status: 'new',
      read_status: 'failed',
      read_attempts: 2,
      read_error: 'Anthropic is busy right now (HTTP 529). Overloaded',
      notes: 'Not read automatically: Anthropic is busy right now (HTTP 529). Overloaded',
      amount_minor: 0,
    });
  });

  it('runs the duplicate check as upload does', async () => {
    const first = await unreadUpload(app, 'one.pdf');
    extractor.answer = fields;
    await readAgain(app, first.id);
    extractor.answer = null;
    const second = await unreadUpload(app, 'two.pdf');
    extractor.answer = fields;

    const { body } = await readAgain(app, second.id);
    expect(body.read).toBe(true);
    expect(body.expense).toMatchObject({ status: 'duplicate', duplicate_of_id: first.id, read_status: 'read' });
  });

  it('reads a stored email body as its text', async () => {
    const unread = await unreadUpload(app, 'email-2026-10-20.html', '<p>Total <b>236.00</b></p>', 'text/html');
    extractor.answer = fields;
    await readAgain(app, unread.id);
    const last = extractor.calls.at(-1)!;
    expect(last.contentType).toBe('text/plain');
    expect(new TextDecoder().decode(last.bytes)).toBe('Total 236.00');
  });

  it('refuses an expense that was read, filed, or has no file', async () => {
    extractor.answer = fields;
    const read = ((await (await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('read ok'), 'ok.pdf', 'application/pdf') })).json()) as { expense: ExpenseRow }).expense;
    const refused = await readAgain(app, read.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe('expense_not_rereadable');

    extractor.answer = null;
    const filed = await unreadUpload(app, 'filed.pdf');
    await call(app, `/${filed.id}/status`, json({ status: 'filed' }));
    expect((await readAgain(app, filed.id)).status).toBe(409);

    const { lastRowId } = await run(env.DB, "INSERT INTO expenses (status, document_date, business_id, read_status, read_attempts) VALUES ('new', '2026-10-01', 1, 'failed', 1)");
    expect((await readAgain(app, lastRowId)).body.error?.code).toBe('expense_not_rereadable');
  });

  it('with no AI key says so, and changes nothing', async () => {
    const unread = await unreadUpload(app, 'nokey.pdf');
    extractor.configured = false;
    const { status, body } = await readAgain(app, unread.id);
    expect(status).toBe(409);
    expect(body.error?.message).toBe('No AI key is set. Add one in Settings, or type the fields.');
    const row = await env.DB.prepare('SELECT read_attempts FROM expenses WHERE id = ?').bind(unread.id).first<{ read_attempts: number }>();
    expect(row?.read_attempts).toBe(1);
  });

  it('is for the owner and the assistant, not the accountant', async () => {
    const unread = await unreadUpload(app, 'acct.pdf');
    expect((await readAgain(app, unread.id, ACCOUNTANT_ENV)).status).toBe(403);
  });
});

describe('R39: the "Not read automatically" part of a note', () => {
  it('is removed, and the rest stays', () => {
    expect(noteWithoutNotRead('Not read automatically: busy')).toBeNull();
    expect(noteWithoutNotRead('Email from a@b.c: Invoice | Not read automatically: busy')).toBe('Email from a@b.c: Invoice');
    expect(noteWithoutNotRead('Not read automatically: busy | Paid by card')).toBe('Paid by card');
    expect(noteWithoutNotRead('A | Not read automatically: busy | B')).toBe('A | B');
    expect(noteWithoutNotRead('Not read automatically: busy\nCall the supplier')).toBe('Call the supplier');
    expect(noteWithoutNotRead(null)).toBeNull();
  });

  it('gets the new reason in place, or is added', () => {
    expect(noteWithNotRead('A | Not read automatically: old | B', 'new')).toBe('A | Not read automatically: new | B');
    expect(noteWithNotRead('Paid by card', 'new')).toBe('Paid by card | Not read automatically: new');
    expect(noteWithNotRead(null, 'a | b')).toBe('Not read automatically: a / b');
  });
});
