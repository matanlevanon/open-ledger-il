/**
 * R26: the Tax Authority, faked for demo mode. The Ledger's real ITA module runs unchanged, with
 * this fetch in place of the network. Login and token renewal succeed at once. An allocation
 * request answers after a short delay with a number prefixed DEMO-. One invoice in ten is refused,
 * so the refusal flow shows. A decision is accepted. Any other Tax Authority address throws: the
 * demo never calls taxes.gov.il or a broker.
 */

const TAX_HOSTS = /(^|\.)taxes\.gov\.il$/i;

/** A deterministic 9-digit number from the invoice id. */
function digitsFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return String(100_000_000 + (h % 900_000_000)).slice(0, 9);
}

/** One invoice in ten is refused: the last digit of its hash is 0. */
export function demoRefuses(invoiceId: string): boolean {
  return digitsFor(`refuse:${invoiceId}`).endsWith('0');
}

export function demoConfirmationNumber(invoiceId: string): string {
  return `DEMO-${digitsFor(invoiceId)}`;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function oneInvoice(invoiceId: string) {
  if (demoRefuses(invoiceId)) {
    return { invoice_id: invoiceId, approved: false, message: { errors: [{ code: '460', message: 'Demo: the Tax Authority refused this invoice.' }] } };
  }
  return { invoice_id: invoiceId, approved: true, confirmation_number: demoConfirmationNumber(invoiceId) };
}

export class DemoNetworkError extends Error {}

export function demoItaFetch(delayMs = 2000): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!TAX_HOSTS.test(url.hostname)) throw new DemoNetworkError(`Demo mode: no call to ${url.hostname}.`);
    const path = url.pathname;
    if (path.endsWith('/oauth2/token')) {
      const stamp = Date.now().toString(36);
      return json(200, { access_token: `demo-access-${stamp}`, refresh_token: `demo-refresh-${stamp}`, expires_in: 3600, refresh_token_expires_in: 90 * 86_400 });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (path.endsWith('/Invoices/v2/Approval')) {
      const answer = oneInvoice(String(body.invoice_id ?? ''));
      return json(answer.approved ? 200 : 400, answer);
    }
    if (path.endsWith('/Multi-invoices/v2/MultiApproval')) {
      const list = Array.isArray(body.invoices_list) ? (body.invoices_list as Record<string, unknown>[]) : [];
      const answers = list.map((inv) => oneInvoice(String(inv.invoice_id ?? '')));
      return json(200, {
        transaction_id: `demo-${Date.now()}`,
        is_error_in_main: false,
        message: { success: answers.filter((a) => a.approved), errors: answers.filter((a) => !a.approved).map((a) => ({ invoice_id: a.invoice_id, ...a.message?.errors[0] })) },
      });
    }
    if (path.includes('/InvoiceDecisionApi/')) return json(200, { message: { errors: [] } });
    if (path.includes('/invoice-information/')) return json(200, { message: { errors: [] }, confirmation_number: demoConfirmationNumber(String(body.invoice_id ?? 'x')) });
    throw new DemoNetworkError(`Demo mode: the fake Tax Authority does not answer ${path}.`);
  };
}
