import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchMe } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorNote, errorText, input, label, Loading, PageTitle, useLoad } from '../documents/ui';
import { contractsApi } from './api';
import { ContractChip } from './ClientContracts';

function eventTime(iso: string, locale: 'en' | 'he'): string {
  return new Date(iso).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A short device name from a user agent: "iPhone Safari", "Windows Chrome". */
export function deviceOf(ua: string | null): string {
  if (!ua) return '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' ') || ua.slice(0, 40);
}

/** "84.229.x.x": the record keeps the full address, the screen shows the network part. */
export function maskIp(ip: string | null): string {
  if (!ip) return '';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : ip;
}

/** R25, Screen D: the record you keep. Signed PDF, events, pro forma. */
export function ContractPage() {
  const t = useT();
  const { locale } = usePreferences();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const me = useLoad(() => fetchMe(), []);
  const { data, error, reload } = useLoad(() => contractsApi.get(id), [id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const c = data.contract;
  const canAct = me.data?.role === 'owner' || me.data?.role === 'assistant';
  const open = c.status === 'sent' || c.status === 'viewed';

  async function act(work: () => Promise<unknown>, done?: string) {
    setActionError(null);
    try {
      await work();
      if (done) setNote(done);
      reload();
    } catch (e) {
      setActionError(errorText(e, t));
    }
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      {c.status === 'signed' && (
        <a className={btnSecondary} href={contractsApi.pdfUrl(c.id, 'signed', true)}>
          {t('contracts.detail.downloadSigned')}
        </a>
      )}
      {c.status !== 'draft' && c.status !== 'signed' && (
        <a className={btnSecondary} href={contractsApi.pdfUrl(c.id, 'sent')} target="_blank" rel="noreferrer">
          {t('contracts.detail.viewSent')}
        </a>
      )}
      {c.status === 'draft' && canAct && (
        <Link className={btnPrimary} to={`/contracts/${c.id}/edit`}>
          {t('contracts.edit')}
        </Link>
      )}
      {c.status === 'signed' && c.kind === 'work_order' && canAct && !c.linkedDocumentId && (
        <button
          type="button"
          className={btnPrimary}
          onClick={() =>
            void act(async () => {
              const res = await contractsApi.proforma(c.id);
              navigate(`/income/documents/${res.documentId}/edit`);
            })
          }
        >
          {t('contracts.detail.createProforma')}
        </button>
      )}
      {c.linkedDocumentId && (
        <Link className={btnPrimary} to={`/income/documents/${c.linkedDocumentId}`}>
          {t('contracts.detail.openProforma')}
        </Link>
      )}
    </div>
  );

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <PageTitle
        actions={actions}
        subtitle={
          <>
            {t('contracts.detail.client')}: <Link to={`/clients/${c.clientId}`} className="text-accent-2 hover:underline"><bdi>{c.clientName}</bdi></Link> · {c.templateName} · {t('contracts.detail.version', { n: c.templateVersion })}
          </>
        }
      >
        <bdi>{c.title}</bdi> <ContractChip c={c} />
      </PageTitle>
      <ErrorNote error={actionError} />
      {note && (
        <p role="status" className="mb-3 text-sm text-muted">
          {note}
        </p>
      )}

      {c.status === 'signed' && <p className="mb-3 text-sm text-muted">{t('contracts.detail.signedNote')}</p>}
      {c.status === 'declined' && c.declineReason && <p className="mb-3 text-sm text-danger">{t('contracts.detail.declined', { reason: c.declineReason })}</p>}
      {open && c.expiresAt && <p className="mb-3 text-sm text-muted">{t('contracts.detail.expires', { date: c.expiresAt.slice(0, 10) })}</p>}

      <Card title={t('contracts.detail.events')}>
        <ul className="flex flex-col gap-1 text-sm" data-testid="contract-events">
          {c.events.map((e) => (
            <li key={e.id}>
              <span className="ltr-nums text-muted">{eventTime(e.at, locale)}</span> · <bdi>{e.label}</bdi>
              {e.ip && <span className="text-muted"> · IP {maskIp(e.ip)}</span>}
              {e.userAgent && e.role === 'signer' && <span className="text-muted"> · {deviceOf(e.userAgent)}</span>}
            </li>
          ))}
        </ul>
        {c.identityMethod && <p className="mt-3 text-xs text-muted">{t(c.identityMethod === 'email_code' ? 'contracts.detail.identityCode' : 'contracts.detail.identityLink')}</p>}
        {c.sentSha256 && (
          <p className="mt-2 break-all text-xs text-muted ltr-nums">
            {t('contracts.detail.sentHash')}: {c.sentSha256}
          </p>
        )}
        {c.signedSha256 && (
          <p className="mt-1 break-all text-xs text-muted ltr-nums">
            {t('contracts.detail.signedHash')}: {c.signedSha256}
          </p>
        )}
      </Card>

      {c.status === 'signed' && c.kind === 'work_order' && !c.linkedDocumentId && canAct && (
        <p className="mt-3 rounded-md bg-surface px-3 py-2 text-sm">{t('contracts.detail.proformaNote', { client: c.clientName })}</p>
      )}

      {canAct && open && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.emailReady && (
            <button type="button" className={btnSecondary} onClick={() => void act(() => contractsApi.remind(c.id, 'email'), t('contracts.reminded'))}>
              {t('contracts.detail.remindEmail')}
            </button>
          )}
          <button
            type="button"
            className={btnSecondary}
            onClick={() =>
              void act(async () => {
                const res = await contractsApi.remind(c.id, 'link');
                await navigator.clipboard?.writeText(res.url);
              }, t('contracts.sent.copied'))
            }
          >
            {t('contracts.detail.copyLink')}
          </button>
        </div>
      )}

      {canAct && c.status !== 'signed' && c.status !== 'void' && (
        <div className="mt-6">
          {voiding ? (
            <div className="flex flex-col gap-2">
              <label className="block">
                <span className={label}>{t('contracts.detail.voidReason')}</span>
                <input className={input} dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="button" className={btnSecondary} onClick={() => setVoiding(false)}>
                  {t('contracts.templates.cancel')}
                </button>
                <button type="button" className={btnDanger} onClick={() => void act(() => contractsApi.void(c.id, reason || null)).then(() => setVoiding(false))}>
                  {t('contracts.detail.voidConfirm')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={btnDanger} onClick={() => setVoiding(true)}>
              {t('contracts.detail.void')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
