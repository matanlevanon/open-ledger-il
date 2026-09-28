import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { clientsApi } from './api';
import { clientName, money, totalsText } from './format';
import { Card, ErrorNote, Loading, btnSecondary, input, label, useLoad } from './ui';

/** Client book (תוספת ה׳): documents and payments with a running balance per currency. Printable. */
export function LedgerView({ clientId }: { clientId: number }) {
  const t = useT();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error } = useLoad(() => clientsApi.ledger(clientId, from || undefined, to || undefined), [clientId, from, to]);

  return (
    <Card
      title={t('ledger.title')}
      actions={
        <button type="button" className={`${btnSecondary} print:hidden`} onClick={() => window.print()}>
          {t('ledger.print')}
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <label>
          <span className={label}>{t('ledger.fromLabel')}</span>
          <input type="date" dir="ltr" aria-label={t('ledger.fromLabel')} className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className={label}>{t('ledger.toLabel')}</span>
          <input type="date" dir="ltr" aria-label={t('ledger.toLabel')} className={input} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {t('ledger.openingBalance')} <span className="ltr-nums font-semibold text-ink">{totalsText(data.opening)}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-band text-start text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">{t('ledger.colDate')}</th>
                  <th className="px-3 py-2">{t('ledger.colDocument')}</th>
                  <th className="px-3 py-2">{t('ledger.colDetails')}</th>
                  <th className="px-3 py-2 text-end">{t('ledger.colCharged')}</th>
                  <th className="px-3 py-2 text-end">{t('ledger.colPaid')}</th>
                  <th className="px-3 py-2 text-end">{t('ledger.colBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted">
                      {t('ledger.emptyPeriod')}
                    </td>
                  </tr>
                )}
                {data.entries.map((e, i) => (
                  <tr key={i} className={`border-t border-line ${e.status === 'cancelled' ? 'text-muted line-through' : ''}`}>
                    <td className="ltr-nums px-3 py-2 tabular-nums">{e.kind === 'payment' ? e.paid_on : e.date}</td>
                    <td className="px-3 py-2">
                      {e.kind === 'document' ? (
                        <Link to={`/income/documents/${e.document_id}`} className="text-brand hover:underline">
                          {e.display_number}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {e.description}
                      {e.reference && <span className="text-muted"> ({e.reference})</span>}
                    </td>
                    <td className="ltr-nums px-3 py-2 text-end tabular-nums">{e.debit_minor ? money(e.debit_minor, e.currency) : ''}</td>
                    <td className="ltr-nums px-3 py-2 text-end tabular-nums">{e.credit_minor ? money(e.credit_minor, e.currency) : ''}</td>
                    <td className="ltr-nums px-3 py-2 text-end tabular-nums">{money(e.balance_minor, e.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            {t('ledger.closingBalance')} <span className="ltr-nums font-semibold text-ink">{totalsText(data.closing)}</span>
          </p>
        </>
      )}
    </Card>
  );
}

/** Statements: pick a client, see the client book. */
export function StatementsPage() {
  const t = useT();
  const { locale } = usePreferences();
  const [clientId, setClientId] = useState<number | null>(null);
  const { data } = useLoad(() => clientsApi.list({ active: 'all' }), []);
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="mb-6 font-heading text-3xl text-ink">
        {t('ledger.statementsTitle')}
      </h1>
      <label className="mb-4 block max-w-sm">
        <span className={label}>{t('ledger.clientLabel')}</span>
        <select className={input} value={clientId ?? ''} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('ledger.pickClient')}</option>
          {data?.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {clientName(c, locale)}
            </option>
          ))}
        </select>
      </label>
      {clientId && <LedgerView clientId={clientId} />}
    </section>
  );
}
