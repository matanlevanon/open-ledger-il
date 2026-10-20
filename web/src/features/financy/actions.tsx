import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dialog } from '../../components/Dialog';
import { type MessageKey, useT } from '../../i18n';
import { btnSecondary, input } from '../documents/ui';
import { type BankTransaction, type MatchCandidate, type RowStatus, financyApi, formatMinor } from './api';

/**
 * R42: what the Financy Dashboard and Expenses > Bank activity share, so both screens act the
 * same. The status of a row, its actions, and the picker that matches a row by hand.
 */

export const STATUS_KEYS: Record<RowStatus, MessageKey> = {
  matched: 'financy.status.matched',
  to_match: 'financy.status.toMatch',
  suggested: 'financy.status.suggested',
  not_business: 'financy.status.notBusiness',
  not_counted: 'financy.status.notCounted',
};

const STATUS_CLASS: Record<RowStatus, string> = {
  matched: 'bg-success/15 text-success',
  to_match: 'bg-band text-brand',
  suggested: 'bg-warning/15 text-ink border border-warning/40',
  not_business: 'bg-canvas text-muted border border-line',
  not_counted: 'bg-canvas text-muted border border-dashed border-line',
};

/** The status chip. A matched row links to its expense. */
export function StatusCell({ tx }: { tx: BankTransaction }) {
  const t = useT();
  const chip = <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[tx.status]}`}>{t(STATUS_KEYS[tx.status])}</span>;
  if (tx.status === 'matched' && tx.expenseId !== null) {
    return (
      <Link to={`/expenses/${tx.expenseId}`} className="hover:underline" title={t('financy.action.openExpense')}>
        {chip}
      </Link>
    );
  }
  return chip;
}

const link = 'rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50';
const primary = `${link} border-brand text-brand hover:bg-band`;
const quiet = `${link} border-line text-ink hover:bg-canvas`;

/**
 * The row's actions by status: Add as expense, Match to expense or document, Not a business
 * expense, Record payment on a suggestion, Unmatch, Count this. Nothing records a payment here.
 */
export function RowActions({ tx, onChange, onError }: { tx: BankTransaction; onChange: (next: BankTransaction) => void; onError: (message: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const run = async (action: () => Promise<{ transaction: BankTransaction }>) => {
    setBusy(true);
    try {
      onChange((await action()).transaction);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : t('financy.action.error'));
    } finally {
      setBusy(false);
    }
  };
  const out = tx.amountMinor < 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tx.status === 'to_match' && out && (
        <>
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => financyApi.addExpense(tx.id))}>
            {t('financy.action.addExpense')}
          </button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setPicking(true)}>
            {t('financy.action.matchExpense')}
          </button>
          <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => financyApi.ignore(tx.id))}>
            {t('financy.action.notBusiness')}
          </button>
        </>
      )}
      {tx.status === 'to_match' && !out && (
        <button type="button" className={quiet} disabled={busy} onClick={() => setPicking(true)}>
          {t('financy.action.matchDocument')}
        </button>
      )}
      {tx.status === 'not_business' && (
        <button type="button" className={quiet} disabled={busy} onClick={() => setPicking(true)}>
          {t('financy.action.matchExpense')}
        </button>
      )}
      {tx.status === 'suggested' && tx.suggestion && (
        <Link to={`/income/documents/${tx.suggestion.documentId}?payAmount=${tx.amountMinor}&payOn=${tx.date}`} className={primary}>
          {t('financy.action.recordPayment', { number: tx.suggestion.displayNumber ?? String(tx.suggestion.documentId) })}
        </Link>
      )}
      {(tx.status === 'suggested' || (tx.status === 'matched' && tx.matchStatus === 'matched')) && (
        <button type="button" className={quiet} disabled={busy} onClick={() => void run(() => financyApi.unmatch(tx.id))}>
          {t('financy.action.unmatch')}
        </button>
      )}
      {tx.status === 'not_counted' && (
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => financyApi.count(tx.id))}>
          {t('financy.action.count')}
        </button>
      )}
      {picking && <MatchPicker tx={tx} onClose={() => setPicking(false)} onMatched={onChange} onError={onError} />}
    </div>
  );
}

/**
 * Match by hand. Money out lists expenses within 15 days in the same currency, closest amount
 * first. Money in lists open payment requests and transaction invoices. Picking a document makes
 * it the suggestion and opens Record payment filled in, where the person confirms.
 */
export function MatchPicker({ tx, onClose, onMatched, onError }: { tx: BankTransaction; onClose: () => void; onMatched: (next: BankTransaction) => void; onError: (message: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<MatchCandidate[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      financyApi
        .candidates(tx.id, q)
        .then((r) => live && setItems(r.candidates))
        .catch(() => live && setItems([]));
    }, q ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tx.id, q]);

  const pick = async (c: MatchCandidate) => {
    try {
      const res = await financyApi.match(tx.id, c.kind === 'expense' ? { expenseId: c.id } : { documentId: c.id });
      onMatched(res.transaction);
      onClose();
      if (c.kind === 'document') navigate(`/income/documents/${c.id}?payAmount=${tx.amountMinor}&payOn=${tx.date}`);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : t('financy.action.error'));
    }
  };

  return (
    <Dialog
      open
      title={tx.amountMinor < 0 ? t('financy.action.matchExpense') : t('financy.action.matchDocument')}
      onClose={onClose}
      footer={
        <button type="button" className={btnSecondary} onClick={onClose}>
          {t('financy.cancel')}
        </button>
      }
    >
      <p className="mb-2 text-sm text-muted" dir="auto">
        {tx.merchant ?? tx.description} <span className="ltr-nums">{formatMinor(tx.amountMinor, tx.currency)}</span> <span className="ltr-nums">{tx.date}</span>
      </p>
      <label className="sr-only" htmlFor={`match-q-${tx.id}`}>
        {t('financy.pick.search')}
      </label>
      <input id={`match-q-${tx.id}`} className={input} placeholder={t('financy.pick.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 overflow-y-auto">
        {items === null ? (
          <p className="text-sm text-muted">{t('financy.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{tx.amountMinor < 0 ? t('financy.pick.noExpenses') : t('financy.pick.noDocuments')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((c) => (
              <li key={`${c.kind}-${c.id}`}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-1 py-2 text-start text-sm hover:bg-canvas" onClick={() => void pick(c)}>
                  <span dir="auto">
                    {c.label}
                    {c.date && <span className="ltr-nums ms-2 text-xs text-muted">{c.date}</span>}
                  </span>
                  <span className="ltr-nums font-semibold">{formatMinor(c.amountMinor, c.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
