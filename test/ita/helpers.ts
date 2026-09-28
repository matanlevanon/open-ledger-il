import { env } from 'cloudflare:workers';
import { run } from '../../src/core/db';
import type { ItaEnv } from '../../src/modules/ita/config';
import { MemoryAllocationDocuments } from '../../src/modules/ita/fake-documents';
import type { AllocationDocument } from '../../src/modules/ita/payload';
import { type ItaDeps, ItaAllocationService } from '../../src/modules/ita/service';
import { makeSeries } from '../helpers';
import { MemoryNotifier, MockIta } from '../mocks/ita';

/** 32 fixed bytes, base64. Test only. */
export const TEST_TOKEN_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
export const OWNER_ID = '123456782';
export const OWN_VAT = '777777715';
/** Valid check digits, used as client VAT numbers. */
export const CLIENT_VAT = '514713288';
export const REFUSED_CLIENT_VAT = '513579995';

export function itaEnv(overrides: Partial<ItaEnv> = {}): ItaEnv {
  return {
    ...env,
    ITA_ENV: 'sandbox',
    ITA_CLIENT_ID_SANDBOX: 'client-id',
    ITA_CLIENT_SECRET_SANDBOX: 'client-secret',
    ITA_CLIENT_ID_PRODUCTION: 'prod-client-id',
    ITA_CLIENT_SECRET_PRODUCTION: 'prod-client-secret',
    ITA_TOKEN_KEY: TEST_TOKEN_KEY,
    OWNER_TAX_ID: OWNER_ID,
    ITA_VAT_NUMBER: OWN_VAT,
    ...overrides,
  } as ItaEnv;
}

export function makeClock(start = '2027-03-01T08:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    set(iso: string) {
      t = Date.parse(iso);
    },
  };
}

let seriesId: string | null = null;

/** A D1 row for the document (the foreign keys need one). Status stays unnumbered, as R00 allows. */
export async function insertDocumentRow(status = 'draft', type = '305', extra: { subtotal?: number; vat?: number; date?: string } = {}): Promise<number> {
  seriesId ??= await makeSeries();
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO documents (type, series_id, status, date, subtotal_minor, vat_rate_bp, vat_amount_minor, total_minor)
     VALUES (?, ?, ?, ?, ?, 1800, ?, ?)`,
    type,
    seriesId,
    status,
    extra.date ?? '2027-02-25',
    extra.subtotal ?? 600000,
    extra.vat ?? 108000,
    (extra.subtotal ?? 600000) + (extra.vat ?? 108000),
  );
  return lastRowId;
}

let nextNumber = 1000;

export function taxInvoice(id: number, overrides: Partial<AllocationDocument> = {}): AllocationDocument {
  return {
    id,
    type: '305',
    number: nextNumber++,
    status: 'awaiting_allocation',
    date: '2027-02-25',
    issuanceDate: '2027-02-25',
    customerVatNumber: CLIENT_VAT,
    customerName: 'Acme Ltd',
    amountBeforeDiscountMinor: 600000,
    discountMinor: 0,
    paymentAmountMinor: 600000,
    vatAmountMinor: 108000,
    totalMinor: 708000,
    vatRateBp: 1800,
    lines: [{ position: 1, description: 'Strategy retainer', quantityMilli: 1000, unitPriceMinor: 600000, discountMinor: 0, lineTotalMinor: 600000 }],
    proformaDocumentId: null,
    ...overrides,
  };
}

export async function setupIta(options: { envOverrides?: Partial<ItaEnv>; connect?: boolean; start?: string } = {}) {
  const clock = makeClock(options.start);
  const production = options.envOverrides?.ITA_ENV === 'production';
  // The ITA issues separate apps, so production has its own client id and secret.
  const mock = new MockIta(clock.now, production ? { id: 'prod-client-id', secret: 'prod-client-secret' } : undefined);
  const notifier = new MemoryNotifier();
  const docs = new MemoryAllocationDocuments(() => insertDocumentRow('draft'));
  const deps: ItaDeps = { fetch: mock.fetch, now: clock.now, notifier: () => notifier, documents: () => docs };
  const ienv = itaEnv(options.envOverrides);
  const service = new ItaAllocationService(ienv, deps);
  if (options.connect !== false) {
    const itaEnvName = ienv.ITA_ENV === 'production' ? 'production' : 'tsandbox';
    await service.tokens.exchangeCode(mock.issueCode(itaEnvName), 'https://ledger.test/api/ita/callback', null);
  }

  /** A numbered tax invoice waiting for its allocation number. */
  async function addInvoice(overrides: Partial<AllocationDocument> = {}): Promise<AllocationDocument> {
    const id = await insertDocumentRow('draft');
    const doc = taxInvoice(id, overrides);
    docs.add(doc);
    return doc;
  }

  return { clock, mock, notifier, docs, deps, env: ienv, service, addInvoice };
}
