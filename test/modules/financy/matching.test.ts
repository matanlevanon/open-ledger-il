import { beforeEach, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { classifyFlows } from '../../../src/modules/financy/flows';
import { matchBankTransactions, sharesWord } from '../../../src/modules/financy/matching';
import { businessesApp, finalPaymentRequest } from '../businesses/helpers';
import { env, resetFinancy } from './helpers';

/** R40 task 5: matching pulled bank rows to expenses and documents. */

let seq = 0;
async function tx(fields: { amount: number; date: string; currency?: string; account?: string; kind?: 'BANK' | 'CARD'; merchant?: string; original?: [number, string] }): Promise<number> {
  seq += 1;
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO bank_transactions (business_id, financy_id, account_financy_id, kind, booked_on, amount_minor, currency, original_amount_minor, original_currency, merchant)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `m-${seq}`,
    fields.account ?? 'acc-card',
    fields.kind ?? 'CARD',
    fields.date,
    fields.amount,
    fields.currency ?? 'ILS',
    fields.original?.[0] ?? null,
    fields.original?.[1] ?? null,
    fields.merchant ?? null,
  );
  return lastRowId;
}

async function expense(fields: { amount: number; date: string; currency?: string; supplier?: string; status?: string }): Promise<number> {
  let supplierId: number | null = null;
  if (fields.supplier) {
    supplierId = (await run(env.DB, 'INSERT INTO suppliers (name, business_id) VALUES (?, 1)', `${fields.supplier}`)).lastRowId;
  }
  const { lastRowId } = await run(
    env.DB,
    "INSERT INTO expenses (supplier_id, status, document_date, currency, amount_minor, business_id, read_status) VALUES (?, ?, ?, ?, ?, 1, 'manual')",
    supplierId,
    fields.status ?? 'new',
    fields.date,
    fields.currency ?? 'ILS',
    fields.amount,
  );
  return lastRowId;
}

const row = (id: number) => first<{ match_status: string; matched_expense_id: number | null; matched_document_id: number | null }>(env.DB, 'SELECT match_status, matched_expense_id, matched_document_id FROM bank_transactions WHERE id = ?', id);

describe('R40: matching', () => {
  beforeEach(async () => {
    await resetFinancy();
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'UPDATE expense_files SET expense_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await run(env.DB, 'DELETE FROM expense_files');
    await run(env.DB, 'DELETE FROM suppliers');
  });

  it('money out matches an expense with the same total and currency, 5 days apart at most', async () => {
    const e = await expense({ amount: 11800, date: '2026-10-01' });
    const near = await tx({ amount: -11800, date: '2026-10-06' });
    const far = await expense({ amount: 5000, date: '2026-10-01' });
    const tooFar = await tx({ amount: -5000, date: '2026-10-07' });
    expect(await matchBankTransactions(env.DB, 1)).toBe(1);
    expect(await row(near)).toMatchObject({ match_status: 'matched', matched_expense_id: e });
    expect(await row(tooFar)).toMatchObject({ match_status: 'unmatched', matched_expense_id: null });
    expect(far).toBeGreaterThan(0);
  });

  it('a different currency or amount does not match, and a Not an expense row is never used', async () => {
    await expense({ amount: 11800, date: '2026-10-01', currency: 'USD' });
    await expense({ amount: 11800, date: '2026-10-01', status: 'not_expense' });
    const t = await tx({ amount: -11800, date: '2026-10-01' });
    const other = await tx({ amount: -11700, date: '2026-10-01' });
    expect(await matchBankTransactions(env.DB, 1)).toBe(0);
    expect((await row(t))!.match_status).toBe('unmatched');
    expect((await row(other))!.match_status).toBe('unmatched');
  });

  it('a foreign charge matches on its original amount and currency', async () => {
    const e = await expense({ amount: 2000, date: '2026-10-03', currency: 'USD' });
    const t = await tx({ amount: -7460, date: '2026-10-04', original: [-2000, 'USD'] });
    await matchBankTransactions(env.DB, 1);
    expect(await row(t)).toMatchObject({ match_status: 'matched', matched_expense_id: e });
  });

  it('with two candidates, the closer date wins', async () => {
    await expense({ amount: 9900, date: '2026-10-01', supplier: 'Canva Pty' });
    const closer = await expense({ amount: 9900, date: '2026-10-04' });
    const t = await tx({ amount: -9900, date: '2026-10-05', merchant: 'CANVA* 12345' });
    await matchBankTransactions(env.DB, 1);
    expect((await row(t))!.matched_expense_id).toBe(closer);
  });

  it('with two candidates on the same day apart, a supplier that shares a word with the merchant wins', async () => {
    await expense({ amount: 9900, date: '2026-10-03', supplier: 'Figma Inc' });
    const canva = await expense({ amount: 9900, date: '2026-10-03', supplier: 'Canva Pty' });
    const t = await tx({ amount: -9900, date: '2026-10-05', merchant: 'CANVA* 12345' });
    await matchBankTransactions(env.DB, 1);
    expect((await row(t))!.matched_expense_id).toBe(canva);
  });

  it('one bank row per expense, also across syncs', async () => {
    const e = await expense({ amount: 4500, date: '2026-10-02' });
    const a = await tx({ amount: -4500, date: '2026-10-02' });
    const b = await tx({ amount: -4500, date: '2026-10-03' });
    expect(await matchBankTransactions(env.DB, 1)).toBe(1);
    expect(await row(a)).toMatchObject({ match_status: 'matched', matched_expense_id: e });
    expect((await row(b))!.match_status).toBe('unmatched');
    expect(await matchBankTransactions(env.DB, 1)).toBe(0);
  });

  it('a transfer between two of the owner accounts is not counted on either side, and never matched (R42)', async () => {
    await expense({ amount: 50000, date: '2026-10-10' });
    const out = await tx({ amount: -50000, date: '2026-10-10', account: 'acc-checking', kind: 'BANK' });
    const back = await tx({ amount: 50000, date: '2026-10-10', account: 'acc-savings', kind: 'BANK' });
    const sameAccount = await tx({ amount: 700, date: '2026-10-10', account: 'acc-checking', kind: 'BANK' });
    const sameAccountOut = await tx({ amount: -700, date: '2026-10-10', account: 'acc-checking', kind: 'BANK' });
    await classifyFlows(env.DB, 1);
    await matchBankTransactions(env.DB, 1);
    const flow = async (id: number) => (await first<{ flow: string }>(env.DB, 'SELECT flow FROM bank_transactions WHERE id = ?', id))!.flow;
    expect([await flow(out), await flow(back)]).toEqual(['own_transfer', 'own_transfer']);
    expect(await row(out)).toMatchObject({ match_status: 'unmatched', matched_expense_id: null });
    expect([await flow(sameAccount), await flow(sameAccountOut)]).toEqual(['normal', 'normal']);
    expect((await row(sameAccountOut))!.match_status).toBe('unmatched');
  });

  it('money in suggests an open payment request with the same amount, and records nothing', async () => {
    const app = businessesApp();
    const pr = await finalPaymentRequest(app, 1, 123400);
    const doc = await first<{ total_minor: number; date: string }>(env.DB, 'SELECT total_minor, date FROM documents WHERE id = ?', pr.id);
    const day = (offset: number) => {
      const d = new Date(`${doc!.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const early = await tx({ amount: doc!.total_minor, date: day(-11), account: 'acc-checking', kind: 'BANK' });
    const deposit = await tx({ amount: doc!.total_minor, date: day(3), account: 'acc-checking', kind: 'BANK' });
    const card = await tx({ amount: doc!.total_minor, date: day(3), account: 'acc-card', kind: 'CARD' });
    await matchBankTransactions(env.DB, 1);
    expect(await row(early)).toMatchObject({ matched_document_id: null });
    expect(await row(deposit)).toMatchObject({ match_status: 'unmatched', matched_document_id: pr.id });
    expect(await row(card)).toMatchObject({ matched_document_id: null });
    const paid = await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE document_id = ?', pr.id);
    expect(paid?.n ?? 0).toBe(0);
  });

  it('shares a word ignores case, punctuation and company suffixes', () => {
    expect(sharesWord('Canva Pty Ltd', 'CANVA* SUBSCRIPTION')).toBe(true);
    expect(sharesWord('Acme Ltd', 'Other Ltd')).toBe(false);
    expect(sharesWord(null, 'x')).toBe(false);
  });
});
