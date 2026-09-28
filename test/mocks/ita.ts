import {
  APPROVAL_431,
  APPROVAL_434,
  APPROVAL_435,
  APPROVAL_446,
  APPROVAL_460,
  APPROVAL_461,
  APPROVAL_462,
  DECISION_463,
  HTTP_ERRORS,
  LOOKUP_472,
} from '../fixtures/ita/spec-examples';

/**
 * Mock ITA server: the OAuth2 token endpoint and every Israel Invoices endpoint the module calls,
 * with the error examples from the specs. Pass `mock.fetch` as the module's fetch. No test
 * touches the internet.
 *
 * Behaviour:
 *   - Tokens: codes from `issueCode()`. Access tokens live 601 seconds, refresh tokens rotate
 *     (the old one stops working) and live 90 days. Tokens are bound to the environment in the URL.
 *   - Approval: 446 without user_id or user_name, 431 on a bad check digit, 434 older than a year,
 *     435 more than 30 days ahead, 460 for customers in `refuseCustomers`, 461 on a repeat without
 *     a decision, 462 after a decision. Action 3 or a won hearing (`winHearing`) approves a refused
 *     invoice. 422 when a field name is not lowercase.
 *   - MultiApproval: 438 when the summary does not match (is_error_in_main), per-invoice results
 *     otherwise, 400 when nothing was approved or refused.
 *   - Decisions: 463 unless the invoice is refused and waiting for a decision.
 *   - details and confirmationNumber: look up `supplierInvoices`, 472 when nothing matches.
 *   - `forceNext(status)` answers the next API call with a chapter 5 error. `down = true` throws.
 */

type Env = 'tsandbox' | 'production';

interface Stored {
  state: 'approved' | 'refused' | 'decided';
  decision?: string;
  confirmation?: string;
  customer: string;
}

export interface SupplierInvoice {
  vat_number: string;
  customer_vat_number: string;
  invoice_reference_number: string;
  invoice_date: string;
  payment_amount: number;
  vat_amount: number;
  confirmation_number: string;
}

export interface MockCall {
  path: string;
  env: Env;
  body: unknown;
  status: number;
}

const DAY = 86_400_000;

/** Israeli ID and VAT check digit (weights 1,2,1,2...). */
export function validIsraeliNumber(value: string): boolean {
  if (!/^\d{1,9}$/.test(value)) return false;
  const digits = value.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const n = Number(digits[i]) * ((i % 2) + 1);
    sum += n > 9 ? n - 9 : n;
  }
  return sum % 10 === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function hasUppercaseKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUppercaseKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([k, v]) => k !== k.toLowerCase() || hasUppercaseKey(v));
}

function cents(n: unknown): number {
  return Math.round(Number(n) * 100);
}

export class MockIta {
  readonly calls: MockCall[] = [];
  readonly tokenCalls: { env: Env; grant: string; status: number }[] = [];
  readonly refuseCustomers = new Set<string>();
  readonly invoices = new Map<string, Stored>();
  readonly hearingsWon = new Set<string>();
  readonly supplierInvoices: SupplierInvoice[] = [];
  down = false;
  private forced: { status: number; body?: unknown }[] = [];
  private codes = new Map<string, Env>();
  private refresh = new Map<string, { env: Env; expires: number }>();
  private access = new Map<string, { env: Env; expires: number }>();
  private counter = 0;

  constructor(
    readonly clock: () => Date,
    readonly client = { id: 'client-id', secret: 'client-secret' },
  ) {}

  issueCode(env: Env = 'tsandbox'): string {
    const code = `code-${++this.counter}`;
    this.codes.set(code, env);
    return code;
  }

  forceNext(status: number, body?: unknown): void {
    this.forced.push({ status, body });
  }

  /** Every access token stops working, as after an ITA-side revoke. */
  revokeAccessTokens(): void {
    this.access.clear();
  }

  revokeRefreshTokens(): void {
    this.refresh.clear();
  }

  winHearing(invoiceId: string): void {
    this.hearingsWon.add(invoiceId);
  }

  apiCalls(path: string): MockCall[] {
    return this.calls.filter((c) => c.path === path);
  }

  private now(): number {
    return this.clock().getTime();
  }

  private newConfirmation(): string {
    const stamp = this.clock().toISOString().replace(/\D/g, '').slice(0, 14);
    return `${stamp}${String(++this.counter).padStart(12, '0')}`;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.down) throw new TypeError('fetch failed');
    const url = new URL(input instanceof Request ? input.url : String(input));
    const match = url.pathname.match(/^\/shaam\/(tsandbox|production)\/(.+)$/);
    if (!match) return json(404, { status: 404, message: HTTP_ERRORS[404] });
    const env = match[1] as Env;
    const path = match[2]!;
    const body = typeof init?.body === 'string' ? init.body : '';
    if (path === 'longtimetoken/oauth2/token') return this.token(env, init?.headers, body);

    const res = this.api(env, path, init?.headers, body);
    this.calls.push({ path, env, body: body ? JSON.parse(body) : null, status: res.status });
    return res;
  };

  private header(headers: HeadersInit | undefined, name: string): string | null {
    return new Headers(headers).get(name);
  }

  private token(env: Env, headers: HeadersInit | undefined, raw: string): Response {
    const params = new URLSearchParams(raw);
    const grant = params.get('grant_type') ?? '';
    const done = (status: number, body: unknown) => {
      this.tokenCalls.push({ env, grant, status });
      return json(status, body);
    };
    if (this.header(headers, 'Authorization') !== `Basic ${btoa(`${this.client.id}:${this.client.secret}`)}`) {
      return done(401, { error: 'invalid_client' });
    }
    if (params.get('scope') !== 'scope') return done(400, { error: 'invalid_scope' });
    if (grant === 'authorization_code') {
      const code = params.get('code') ?? '';
      if (this.codes.get(code) !== env || !params.get('redirect_uri')) return done(400, { error: 'invalid_grant' });
      this.codes.delete(code);
      return done(200, this.mint(env));
    }
    if (grant === 'refresh_token') {
      const token = params.get('refresh_token') ?? '';
      const saved = this.refresh.get(token);
      if (!saved || saved.env !== env || saved.expires <= this.now()) return done(400, { error: 'invalid_grant' });
      this.refresh.delete(token);
      return done(200, this.mint(env, saved.expires));
    }
    return done(400, { error: 'unsupported_grant_type' });
  }

  private mint(env: Env, refreshExpires?: number) {
    const access = `at-${++this.counter}`;
    const refresh = `rt-${++this.counter}`;
    const refreshUntil = refreshExpires ?? this.now() + 7_776_000_000;
    this.access.set(access, { env, expires: this.now() + 601_000 });
    this.refresh.set(refresh, { env, expires: refreshUntil });
    return {
      token_type: 'Bearer',
      access_token: access,
      expires_in: 601,
      refresh_token: refresh,
      refresh_token_expires_in: Math.round((refreshUntil - this.now()) / 1000),
      scope: 'scope',
    };
  }

  private api(env: Env, path: string, headers: HeadersInit | undefined, raw: string): Response {
    const auth = this.header(headers, 'Authorization') ?? '';
    const token = this.access.get(auth.replace(/^Bearer /, ''));
    if (!token || token.env !== env || token.expires <= this.now()) return json(401, { status: 401, message: HTTP_ERRORS[401] });
    const forced = this.forced.shift();
    if (forced) return json(forced.status, forced.body ?? { status: forced.status, message: HTTP_ERRORS[forced.status] ?? 'Error' });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json(400, { status: 400, message: 'Request includes logical incorrect data.' });
    }
    if (hasUppercaseKey(body)) return json(422, { status: 422, message: HTTP_ERRORS[422] });

    switch (path) {
      case 'Invoices/v2/Approval': {
        const r = this.judge(body);
        return json(r.status, r.body);
      }
      case 'Multi-invoices/v2/MultiApproval':
        return this.multi(body);
      case 'InvoiceDecisionApi/v1/Cancel':
        return this.decide(body, 'cancel');
      case 'InvoiceDecisionApi/v1/Continue':
        return this.decide(body, 'continue');
      case 'InvoiceDecisionApi/v1/FurtherObjection':
        return this.decide(body, 'further_objection');
      case 'invoice-information/v2/details':
        return this.details(body);
      case 'invoice-information/v2/confirmationNumber':
        return this.confirmationNumber(body);
      default:
        return json(404, { status: 404, message: HTTP_ERRORS[404] });
    }
  }

  /** One invoice, as Approval and each MultiApproval entry answer it. */
  private judge(inv: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
    const refusedBody = (example: typeof APPROVAL_460) => ({ status: 200, body: structuredClone(example) });
    if (inv.user_id === undefined && inv.user_name === undefined) return { status: 400, body: structuredClone(APPROVAL_446) };
    if (!validIsraeliNumber(String(inv.vat_number ?? ''))) return { status: 400, body: structuredClone(APPROVAL_431) };
    if (!validIsraeliNumber(String(inv.customer_vat_number ?? ''))) {
      const b = structuredClone(APPROVAL_431);
      b.message.errors[0]!.param = 'customer_vat_number';
      return { status: 400, body: b };
    }
    const date = Date.parse(`${String(inv.invoice_date)}T00:00:00Z`);
    const today = Date.parse(`${this.clock().toISOString().slice(0, 10)}T00:00:00Z`);
    if (!(date >= today - 365 * DAY)) return { status: 400, body: structuredClone(APPROVAL_434) };
    if (date > today + 30 * DAY) return { status: 400, body: structuredClone(APPROVAL_435) };

    const id = String(inv.invoice_id);
    const customer = String(inv.customer_vat_number);
    const approve = (): { status: number; body: Record<string, unknown> } => {
      const confirmation = this.newConfirmation();
      this.invoices.set(id, { state: 'approved', confirmation, customer });
      return { status: 200, body: { status: 200, message: 'Invoice approved', confirmation_number: confirmation, approved: true } };
    };
    const stored = this.invoices.get(id);
    if (stored?.state === 'approved') {
      if (inv.action === 4) return approve();
      return { status: 200, body: { status: 200, message: 'Invoice approved', confirmation_number: stored.confirmation, approved: true } };
    }
    if (stored?.state === 'refused') {
      if ((inv.action === 3 && cents(inv.vat_amount) === 0) || this.hearingsWon.has(id)) return approve();
      return refusedBody(APPROVAL_461);
    }
    if (stored?.state === 'decided') {
      if (stored.decision === 'further_objection' && this.hearingsWon.has(id)) return approve();
      return refusedBody(APPROVAL_462);
    }
    if (this.refuseCustomers.has(customer)) {
      this.invoices.set(id, { state: 'refused', customer });
      return refusedBody(APPROVAL_460);
    }
    return approve();
  }

  private multi(body: Record<string, unknown>): Response {
    const list = Array.isArray(body.invoices_list) ? (body.invoices_list as Record<string, unknown>[]) : [];
    const head = { transaction_id: this.newConfirmation(), vat_number: body.vat_number, union_vat_number: 0 };
    const sumPay = list.reduce((s, i) => s + cents(i.payment_amount), 0);
    const sumVat = list.reduce((s, i) => s + cents(i.vat_amount), 0);
    if (Number(body.invoices_amount) !== list.length || cents(body.invoices_payment_amount) !== sumPay || cents(body.invoices_vat_amount) !== sumVat) {
      return json(400, {
        status: 400,
        ...head,
        is_error_in_main: true,
        message: {
          errors: [
            {
              invoice_id: '0',
              message: {
                errors: [{ code: 438, message: 'Invoices amount is not the same as actual invoices amount', param: 'invoices_amount', location: 'request' }],
              },
              confirmation_number: '0',
              approved: false,
            },
          ],
        },
      });
    }
    const success: unknown[] = [];
    const errors: unknown[] = [];
    let processed = false;
    for (const inv of list) {
      const r = this.judge({ user_id: body.user_id, user_name: body.user_name, ...inv });
      if (r.body.approved === true) {
        processed = true;
        success.push({ invoice_id: String(inv.invoice_id), confirmation_number: r.body.confirmation_number, approved: true });
      } else {
        if (r.status === 200) processed = true;
        errors.push({ invoice_id: String(inv.invoice_id), message: r.body.message, confirmation_number: '0', approved: false });
      }
    }
    const status = processed ? 200 : 400;
    const message: Record<string, unknown> = { errors };
    if (success.length > 0) message.success = success;
    return json(status, { status, ...head, is_error_in_main: false, message });
  }

  private decide(body: Record<string, unknown>, decision: string): Response {
    const stored = this.invoices.get(String(body.invoice_id));
    const open = stored?.state === 'refused' || (stored?.state === 'decided' && stored.decision === 'further_objection' && decision !== 'further_objection');
    if (!stored || !open || body.user_id === undefined) return json(400, structuredClone(DECISION_463));
    stored.state = 'decided';
    stored.decision = decision;
    return json(200, { status: 200, message: 'Decision accepted' });
  }

  private details(body: Record<string, unknown>): Response {
    const wanted = String(body.confirmation_number ?? '');
    const found = this.supplierInvoices.find(
      (s) =>
        s.customer_vat_number === String(body.customer_vat_number) &&
        s.vat_number === String(body.vat_number) &&
        (s.confirmation_number === wanted || (wanted.length === 9 && s.confirmation_number.endsWith(wanted))),
    );
    if (!found) return json(400, structuredClone(LOOKUP_472));
    return json(200, {
      status: 200,
      message: {
        invoice_type: 305,
        vat_number: Number(found.vat_number),
        invoice_reference_number: found.invoice_reference_number,
        customer_vat_number: Number(found.customer_vat_number),
        customer_name: 'Sample Business Ltd',
        invoice_date: found.invoice_date,
        invoice_issuance_date: found.invoice_date,
        amount_before_discount: found.payment_amount,
        discount: 0,
        payment_amount: found.payment_amount,
        vat_amount: found.vat_amount,
        payment_amount_including_vat: (cents(found.payment_amount) + cents(found.vat_amount)) / 100,
        confirmation_number: found.confirmation_number,
        items: [],
      },
    });
  }

  private confirmationNumber(body: Record<string, unknown>): Response {
    const found = this.supplierInvoices.find(
      (s) =>
        s.customer_vat_number === String(body.customer_vat_number) &&
        s.vat_number === String(body.vat_number) &&
        s.invoice_date === body.invoice_date &&
        cents(s.payment_amount) === cents(body.payment_amount) &&
        cents(s.vat_amount) === cents(body.vat_amount),
    );
    if (!found) return json(400, structuredClone(LOOKUP_472));
    return json(200, {
      status: 200,
      message: `Invoice confirmation number for the received data is: ${found.confirmation_number}`,
      confirmation_number: found.confirmation_number,
    });
  }
}

/** Slack fake: keeps every alert. */
export class MemoryNotifier {
  readonly messages: string[] = [];
  ok = true;
  async send(text: string): Promise<boolean> {
    if (this.ok) this.messages.push(text);
    return this.ok;
  }
}
