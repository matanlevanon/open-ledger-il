import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMe } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { btnPrimary, btnSecondary, ErrorNote, errorText, Loading, useLoad } from '../documents/ui';
import { contractsApi, type ContractStatus, type ContractSummary } from './api';
import { ExternalContractForm } from './ExternalContractForm';

/** "12 Oct" in the interface language. */
export function shortDate(iso: string | null, locale: 'en' | 'he'): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' });
}

const CHIP: Record<ContractStatus, string> = {
  draft: 'bg-surface text-muted',
  sent: 'bg-surface text-muted',
  viewed: 'bg-warning/15 text-warning',
  signed: 'bg-success/15 text-success',
  declined: 'bg-danger/10 text-danger',
  expired: 'bg-surface text-muted',
  void: 'bg-surface text-muted line-through',
};

export function ContractChip({ c }: { c: Pick<ContractSummary, 'status' | 'signedAt'> }) {
  const t = useT();
  const { locale } = usePreferences();
  return (
    <span data-testid="contract-status" className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP[c.status]}`}>
      {t(`contracts.status.${c.status}`, { date: shortDate(c.signedAt, locale) })}
    </span>
  );
}

/** R25, Screen A: every contract and work order for this client, with its status. */
export function ClientContracts({ clientId, canCreate: issuing }: { clientId: number; canCreate: boolean }) {
  const t = useT();
  const me = useLoad(() => fetchMe(), []);
  const canCreate = issuing && (me.data?.role === 'owner' || me.data?.role === 'assistant');
  const { locale } = usePreferences();
  const { data, error, reload } = useLoad(() => contractsApi.forClient(clientId), [clientId]);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Remind opens a choice of how to send, the same as the first send. Nothing goes out on the first tap.
  const [remindFor, setRemindFor] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;

  const remind = async (c: ContractSummary, how: 'email' | 'whatsapp' | 'copy') => {
    setActionError(null);
    // Opened before the request, so the browser does not block it as a pop-up.
    const tab = how === 'whatsapp' ? window.open('', '_blank') : null;
    try {
      const res = await contractsApi.remind(c.id, how === 'email' ? 'email' : 'link');
      if (how === 'whatsapp') {
        if (tab) tab.location.href = res.whatsappUrl;
        else window.open(res.whatsappUrl, '_blank');
        setNote(null);
      } else if (how === 'copy') {
        await navigator.clipboard?.writeText(res.url);
        setNote(t('contracts.sent.copied'));
      } else {
        setNote(t('contracts.reminded'));
      }
      setRemindFor(null);
      reload();
    } catch (e) {
      tab?.close();
      setActionError(errorText(e, t));
    }
  };

  return (
    <div className="rounded-card border border-line bg-canvas p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">{t('contracts.count', { n: data.contracts.length })}</span>
        {canCreate && (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setAdding(true)}>
              {t('contracts.external.add')}
            </button>
            <Link to={`/contracts/new?clientId=${clientId}`} className={btnPrimary}>
              {t('contracts.new')}
            </Link>
          </span>
        )}
      </div>
      {adding && <ExternalContractForm clientId={clientId} onCancel={() => setAdding(false)} onSaved={(c) => navigate(`/contracts/${c.id}`)} />}
      <ErrorNote error={actionError} />
      {note && (
        <p role="status" className="mt-2 text-sm text-muted">
          {note}
        </p>
      )}
      {data.contracts.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('contracts.empty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs text-muted">
                <th className="py-2 text-start font-semibold">{t('contracts.col.name')}</th>
                <th className="py-2 text-start font-semibold">{t('contracts.col.template')}</th>
                <th className="py-2 text-start font-semibold">{t('contracts.col.sent')}</th>
                <th className="py-2 text-start font-semibold">{t('contracts.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-2">
                    <bdi>{c.title}</bdi>
                  </td>
                  <td className="py-2">{c.origin === 'external' ? <span className="text-muted">{t('contracts.external.label')}</span> : <bdi>{c.templateName}</bdi>}</td>
                  <td className="py-2">{shortDate(c.origin === 'external' ? c.signedAt : c.sentAt, locale)}</td>
                  <td className="py-2">
                    <ContractChip c={c} />
                  </td>
                  <td className="py-2 text-end">
                    {canCreate && (c.status === 'sent' || c.status === 'viewed') ? (
                      remindFor === c.id ? (
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          <button type="button" className={btnSecondary} onClick={() => void remind(c, 'email')}>
                            {t('contracts.detail.remindEmail')}
                          </button>
                          <button type="button" className={btnSecondary} onClick={() => void remind(c, 'whatsapp')}>
                            {t('contracts.sent.whatsapp')}
                          </button>
                          <button type="button" className={btnSecondary} onClick={() => void remind(c, 'copy')}>
                            {t('contracts.detail.copyLink')}
                          </button>
                          <button type="button" className="text-sm text-muted underline" onClick={() => setRemindFor(null)}>
                            {t('contracts.templates.cancel')}
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={btnSecondary} onClick={() => setRemindFor(c.id)}>
                          {t('contracts.remind')}
                        </button>
                      )
                    ) : (
                      <Link to={c.status === 'draft' ? `/contracts/${c.id}/edit` : `/contracts/${c.id}`} className={btnSecondary}>
                        {c.status === 'draft' ? t('contracts.edit') : t('contracts.open')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
