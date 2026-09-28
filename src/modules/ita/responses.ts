import type { ItaHttpResult } from './client';

/**
 * Turns ITA answers into outcomes the service acts on. Error codes and examples come from
 * spec v2.0 (July 2024) sections 2.3, 2.7, 4.2 and chapter 5, and the June 2026 addendum.
 */

export interface ItaErrorItem {
  code: string;
  message: string;
  param: string | null;
}

/** What the owner does about a rejected request. */
export type ItaFix = 'client_vat' | 'date' | 'config' | 'data';

export type ApprovalOutcome =
  | { kind: 'approved'; httpStatus: number; confirmationNumber: string; shortNumber: string }
  /** 460 refused now, 461 refused earlier without a decision. The owner picks one of four choices. */
  | { kind: 'refused'; httpStatus: number; code: '460' | '461'; message: string }
  /** 462: refused earlier and a decision was already sent. No action. */
  | { kind: 'already_decided'; httpStatus: number; code: '462'; message: string }
  | { kind: 'invalid'; httpStatus: number; code: string; message: string; param: string | null; fix: ItaFix; errors: ItaErrorItem[] }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'unavailable'; httpStatus: number | null; message: string };

/** Short English messages for the codes the spec documents. */
export const ITA_ERROR_MESSAGES: Record<string, string> = {
  '431': 'The client VAT number is wrong. Fix the client record and send again.',
  '434': 'The invoice date is more than a year old. The ITA allocates no number for it.',
  '435': 'The invoice date is more than 30 days ahead. The ITA allocates no number for it.',
  '438': 'The batch totals do not match the invoices in it.',
  '446': 'The ITA user ID is missing. Check the OWNER_TAX_ID secret.',
  '460': 'The ITA refused this invoice. Pick one of the four choices.',
  '461': 'The ITA refused this invoice earlier. Pick one of the four choices.',
  '462': 'The ITA refused this invoice and already has a decision. No action needed.',
  '463': 'The ITA has no refused invoice with this id.',
  '472': 'The ITA has no invoice that matches these details.',
  http_403: 'The ITA app has no permission for this service. Check the Invoices subscription in the portal.',
  http_404: 'The ITA address is wrong. Check the ITA paths in the module config.',
  http_406: 'The ITA refused this VAT number for this login. Check the VAT number secret.',
  http_422: 'The ITA says the request does not match its schema.',
};

export function fixFor(code: string): ItaFix {
  if (code === '431') return 'client_vat';
  if (code === '434' || code === '435') return 'date';
  if (code === '446' || code === '438' || code.startsWith('http_')) return 'config';
  return 'data';
}

/** The rightmost 9 digits of a confirmation number: the short allocation number printed and reported. */
export function shortAllocationNumber(confirmationNumber: string): string {
  const value = confirmationNumber.trim();
  if (!/^\d{9,}$/.test(value)) throw new RangeError('An allocation number has at least 9 digits and digits only.');
  return value.slice(-9);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Reads `message.errors[]` from an ITA body. Codes come back as numbers or strings. */
export function readErrors(body: unknown): ItaErrorItem[] {
  const message = asRecord(asRecord(body)?.message);
  const list = message?.errors;
  if (!Array.isArray(list)) return [];
  return list.flatMap((e) => {
    const r = asRecord(e);
    if (!r || r.code === undefined || r.code === null) return [];
    return [{ code: String(r.code), message: typeof r.message === 'string' ? r.message : '', param: typeof r.param === 'string' ? r.param : null }];
  });
}

function confirmationOf(body: Record<string, unknown> | null): string | null {
  const raw = body?.confirmation_number;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return /^\d{9,}$/.test(value) && !/^0+$/.test(value) ? value : null;
}

/** Outcome of one invoice: a single Approval body or one entry of a MultiApproval list. */
export function approvalFromBody(httpStatus: number, body: unknown): ApprovalOutcome {
  const record = asRecord(body);
  const confirmation = confirmationOf(record);
  if (httpStatus === 200 && record?.approved === true && confirmation) {
    return { kind: 'approved', httpStatus, confirmationNumber: confirmation, shortNumber: shortAllocationNumber(confirmation) };
  }
  const errors = readErrors(body);
  const codes = errors.map((e) => e.code);
  for (const code of ['460', '461'] as const) {
    if (codes.includes(code)) return { kind: 'refused', httpStatus, code, message: ITA_ERROR_MESSAGES[code]! };
  }
  if (codes.includes('462')) return { kind: 'already_decided', httpStatus, code: '462', message: ITA_ERROR_MESSAGES['462']! };
  const firstError = errors[0];
  if (firstError) {
    return {
      kind: 'invalid',
      httpStatus,
      code: firstError.code,
      message: ITA_ERROR_MESSAGES[firstError.code] ?? (firstError.message || 'The ITA rejected the request.'),
      param: firstError.param,
      fix: fixFor(firstError.code),
      errors,
    };
  }
  const code = `http_${httpStatus}`;
  return {
    kind: 'invalid',
    httpStatus,
    code,
    message: ITA_ERROR_MESSAGES[code] ?? 'The ITA gave no number and no reason.',
    param: null,
    fix: fixFor(code),
    errors: [],
  };
}

export function approvalOutcome(result: ItaHttpResult): ApprovalOutcome {
  if (result.kind === 'unauthorized') return { kind: 'unauthorized', message: result.message };
  if (result.kind === 'unavailable') return { kind: 'unavailable', httpStatus: result.status, message: result.message };
  return approvalFromBody(result.status, result.json);
}

export interface MultiApprovalOutcome {
  /** Table 2.6 data was wrong: nothing in the batch was processed. */
  mainError: ApprovalOutcome | null;
  byInvoiceId: Map<string, ApprovalOutcome>;
  transactionId: string | null;
}

export function multiApprovalOutcome(result: ItaHttpResult): MultiApprovalOutcome {
  if (result.kind !== 'response') {
    return { mainError: approvalOutcome(result), byInvoiceId: new Map(), transactionId: null };
  }
  const body = asRecord(result.json);
  const message = asRecord(body?.message);
  const transactionId = body?.transaction_id === undefined ? null : String(body.transaction_id);
  const byInvoiceId = new Map<string, ApprovalOutcome>();
  if (body?.is_error_in_main === true) {
    const first = Array.isArray(message?.errors) ? message.errors[0] : undefined;
    return { mainError: approvalFromBody(result.status, first ?? result.json), byInvoiceId, transactionId };
  }
  for (const item of Array.isArray(message?.success) ? message.success : []) {
    const r = asRecord(item);
    if (r?.invoice_id !== undefined) byInvoiceId.set(String(r.invoice_id), approvalFromBody(200, item));
  }
  for (const item of Array.isArray(message?.errors) ? message.errors : []) {
    const r = asRecord(item);
    if (r?.invoice_id !== undefined) byInvoiceId.set(String(r.invoice_id), approvalFromBody(result.status, item));
  }
  if (byInvoiceId.size === 0 && result.status !== 200) {
    return { mainError: approvalFromBody(result.status, result.json), byInvoiceId, transactionId };
  }
  return { mainError: null, byInvoiceId, transactionId };
}

export type DecisionOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'unavailable'; message: string };

export function decisionOutcome(result: ItaHttpResult): DecisionOutcome {
  if (result.kind === 'unauthorized') return { kind: 'unauthorized', message: result.message };
  if (result.kind === 'unavailable') return { kind: 'unavailable', message: result.message };
  if (result.status === 200 && readErrors(result.json).length === 0) return { kind: 'accepted' };
  const e = readErrors(result.json)[0];
  const code = e?.code ?? `http_${result.status}`;
  return { kind: 'rejected', code, message: ITA_ERROR_MESSAGES[code] ?? e?.message ?? 'The ITA rejected the decision.' };
}
