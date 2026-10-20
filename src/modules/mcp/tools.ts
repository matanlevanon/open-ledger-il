import { z } from 'zod';
import type { AuditActor } from '../../core/audit';
import { type AuthUser, FEATURES } from '../../core/auth';
import { legalModeOn } from '../../core/config';
import { all, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { getClient, listClients } from '../clients/service';
import { buildDashboard } from '../dashboard';
import { passThroughAllocationRequester } from '../documents/allocation';
import { clientBalances } from '../documents/balances';
import { passThroughCeilingGuard } from '../documents/ceiling';
import { getDoc } from '../documents/repo';
import { dateString, draftInput, paymentInput } from '../documents/schemas';
import { type Ctx, createDraft, finalize, recordPayment } from '../documents/service';
import { displayNumber } from '../documents/types';
import { boiRateSource } from '../fx';
import type { Env } from '../../env';
import { recordGivenExpense, listExpenses } from '../expenses/service';
import { EXPENSE_STATUSES, ExtractedExpenseSchema } from '../expenses/types';

/** MCP acts as the owner of one business. It has no per-request signed-in user, only the bearer token. */
export function mcpUser(businessId: number): AuthUser {
  return {
    id: 0,
    email: 'mcp',
    name: 'MCP client',
    role: 'owner',
    features: [...FEATURES],
    theme: null,
    locale: null,
    businessId,
    businesses: [{ id: businessId, role: 'owner' }],
  };
}

/** Business 1 unless the call names another with the X-Business-Id header. */
export const MCP_USER: AuthUser = mcpUser(1);

export interface McpEnv {
  db: D1Database;
  actor: AuditActor;
  today?: () => string;
  /** R24: the business every tool reads and writes. */
  businessId: number;
  /** The Worker bindings, for tools that store a file in R2 (add_expense). */
  bindings?: Env;
}

function ctxOf(env: McpEnv): Ctx {
  const today = env.today ?? (() => todayIsrael());
  return {
    db: env.db,
    actor: { ...env.actor, businessId: env.businessId },
    user: mcpUser(env.businessId),
    services: { fx: boiRateSource(env.db), ceiling: passThroughCeilingGuard, today, allocation: passThroughAllocationRequester },
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (env: McpEnv, args: unknown) => Promise<unknown>;
}

const confirmTrue = z
  .boolean()
  .default(false)
  .refine((v) => v === true, 'Set confirm: true to acknowledge this changes the books.');

// ---------------------------------------------------------------------------
// list_clients
// ---------------------------------------------------------------------------

const listClientsInput = z.object({
  query: z.string().trim().max(200).optional(),
  includeInactive: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// client_balance
// ---------------------------------------------------------------------------

const clientBalanceInput = z.object({ clientId: z.number().int().positive() });

// ---------------------------------------------------------------------------
// create_draft
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// finalize_document
// ---------------------------------------------------------------------------

const finalizeDocumentInput = z.object({
  documentId: z.number().int().positive(),
  confirm: confirmTrue,
  backdateReason: z.string().trim().max(500).nullish(),
});

// ---------------------------------------------------------------------------
// record_payment
// ---------------------------------------------------------------------------

const recordPaymentToolInput = z.object({
  documentId: z.number().int().positive(),
  confirm: confirmTrue,
  date: dateString.optional(),
  payments: z.array(paymentInput).min(1).max(50),
  notes: z.string().max(5000).nullish(),
  finalize: z.boolean().default(true),
  backdateReason: z.string().trim().max(500).nullish(),
});

// ---------------------------------------------------------------------------
// income_report
// ---------------------------------------------------------------------------

const incomeReportInput = z.object({ from: dateString, to: dateString });

const INCOME_TYPES = ['400', '405', '305', '320', '330'];

/** A credit (405, 330) is stored with a negative total, so a plain SUM nets it against the sale. */
async function incomeReport(db: D1Database, from: string, to: string, businessId: number) {
  const ilsAmount = `COALESCE(total_ils_minor, CASE WHEN currency = 'ILS' THEN total_minor ELSE NULL END)`;
  const rows = await all<{ currency: string; count: number; total_minor: number; total_ils_minor: number | null }>(
    db,
    `SELECT currency, COUNT(*) AS count, SUM(total_minor) AS total_minor, SUM(${ilsAmount}) AS total_ils_minor
     FROM documents
     WHERE business_id = ? AND status = 'final' AND type IN (${INCOME_TYPES.map(() => '?').join(',')}) AND date BETWEEN ? AND ?
     GROUP BY currency
     ORDER BY currency`,
    businessId,
    ...INCOME_TYPES,
    from,
    to,
  );
  return { from, to, byCurrency: rows };
}

// ---------------------------------------------------------------------------
// add_expense, list_expenses
// ---------------------------------------------------------------------------

/** The decoded file may be at most 10 MB, the same order as an email attachment. */
export const MCP_EXPENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;

const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

const addExpenseInput = ExtractedExpenseSchema.extend({
  note: z.string().trim().max(500).nullish(),
  fileBase64: z.string().max(Math.ceil((MCP_EXPENSE_FILE_MAX_BYTES * 4) / 3) + 8).nullish(),
  filename: z.string().trim().min(1).max(200).nullish(),
});

const listExpensesInput = z.object({
  status: z.enum(EXPENSE_STATUSES).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

function decodeBase64(text: string): ArrayBuffer {
  const clean = text.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new ValidationError('fileBase64 is not valid base64.');
  }
  if (binary.length === 0) throw new ValidationError('fileBase64 is empty.');
  if (binary.length > MCP_EXPENSE_FILE_MAX_BYTES) throw new ValidationError('The file is larger than 10 MB.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function fileTypeOf(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const type = FILE_TYPES[ext];
  if (!type) throw new ValidationError('Send a PDF or an image (png, jpg, webp, gif, heic). Name the file with its extension.');
  return type;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_clients',
    description: 'List clients, with their open balance per currency. Optional text search over name, company id and email.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text.' },
        includeInactive: { type: 'boolean', description: 'Include not-active clients. Default false.' },
      },
    },
    async handler(env, args) {
      const input = listClientsInput.parse(args ?? {});
      const today = (env.today ?? (() => todayIsrael()))();
      const rows = await listClients(env.db, { q: input.query, active: input.includeInactive ? 'all' : '1' }, today, env.businessId);
      return rows.map((r) => ({ id: r.id, nameEn: r.name_en, nameHe: r.name_he, currency: r.currency, balances: r.balances, overdue: r.overdue }));
    },
  },
  {
    name: 'client_balance',
    description: 'Open balance of one client, per currency, from unpaid or partially paid payment requests and transaction invoices.',
    inputSchema: {
      type: 'object',
      properties: { clientId: { type: 'number', description: 'Client id.' } },
      required: ['clientId'],
    },
    async handler(env, args) {
      const input = clientBalanceInput.parse(args);
      const client = await getClient(env.db, input.clientId, env.businessId);
      const balances = (await clientBalances(env.db, env.businessId)).get(input.clientId) ?? {};
      return { clientId: client.id, nameEn: client.name_en, nameHe: client.name_he, currency: client.currency, balances };
    },
  },
  {
    name: 'create_draft',
    description:
      'Create a draft document (quote, payment request, transaction invoice or receipt). Drafts carry no number and change freely; call finalize_document to issue it.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Document type code, for example QT, PR, 300 or 400.' },
        clientId: { type: 'number', description: 'Client id.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        currency: { type: 'string', description: 'ILS, USD, EUR or GBP. Defaults to the client currency.' },
        notes: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantityMilli: { type: 'number', description: 'Quantity x1000, so 1000 = 1.' },
              unitPriceMinor: { type: 'number', description: 'Price in minor units (agorot/cents).' },
              discountMinor: { type: 'number' },
            },
            required: ['description', 'unitPriceMinor'],
          },
        },
      },
      required: ['type'],
    },
    async handler(env, args) {
      const input = draftInput.parse(args);
      const ctx = ctxOf(env);
      const id = await createDraft(ctx, input);
      const doc = await getDoc(env.db, id, env.businessId);
      return { documentId: id, type: doc.type, status: doc.status, currency: doc.currency, totalMinor: doc.total_minor };
    },
  },
  {
    name: 'finalize_document',
    description: 'Assign the next number to a draft and freeze it into the hash chain. This cannot be undone; use Cancel or Credit afterwards. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'number' },
        confirm: { type: 'boolean', description: 'Must be true.' },
        backdateReason: { type: 'string' },
      },
      required: ['documentId', 'confirm'],
    },
    async handler(env, args) {
      const input = finalizeDocumentInput.parse(args);
      const ctx = ctxOf(env);
      const outcome = await finalize(ctx, input.documentId, { backdateReason: input.backdateReason });
      const doc = await getDoc(env.db, input.documentId, env.businessId);
      return { documentId: input.documentId, number: outcome.number, displayNumber: displayNumber(doc.type, outcome.number), alreadyFinal: outcome.alreadyFinal };
    },
  },
  {
    name: 'record_payment',
    description:
      'Record a payment against a payment request or transaction invoice, and by default finalize the resulting receipt in the same step. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'number', description: 'The payment request or transaction invoice being paid.' },
        confirm: { type: 'boolean', description: 'Must be true.' },
        date: { type: 'string' },
        payments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              method: { type: 'string', enum: ['bank_transfer', 'card', 'cheque', 'cash', 'other'] },
              paidOn: { type: 'string' },
              amountMinor: { type: 'number' },
              reference: { type: 'string' },
            },
            required: ['method', 'paidOn', 'amountMinor'],
          },
        },
        finalize: { type: 'boolean', description: 'Finalize the receipt immediately. Default true.' },
      },
      required: ['documentId', 'confirm', 'payments'],
    },
    async handler(env, args) {
      const input = recordPaymentToolInput.parse(args);
      const ctx = ctxOf(env);
      const result = await recordPayment(ctx, input.documentId, {
        date: input.date,
        payments: input.payments,
        notes: input.notes,
        finalize: input.finalize,
        backdateReason: input.backdateReason,
      });
      return {
        receiptId: result.receiptId,
        finalized: result.finalized ? { number: result.finalized.number, alreadyFinal: result.finalized.alreadyFinal } : null,
      };
    },
  },
  {
    name: 'income_report',
    description: 'Final income (receipts and tax invoices, credits subtracted) between two dates, totaled per currency.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['from', 'to'],
    },
    async handler(env, args) {
      const input = incomeReportInput.parse(args);
      if (input.from > input.to) throw new ValidationError('"from" must be on or before "to".');
      return incomeReport(env.db, input.from, input.to, env.businessId);
    },
  },
  {
    name: 'add_expense',
    description:
      'Record a supplier invoice or receipt as an expense. You read the document and send its fields; the Ledger does not read it again. ' +
      'The expense waits on the Expenses screen for the owner to check and file, so nothing is final. ' +
      'Attach the original with fileBase64 and filename when you can; otherwise the owner attaches it later. ' +
      'Amounts are decimal strings in major units, for example "117.00", and amount is the total including VAT.',
    inputSchema: {
      type: 'object',
      properties: {
        supplierName: { type: 'string', description: 'Supplier name as printed on the document.' },
        supplierId: { type: 'string', description: 'Supplier tax id (ח.פ. / ע.מ.), if shown.' },
        documentNumber: { type: 'string', description: 'Invoice or receipt number.' },
        date: { type: 'string', description: 'Document date, YYYY-MM-DD.' },
        currency: { type: 'string', description: 'ILS, USD, EUR or GBP.' },
        amount: { type: 'string', description: 'Total including VAT, for example "117.00".' },
        vatAmount: { type: 'string', description: 'VAT part of the total, for example "17.00". Leave out when there is no VAT.' },
        documentType: { type: 'string', description: 'For example tax invoice, receipt, tax invoice receipt.' },
        note: { type: 'string', description: 'Short note saved on the expense.' },
        fileBase64: { type: 'string', description: 'The original file, base64. Up to 10 MB.' },
        filename: { type: 'string', description: 'File name with extension (pdf, png, jpg, webp, gif, heic). Required with fileBase64.' },
      },
      required: ['supplierName', 'currency', 'amount'],
    },
    async handler(env, args) {
      const input = addExpenseInput.parse(args);
      const { note, fileBase64, filename, ...fields } = input;
      let file: { bytes: ArrayBuffer; filename: string; contentType: string } | null = null;
      if (fileBase64) {
        if (!filename) throw new ValidationError('Send filename with fileBase64.');
        if (!env.bindings) throw new ValidationError('This server cannot store files.');
        file = { bytes: decodeBase64(fileBase64), filename, contentType: fileTypeOf(filename) };
      }
      if (!env.bindings) throw new ValidationError('This server cannot record expenses.');
      const result = await recordGivenExpense(
        { ...env.bindings, DB: env.db },
        boiRateSource(env.db),
        { fields, file, note: note ?? (file ? null : 'Added by Claude, no file attached yet.'), source: 'mcp' },
        { ...env.actor, businessId: env.businessId },
      );
      if (result.kind === 'duplicate') return { duplicate: true, expenseId: result.expenseId, message: 'This file is already recorded.' };
      const e = result.expense;
      return {
        expenseId: e.id,
        status: e.status,
        statusReason: e.status_reason,
        duplicateOfId: e.duplicate_of_id,
        currency: e.currency,
        amountMinor: e.amount_minor,
        vatAmountMinor: e.vat_amount_minor,
        amountIlsMinor: e.amount_ils_minor,
        fileAttached: e.file_id !== null,
      };
    },
  },
  {
    name: 'list_expenses',
    description: 'List expenses, newest document date first. Filter by status (new, filed, not_expense, duplicate, returned) and date range.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...EXPENSE_STATUSES] },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'number', description: '1 to 200. Default 50.' },
      },
    },
    async handler(env, args) {
      const input = listExpensesInput.parse(args ?? {});
      if (input.from && input.to && input.from > input.to) throw new ValidationError('"from" must be on or before "to".');
      const rows = await listExpenses(env.db, { status: input.status, from: input.from, to: input.to, limit: input.limit }, env.businessId);
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        supplier: r.supplier_name ?? null,
        documentNumber: r.document_number,
        date: r.document_date,
        currency: r.currency,
        amountMinor: r.amount_minor,
        vatAmountMinor: r.vat_amount_minor,
        amountIlsMinor: r.amount_ils_minor,
        category: r.category_name ?? null,
        fileAttached: r.file_id !== null,
        // R39: read, failed, manual, or null on older expenses.
        readStatus: r.read_status ?? null,
      }));
    },
  },
  {
    name: 'ceiling_status',
    description: 'Legal mode and, in עוסק פטור mode, the annual turnover ceiling meter: this year\'s turnover plus open requests against the ceiling.',
    inputSchema: { type: 'object', properties: {} },
    async handler(env) {
      const today = (env.today ?? (() => todayIsrael()))();
      const [legalMode, dashboard] = await Promise.all([legalModeOn(env.db, today, env.businessId), buildDashboard(env.db, today, env.businessId)]);
      return { legalMode: legalMode.mode, effectiveFrom: legalMode.effective_from, ceiling: dashboard.ceiling };
    },
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
