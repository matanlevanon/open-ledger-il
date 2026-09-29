import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, issue, line, makeAccountant, makeClient, ok, pay } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('clients', () => {
  it('creates, reads and updates a client with English and Hebrew names', async () => {
    const created = await ok('POST', '/clients', {
      nameEn: 'Acme Ltd',
      nameHe: 'אקמה בע"מ',
      companyId: '515555555',
      country: 'gb',
      foreignResident: true,
      currency: 'GBP',
      clientCopyLang: 'en',
      email: 'ap@acme.example',
    });
    expect(created.client).toMatchObject({ name_en: 'Acme Ltd', name_he: 'אקמה בע"מ', country: 'GB', foreign_resident: 1, currency: 'GBP' });
    const id = created.client.id;
    const updated = await ok('PATCH', `/clients/${id}`, { notes: 'Pays in 30 days', clientCopyLang: 'bilingual' });
    expect(updated.client.notes).toBe('Pays in 30 days');
    expect(updated.client.client_copy_lang).toBe('bilingual');
    expect(updated.client.name_en).toBe('Acme Ltd');
    const bad = await api('POST', '/clients', { nameEn: '', currency: 'JPY' });
    expect(bad.status).toBe(400);
  });

  /** R19 rule 1: a client needs at least one of nameEn, nameHe. */
  describe('a client needs at least one name', () => {
    it('creates a client with only a Hebrew name; the English column stores empty, not null', async () => {
      const created = await ok('POST', '/clients', { nameHe: 'חברת בדיקה בע"מ' });
      expect(created.client).toMatchObject({ name_en: '', name_he: 'חברת בדיקה בע"מ' });
    });

    /** R19 part 2: a Hebrew-only client defaults to bilingual documents; an explicit choice wins. */
    it('defaults a Hebrew-only client to bilingual documents, others to English', async () => {
      const he = await ok('POST', '/clients', { nameHe: 'ברירת מחדל דו-לשוני' });
      expect(he.client.client_copy_lang).toBe('bilingual');
      const en = await ok('POST', '/clients', { nameEn: 'Default English Co' });
      expect(en.client.client_copy_lang).toBe('en');
      const both = await ok('POST', '/clients', { nameEn: 'Both Default Co', nameHe: 'שניהם' });
      expect(both.client.client_copy_lang).toBe('en');
      const explicit = await ok('POST', '/clients', { nameHe: 'בחירה מפורשת', clientCopyLang: 'en' });
      expect(explicit.client.client_copy_lang).toBe('en');
    });

    it('creates a client with only an English name', async () => {
      const created = await ok('POST', '/clients', { nameEn: 'English Only Co' });
      expect(created.client).toMatchObject({ name_en: 'English Only Co', name_he: null });
    });

    it('rejects a create with neither name', async () => {
      const bad = await api('POST', '/clients', { currency: 'USD' });
      expect(bad.status).toBe(400);
    });

    it('rejects a PATCH that clears the only remaining name (Hebrew-only client)', async () => {
      const created = await ok('POST', '/clients', { nameHe: 'לקוח יחיד' });
      const bad = await api('PATCH', `/clients/${created.client.id}`, { nameHe: null });
      expect(bad.status).toBe(400);
      const bad2 = await api('PATCH', `/clients/${created.client.id}`, { nameHe: '' });
      expect(bad2.status).toBe(400);
    });

    it('rejects a PATCH that clears the only remaining name (English-only client)', async () => {
      const created = await ok('POST', '/clients', { nameEn: 'Only English Co' });
      const bad = await api('PATCH', `/clients/${created.client.id}`, { nameEn: null });
      expect(bad.status).toBe(400);
    });

    it('allows a PATCH that clears one name while the other still exists', async () => {
      const created = await ok('POST', '/clients', { nameEn: 'Both Names Co', nameHe: 'שני שמות' });
      const patched = await ok('PATCH', `/clients/${created.client.id}`, { nameEn: null });
      expect(patched.client).toMatchObject({ name_en: '', name_he: 'שני שמות' });
    });

    it('sorts the client list by the resolved display name, not by the possibly empty English column', async () => {
      // Both names are plain ASCII, so SQLite's NOCASE collation and simple string order agree:
      // "Aaa..." sorts before "Bbb...". A Hebrew-only client stored with name_en = '' would sort
      // before every English name under a plain name_en ORDER BY; the fix reads its name_he instead.
      const hebrewOnly = await ok('POST', '/clients', { nameHe: 'Aaa Hebrew-only' });
      const englishOnly = await ok('POST', '/clients', { nameEn: 'Bbb English-only' });
      const list = await ok('GET', '/clients');
      const ids = list.clients.map((c: any) => c.id);
      expect(ids.indexOf(hebrewOnly.client.id)).toBeLessThan(ids.indexOf(englishOnly.client.id));
    });
  });

  /**
   * clientInput.partial() alone does not leave an omitted field unset: zod still applies that
   * field's own .default(...) when the key is missing, so a PATCH meaning to change one field
   * silently reset every defaulted field (currency, country, foreignResident, clientCopyLang) back
   * to its default. partialWithoutDefaults (src/core/schema.ts) fixes clientPatch specifically.
   */
  it('a PATCH of one field never resets an omitted defaulted field', async () => {
    const created = await ok('POST', '/clients', {
      nameEn: 'Global Co',
      currency: 'USD',
      foreignResident: true,
      clientCopyLang: 'en',
      email: 'old@global.example',
    });
    const id = created.client.id;
    const updated = await ok('PATCH', `/clients/${id}`, { email: 'new@global.example' });
    expect(updated.client.email).toBe('new@global.example');
    expect(updated.client.currency).toBe('USD');
    expect(updated.client.foreign_resident).toBe(1);
    expect(updated.client.client_copy_lang).toBe('en');
  });

  /** R18 task 6: an active flag replaces archiving. A not-active client is never deleted and keeps full document access; it is only hidden from the default client list. */
  it('deactivates instead of deleting; a not-active client still gets new documents', async () => {
    const id = await makeClient();
    expect((await api('DELETE', `/clients/${id}`)).status).toBe(404);
    const deactivated = await ok('POST', `/clients/${id}/deactivate`);
    expect(deactivated.client.active).toBe(0);
    const list = await ok('GET', '/clients');
    expect(list.clients.some((c: any) => c.id === id)).toBe(false);
    const all = await ok('GET', '/clients?active=all');
    expect(all.clients.some((c: any) => c.id === id)).toBe(true);
    const notActiveOnly = await ok('GET', '/clients?active=0');
    expect(notActiveOnly.clients.some((c: any) => c.id === id)).toBe(true);
    // Not active is a visibility flag only: the client can still take new documents.
    await ok('POST', '/documents', { type: 'PR', clientId: id, lines: [line(100)] });
    const reactivated = await ok('POST', `/clients/${id}/activate`);
    expect(reactivated.client.active).toBe(1);
    const again = await api('POST', `/clients/${id}/activate`);
    expect(again.body.error.code).toBe('no_change');
  });

  it('keeps contacts with one primary', async () => {
    const id = await makeClient();
    await ok('POST', `/clients/${id}/contacts`, { name: 'Dana', email: 'dana@example.com', isPrimary: true });
    const two = await ok('POST', `/clients/${id}/contacts`, { name: 'Omer', role: 'Finance', isPrimary: true });
    expect(two.contacts.map((c: any) => [c.name, c.is_primary])).toEqual([
      ['Omer', 1],
      ['Dana', 0],
    ]);
    const dana = two.contacts.find((c: any) => c.name === 'Dana');
    const left = await ok('DELETE', `/clients/${id}/contacts/${dana.id}`);
    expect(left.contacts).toHaveLength(1);
  });

  it('records manual consent on create, shows it on the client, and revokes it on edit', async () => {
    const created = await ok('POST', '/clients', {
      nameEn: 'Consented Co',
      consent: { granted: true, source: 'signed_contract', date: '2026-10-01', note: 'Signed at kickoff' },
    });
    expect(created.consent).toMatchObject({ status: 'granted', method: 'manual', source: 'signed_contract' });
    expect(created.consent.at.slice(0, 10)).toBe('2026-10-01');

    const id = created.client.id;
    const detail = await ok('GET', `/clients/${id}`);
    expect(detail.consent.status).toBe('granted');

    const revoked = await ok('PATCH', `/clients/${id}`, { consent: { granted: false, source: 'other', date: '2026-10-06' } });
    expect(revoked.consent.status).toBe('revoked');

    const audit = await api('GET', '/clients/' + id, undefined);
    expect(audit.status).toBe(200);
  });

  it('leaves consent untouched when the edit form does not send a consent block', async () => {
    const id = await makeClient();
    await ok('PATCH', `/clients/${id}`, { notes: 'unrelated edit' });
    const detail = await ok('GET', `/clients/${id}`);
    expect(detail.consent.status).toBe('none');
  });

  /** R17 task 7: documents uploaded from another system show on the client page. */
  it('shows uploaded external documents on the client detail', async () => {
    const id = await makeClient();
    await env.DB.prepare(
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
         amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
       VALUES ('sumit', 'client-test-1', 'Receipt', '2026-10-06', ?, 'Some Name', 'ILS', 1000, 0, 1000, 1000, 'paid', 'k', 'h')`,
    )
      .bind(id)
      .run();
    const detail = await ok('GET', `/clients/${id}`);
    expect(detail.externalDocuments).toHaveLength(1);
    expect(detail.externalDocuments[0]).toMatchObject({ source: 'sumit', original_number: 'client-test-1' });
  });

  it('lets an accountant view clients but not change them', async () => {
    await makeAccountant('cpa-clients@example.com', ['clients']);
    const id = await makeClient();
    expect((await api('GET', `/clients/${id}`, undefined, 'cpa-clients@example.com')).status).toBe(200);
    expect((await api('GET', `/clients/${id}/ledger`, undefined, 'cpa-clients@example.com')).status).toBe(200);
    expect((await api('PATCH', `/clients/${id}`, { notes: 'x' }, 'cpa-clients@example.com')).status).toBe(403);
    expect((await api('GET', '/documents', undefined, 'cpa-clients@example.com')).status).toBe(403);
  });
});

describe('client ledger balance (תוספת ה׳)', () => {
  it('lists every document and payment with a running balance per currency', async () => {
    const client = await makeClient();
    clock.today = '2026-10-06';
    const pr = await issue('PR', { clientId: client, lines: [line(100000)], date: '2026-10-06' });
    const usd = await issue('PR', { clientId: client, currency: 'USD', lines: [line(50000)], date: '2026-10-06' });
    clock.today = '2026-10-08';
    await ok('POST', `/documents/${pr.document.id}/record-payment`, { payments: [pay(40000, '2026-10-08')] });
    const direct = await issue('400', { clientId: client, payments: [pay(25000, '2026-10-08', 'card')] });
    await ok('POST', `/documents/${direct.document.id}/credit`, { mode: 'partial', amountMinor: 5000 });
    await ok('POST', `/documents/${usd.document.id}/record-payment`, { payments: [pay(20000, '2026-10-08')] });

    const ledger = await ok('GET', `/clients/${client}/ledger`);
    expect(ledger.opening).toEqual({});
    expect(ledger.closing).toEqual({ ILS: 60000, USD: 30000 });
    const rows = ledger.entries.map((e: any) => [e.kind, e.type, e.currency, e.debit_minor, e.credit_minor, e.balance_minor]);
    expect(rows).toEqual([
      ['document', 'PR', 'ILS', 100000, 0, 100000],
      ['document', 'PR', 'USD', 50000, 0, 50000],
      ['document', '400', 'ILS', 0, 0, 100000],
      ['payment', '400', 'ILS', 0, 40000, 60000],
      ['document', '400', 'ILS', 25000, 0, 85000],
      ['payment', '400', 'ILS', 0, 25000, 60000],
      ['document', '405', 'ILS', -5000, 0, 55000],
      ['payment', '405', 'ILS', 0, -5000, 60000],
      ['document', '400', 'USD', 0, 0, 50000],
      ['payment', '400', 'USD', 0, 20000, 30000],
    ]);
    // The book closes on the same balance the client card shows.
    expect((await ok('GET', `/clients/${client}`)).balances).toEqual(ledger.closing);
  });

  it('filters by period with an opening balance, and cancelled documents stay with zero effect', async () => {
    const client = await makeClient();
    clock.today = '2026-10-10';
    await issue('PR', { clientId: client, lines: [line(10000)], date: '2026-10-10' });
    clock.today = '2026-10-12';
    const pr2 = await issue('PR', { clientId: client, lines: [line(7000)], date: '2026-10-12' });
    await ok('POST', `/documents/${pr2.document.id}/cancel`, { reason: 'Duplicate' });
    const period = await ok('GET', `/clients/${client}/ledger?from=2026-10-11&to=2026-10-31`);
    expect(period.opening).toEqual({ ILS: 10000 });
    expect(period.entries.map((e: any) => [e.status, e.debit_minor, e.balance_minor])).toEqual([['cancelled', 0, 10000]]);
    expect(period.closing).toEqual({ ILS: 10000 });
    const bad = await api('GET', `/clients/${client}/ledger?from=2026-10-31&to=2026-10-01`);
    expect(bad.status).toBe(400);
  });
});

/** R16 task 7: payment instructions default (business), per-client override, and save-back on finalize. */
describe('payment instructions', () => {
  beforeEach(async () => {
    // Later than any date used by the tests above, since series numbering only moves forward.
    clock.today = '2026-10-20';
    await env.DB.prepare('UPDATE business_profile SET payment_instructions = ? WHERE id = 1').bind('Pay by bank transfer within 14 days.').run();
  });

  it('prefills a new quote from the client field, falling back to the business default', async () => {
    const withOwn = await makeClient({ paymentInstructions: 'Half up front, half on delivery.' });
    const withoutOwn = await makeClient();

    const draft1 = await ok('POST', '/documents', { type: 'QT', clientId: withOwn, lines: [line(1000)] });
    expect(draft1.document.payment_instructions).toBe('Half up front, half on delivery.');

    const draft2 = await ok('POST', '/documents', { type: 'PR', clientId: withoutOwn, lines: [line(1000)] });
    expect(draft2.document.payment_instructions).toBe('Pay by bank transfer within 14 days.');
  });

  it('keeps the text the caller sends instead of prefilling', async () => {
    const client = await makeClient({ paymentInstructions: 'Client text.' });
    const draft = await ok('POST', '/documents', { type: 'PR', clientId: client, lines: [line(1000)], paymentInstructions: 'Custom text for this one.' });
    expect(draft.document.payment_instructions).toBe('Custom text for this one.');
  });

  it('finalizing a payment request saves its edited text back to the client', async () => {
    const client = await makeClient({ paymentInstructions: 'Old text.' });
    const draft = await ok('POST', '/documents', { type: 'PR', clientId: client, lines: [line(1000)], paymentInstructions: 'New text after editing.' });
    await ok('POST', `/documents/${draft.document.id}/finalize`, {});

    const updated = await ok('GET', `/clients/${client}`);
    expect(updated.client.payment_instructions).toBe('New text after editing.');

    // The next payment request for this client starts from the text just used.
    const next = await ok('POST', '/documents', { type: 'PR', clientId: client, lines: [line(500)] });
    expect(next.document.payment_instructions).toBe('New text after editing.');
  });

  it('never writes back from a receipt or a transaction invoice payment', async () => {
    const client = await makeClient({ paymentInstructions: 'Stays put.' });
    await issue('400', { clientId: client, payments: [pay(1000)] });
    const after = await ok('GET', `/clients/${client}`);
    expect(after.client.payment_instructions).toBe('Stays put.');
  });
});

describe('client city and zip code', () => {
  it('saves one address, a city and a zip code, and edits them', async () => {
    const created = await ok('POST', '/clients', { nameEn: 'City Co', addressEn: 'הרצל 1', city: 'תל אביב', postalCode: '6100000' });
    expect(created.client).toMatchObject({ address_en: 'הרצל 1', city: 'תל אביב', postal_code: '6100000' });
    const edited = await ok('PATCH', `/clients/${created.client.id}`, { postalCode: '6200000' });
    expect(edited.client.postal_code).toBe('6200000');
    expect(edited.client.city).toBe('תל אביב');
  });
});

describe('client ledger with imported past documents', () => {
  it('books an unpaid imported pro forma as open and a paid imported receipt as settled', async () => {
    const client = await makeClient();
    for (const [n, type, paid, total] of [
      ['9001', 'Pro Forma Invoice', 'unpaid', 50000],
      ['9002', 'Invoice/Receipt', 'paid', 30000],
      ['9003', 'Quote', 'unknown', 99900],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
           amount_before_vat_minor, vat_amount_minor, total_minor, paid_status, r2_key, sha256)
         VALUES ('sumit', ?, ?, '2026-08-01', ?, 'Imported Co', 'ILS', ?, 0, ?, ?, 'k', 's')`,
      )
        .bind(n, type, client, total, total, paid)
        .run();
    }
    const ledger = await ok('GET', `/clients/${client}/ledger`);
    const imported = ledger.entries.filter((e: any) => e.kind === 'imported');
    expect(imported.map((e: any) => e.display_number)).toEqual(['Pro Forma Invoice / 9001', 'Invoice/Receipt / 9002']);
    expect(ledger.closing.ILS).toBe(50000);
  });

  it('pays an imported pro forma with the imported receipt instead of charging both', async () => {
    const client = await makeClient();
    for (const [n, type, date, paid] of [
      ['9101', 'Payment Request', '2026-07-01', 'paid'],
      ['9102', 'Invoice/Receipt', '2026-07-10', 'paid'],
      ['9103', 'Pro Forma Invoice', '2026-08-01', 'unpaid'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
           amount_before_vat_minor, vat_amount_minor, total_minor, paid_status, r2_key, sha256)
         VALUES ('sumit', ?, ?, ?, ?, 'Imported Co', 'ILS', 50000, 0, 50000, ?, 'k', 's')`,
      )
        .bind(n, type, date, client, paid)
        .run();
    }
    const ledger = await ok('GET', `/clients/${client}/ledger`);
    const rows = ledger.entries.filter((e: any) => e.kind === 'imported');
    expect(rows.map((e: any) => [e.debit_minor, e.credit_minor])).toEqual([
      [50000, 0],
      [0, 50000],
      [50000, 0],
    ]);
    expect(rows[1].description).toContain('pays Payment Request 9101');
    expect(ledger.closing.ILS).toBe(50000);
  });

  it('pays a euro pro forma with a shekel receipt of the same shekel value', async () => {
    const client = await makeClient();
    for (const [n, type, date, currency, total, ils] of [
      ['9301', 'Pro Forma Invoice', '2026-07-01', 'EUR', 50000, 175000],
      ['9302', 'Invoice/Receipt', '2026-07-05', 'ILS', 175000, 175000],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
           amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
         VALUES ('sumit', ?, ?, ?, ?, 'Imported Co', ?, ?, 0, ?, ?, 'unpaid', 'k', 's')`,
      )
        .bind(n, type, date, client, currency, total, total, ils)
        .run();
    }
    const ledger = await ok('GET', `/clients/${client}/ledger`);
    const receipt = ledger.entries.find((e: any) => e.display_number === 'Invoice/Receipt / 9302');
    expect(receipt).toMatchObject({ currency: 'EUR', debit_minor: 0, credit_minor: 50000 });
    expect(ledger.closing.EUR).toBe(0);
    expect(ledger.closing.ILS ?? 0).toBe(0);
  });

  it('lists an unpaid imported pro forma as an open item, and drops it once a receipt pays it', async () => {
    const { openItems } = await import('../../src/modules/reports/aggregates');
    const client = await makeClient();
    const insert = (n: string, type: string, date: string) =>
      env.DB.prepare(
        `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
           amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
         VALUES ('sumit', ?, ?, ?, ?, 'Imported Co', 'ILS', 30000, 0, 30000, 30000, 'unpaid', 'k', 's')`,
      )
        .bind(n, type, date, client)
        .run();
    await insert('9401', 'Pro Forma Invoice', '2026-09-01');
    const open = (await openItems(env.DB, '2026-09-29')).filter((i) => i.imported && i.clientId === client);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: '300', displayNumber: '9401', remainingMinor: 30000, ilsMinor: 30000, daysOverdue: 28 });

    await insert('9402', 'Invoice/Receipt', '2026-09-10');
    expect((await openItems(env.DB, '2026-09-29')).filter((i) => i.imported && i.clientId === client)).toHaveLength(0);
  });

  it('pays off a demand marked paid on its own line when its receipt was never imported', async () => {
    const client = await makeClient();
    await env.DB.prepare(
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
         amount_before_vat_minor, vat_amount_minor, total_minor, paid_status, r2_key, sha256)
       VALUES ('sumit', '9201', 'Pro Forma Invoice', '2026-07-01', ?, 'Imported Co', 'EUR', 50000, 0, 50000, 'paid', 'k', 's')`,
    )
      .bind(client)
      .run();
    const ledger = await ok('GET', `/clients/${client}/ledger`);
    expect(ledger.entries.find((e: any) => e.kind === 'imported')).toMatchObject({ debit_minor: 50000, credit_minor: 50000 });
    expect(ledger.closing.EUR).toBe(0);
  });
});

describe('imported pro forma paid by a receipt issued here', () => {
  it('reads paid in the ledger once the linked receipt is final', async () => {
    const client = await makeClient();
    const ins = await env.DB.prepare(
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
         amount_before_vat_minor, vat_amount_minor, total_minor, paid_status, r2_key, sha256)
       VALUES ('sumit', ?, 'Pro Forma Invoice', '2026-09-01', ?, 'Imported Co', 'ILS', 40000, 0, 40000, 'unpaid', 'k', 's')`,
    )
      .bind(`PF-${client}`, client)
      .run();
    const externalId = ins.meta.last_row_id;
    expect((await ok('GET', `/clients/${client}/ledger`)).closing.ILS).toBe(40000);

    const receipt = await issue('400', { clientId: client, lines: [line(40000)], payments: [pay(40000)] });
    await env.DB.prepare('INSERT INTO external_document_receipts (external_id, document_id) VALUES (?, ?)').bind(externalId, receipt.document.id).run();
    const after = await ok('GET', `/clients/${client}/ledger`);
    expect(after.closing.ILS).toBe(0);
    // The receipt pays the pro forma. It is not charged again as a sale of its own.
    const doc = after.entries.find((e: any) => e.kind === 'document' && e.document_id === receipt.document.id);
    expect(doc.debit_minor).toBe(0);
  });
});
