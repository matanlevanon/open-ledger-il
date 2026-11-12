import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { switchBusiness } from '../../app/business';
import { type MessageKey, useT } from '../../i18n';

/**
 * R48 task 7: the Clients page of the firm edition. One row per client business: VAT due or the
 * ceiling, the Tax Authority login, the signing certificate, the unified file, open payment
 * requests, expenses to review and the last activity. Click a row to open the business.
 */
export interface ClientRow {
  id: number;
  nameEn: string;
  nameHe: string;
  taxId: string | null;
  entityType: 'osek_patur' | 'osek_murshe' | 'company';
  status: 'active' | 'moved_out';
  vat: { due: string; amountMinor: number } | null;
  ceiling: { percent: number } | null;
  ita: 'connected' | 'reconnect_required' | 'none';
  signingNotAfter: string | null;
  unifiedFileSent: boolean;
  openPaymentRequests: number;
  expensesToReview: number;
  lastActivity: string | null;
  needsAttention: boolean;
}

interface ClientsPage {
  total: number;
  page: number;
  pageSize: number;
  clients: ClientRow[];
}

export const fetchClients = (params: { page: number; q: string; attention: boolean; sort: string }) =>
  apiGet<ClientsPage>(`/firm/clients?page=${params.page}&sort=${params.sort}${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}${params.attention ? '&attention=1' : ''}`);

const ITA_LABEL: Record<ClientRow['ita'], MessageKey> = {
  connected: 'firm.clients.itaConnected',
  reconnect_required: 'firm.clients.itaReconnect',
  none: 'firm.clients.itaNone',
};

const money = (minor: number) => (minor / 100).toLocaleString('en-IL', { style: 'currency', currency: 'ILS' });

export function ClientsPage({ load = fetchClients, open = switchBusiness }: { load?: typeof fetchClients; open?: (id: number) => void }) {
  const t = useT();
  const [data, setData] = useState<ClientsPage | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [attention, setAttention] = useState(false);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);

  useEffect(() => {
    load({ page, q, attention, sort })
      .then(setData)
      .catch(() => setForbidden(true));
  }, [load, page, q, attention, sort]);

  if (forbidden) return <p className="text-sm text-muted">{t('firm.clients.forbidden')}</p>;
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-6xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('firm.clients.title')}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder={t('firm.clients.search')}
          aria-label={t('firm.clients.search')}
          className="rounded-md border border-line px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} />
          {t('firm.clients.attention')}
        </label>
        <select aria-label={t('firm.clients.sort')} value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm">
          <option value="name">{t('firm.clients.sortName')}</option>
          <option value="vat">{t('firm.clients.sortVat')}</option>
          <option value="activity">{t('firm.clients.sortActivity')}</option>
        </select>
      </div>
      {!data ? (
        <p className="mt-4 text-sm text-muted">{t('settings.loading')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-2 text-start">{t('firm.clients.business')}</th>
                <th className="text-start">{t('firm.clients.vatOrCeiling')}</th>
                <th className="text-start">{t('firm.clients.ita')}</th>
                <th className="text-start">{t('firm.clients.signing')}</th>
                <th className="text-start">{t('firm.clients.openRequests')}</th>
                <th className="text-start">{t('firm.clients.toReview')}</th>
                <th className="text-start">{t('firm.clients.lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr
                  key={c.id}
                  data-testid="client-row"
                  onClick={() => open(c.id)}
                  className={`cursor-pointer border-t border-line hover:bg-surface ${c.status === 'moved_out' ? 'opacity-60' : ''}`}
                >
                  <td className="py-2">
                    <span className="font-semibold text-ink">{c.nameHe || c.nameEn}</span>
                    {c.needsAttention && <span className="ms-2 rounded-full bg-warning/20 px-2 text-xs">{t('firm.clients.attentionBadge')}</span>}
                    <span className="block text-xs text-muted" dir="ltr">
                      {c.taxId}
                    </span>
                  </td>
                  <td>{c.vat ? t('firm.clients.vatDue', { date: c.vat.due, amount: money(c.vat.amountMinor) }) : c.ceiling ? t('firm.clients.ceiling', { percent: String(c.ceiling.percent) }) : ''}</td>
                  <td>{t(ITA_LABEL[c.ita])}</td>
                  <td>{c.signingNotAfter ? c.signingNotAfter.slice(0, 10) : t('firm.clients.noKey')}</td>
                  <td>{c.openPaymentRequests}</td>
                  <td>{c.expensesToReview}</td>
                  <td>{c.lastActivity ? c.lastActivity.slice(0, 10) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.pageSize && (
            <div className="mt-3 flex gap-2 text-sm">
              <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t('firm.clients.previous')}
              </button>
              <span>{t('firm.clients.pageOf', { page: String(page), pages: String(Math.ceil(data.total / data.pageSize)) })}</span>
              <button type="button" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                {t('firm.clients.next')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
