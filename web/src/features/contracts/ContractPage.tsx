import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchMe } from '../../api/client';
import { DemoReadOnlyNote, useDemoReadOnly } from '../../app/demo';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorNote, errorText, input, label, Loading, PageTitle, useLoad } from '../documents/ui';
import { contractsApi, type ContractOverview, type ExternalRecord } from './api';
import { ContractChip } from './ClientContracts';
import { BackLink, contractParent } from '../../components/BackLink';

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

/** The record at a glance: services, key terms, who signed and when. No PDF needed. */
function Overview({ o, status, locale }: { o: ContractOverview; status: string; locale: 'en' | 'he' }) {
  const t = useT();
  return (
    <Card title={t('contracts.overview.title')}>
      <style>{"@font-face { font-family: 'Dancing Script'; src: url(/api/sending/public/c/font/dancing.woff2) format('woff2'); font-display: swap; }"}</style>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('contracts.overview.signature')}</h3>
          {o.signedBy ? (
            <div className="rounded-md border border-line p-3" data-testid="overview-signed">
              <p className="text-muted text-xs">{t('contracts.overview.signedBy')}</p>
              <p dir="auto" style={{ fontFamily: "'Dancing Script', cursive" }} className="text-2xl leading-tight">
                <bdi>{o.signedBy.name}</bdi>
              </p>
              <p className="text-sm">
                <bdi>{o.signedBy.name}</bdi>
                {o.signedBy.role && (
                  <>
                    , <bdi>{o.signedBy.role}</bdi>
                  </>
                )}
              </p>
              <p className="ltr-nums text-xs text-muted">
                {eventTime(o.signedBy.at, locale)}
                {o.signedBy.ip && <> · IP {o.signedBy.ip}</>}
                {o.signedBy.device && <> · {o.signedBy.device}</>}
              </p>
              {o.signedBy.identity && <p className="mt-1 text-xs text-muted">{t(o.signedBy.identity === 'email_code' ? 'contracts.detail.identityCode' : 'contracts.detail.identityLink')}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">{t(status === 'draft' ? 'contracts.overview.draft' : 'contracts.overview.notSigned')}</p>
          )}
          {o.ownerSignedAt && <p className="ltr-nums mt-2 text-xs text-muted">{t('contracts.overview.ownerSigned', { date: eventTime(o.ownerSignedAt, locale) })}</p>}
        </div>
        {o.terms.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('contracts.overview.terms')}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {o.terms.map((x) => (
                <div key={x.key} className="contents">
                  <dt className="text-muted">
                    <bdi>{x.label}</bdi>
                  </dt>
                  <dd dir="auto">
                    <bdi>{x.value}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      {o.services.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">{t('contracts.overview.services')}</h3>
          <div className="flex flex-col gap-2">
            {o.services.map((sv, i) => (
              <div key={i} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    <bdi>{sv.name}</bdi>
                    {sv.model && <span className="ms-2 text-xs font-normal text-muted"><bdi>{sv.model}</bdi></span>}
                  </p>
                  {sv.fee && <p className="ltr-nums text-lg font-semibold">{sv.fee}</p>}
                </div>
                {sv.items.length > 0 && (
                  <ul className="mt-1 list-disc ps-5 text-sm text-muted">
                    {sv.items.map((it, j) => (
                      <li key={j}>
                        <bdi>{it}</bdi>
                      </li>
                    ))}
                  </ul>
                )}
                {sv.other && <p className="mt-1 text-sm text-muted"><bdi>{sv.other}</bdi></p>}
                {sv.note && <p className="mt-1 text-sm italic text-muted"><bdi>{sv.note}</bdi></p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/** R28: the Overview of a contract signed elsewhere shows what the owner entered at upload. */
function ExternalOverview({ x }: { x: ExternalRecord }) {
  const t = useT();
  const rows: [string, string | null][] = [
    [t('contracts.external.signer'), [x.signerName, x.signerRole].filter(Boolean).join(', ') || null],
    [t('contracts.external.signerEmail'), x.signerEmail],
    [t('contracts.external.signedDate'), x.signedDate],
    [t('contracts.external.start'), x.startDate],
    [t('contracts.external.end'), x.endDate],
    [t('contracts.external.fee'), x.fee],
  ];
  return (
    <Card title={t('contracts.overview.title')}>
      <h3 className="mb-2 text-sm font-semibold">{t('contracts.external.details')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="external-overview">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd dir="auto" className="ltr-nums">
                <bdi>{v}</bdi>
              </dd>
            </div>
          ))}
      </dl>
      {x.notes && (
        <p dir="auto" className="mt-3 whitespace-pre-line text-sm">
          <bdi>{x.notes}</bdi>
        </p>
      )}
    </Card>
  );
}

/**
 * R28: the Record card (events, identity line and hashes) starts closed. The header button opens
 * and closes it and says how many events it holds.
 */
function RecordCard({ count, children }: { count: number; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-4 rounded-card border border-line bg-canvas p-4 shadow-card md:p-6">
      <h2 className="text-lg font-semibold text-ink">
        <button type="button" aria-expanded={open} aria-controls="contract-record" className="flex w-full items-center justify-between gap-2 text-start" onClick={() => setOpen(!open)}>
          <span>{count === 1 ? t('contracts.detail.recordToggleOne') : t('contracts.detail.recordToggle', { n: String(count) })}</span>
          <span aria-hidden="true" className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
      </h2>
      {open && (
        <div id="contract-record" className="mt-3">
          {children}
        </div>
      )}
    </section>
  );
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
  // R29: on the demo the sample contracts are read-only. A visitor's own contracts are drafts.
  const demoReadOnly = useDemoReadOnly(data?.contract);
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const c = data.contract;
  const canAct = (me.data?.role === 'owner' || me.data?.role === 'assistant') && !demoReadOnly;
  const open = c.status === 'sent' || c.status === 'viewed';
  const external = c.origin === 'external';

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
      {(c.status === 'signed' || external) && (
        <a className={btnSecondary} href={contractsApi.pdfUrl(c.id, 'signed', true)}>
          {t(external ? 'contracts.external.download' : 'contracts.detail.downloadSigned')}
        </a>
      )}
      {c.status !== 'draft' && c.status !== 'signed' && !external && (
        <a className={btnSecondary} href={contractsApi.pdfUrl(c.id, 'sent')} target="_blank" rel="noreferrer">
          {t('contracts.detail.viewSent')}
        </a>
      )}
      {c.status === 'draft' && canAct && (
        <Link className={btnPrimary} to={`/contracts/${c.id}/edit`}>
          {t('contracts.edit')}
        </Link>
      )}
      {c.status === 'signed' && c.kind === 'work_order' && canAct && !c.linkedDocumentId && !external && (
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
      <BackLink to={contractParent(c.clientId)} />
      <PageTitle
        actions={actions}
        subtitle={
          <>
            {t('contracts.detail.client')}: <Link to={`/clients/${c.clientId}`} className="text-accent-2 hover:underline"><bdi>{c.clientName}</bdi></Link> ·{' '}
            {external ? t('contracts.external.label') : <>{c.templateName} · {t('contracts.detail.version', { n: c.templateVersion })}</>}
          </>
        }
      >
        <bdi>{c.title}</bdi> <ContractChip c={c} />
      </PageTitle>
      <ErrorNote error={actionError} />
      {demoReadOnly && <DemoReadOnlyNote />}
      {note && (
        <p role="status" className="mb-3 text-sm text-muted">
          {note}
        </p>
      )}

      {c.status === 'signed' && !external && <p className="mb-3 text-sm text-muted">{t('contracts.detail.signedNote')}</p>}
      {c.status === 'declined' && c.declineReason && <p className="mb-3 text-sm text-danger">{t('contracts.detail.declined', { reason: c.declineReason })}</p>}
      {open && c.expiresAt && <p className="mb-3 text-sm text-muted">{t('contracts.detail.expires', { date: c.expiresAt.slice(0, 10) })}</p>}

      {external && c.external ? <ExternalOverview x={c.external} /> : c.overview && <Overview o={c.overview} status={c.status} locale={locale} />}

      {external ? (
        <RecordCard count={c.events.length}>
          <p className="text-sm" data-testid="external-record">{t('contracts.external.recordNote')}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="contract-events">
            {c.events.map((e) => (
              <li key={e.id}>
                <span className="ltr-nums text-muted">{eventTime(e.at, locale)}</span> · <bdi>{e.label}</bdi>
              </li>
            ))}
          </ul>
          {c.signedSha256 && (
            <p className="mt-2 break-all text-xs text-muted ltr-nums">
              {t('contracts.external.fileHash')}: {c.signedSha256}
            </p>
          )}
        </RecordCard>
      ) : (
      <RecordCard count={c.events.length}>
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
      </RecordCard>
      )}

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
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              const tab = window.open('', '_blank');
              void act(async () => {
                const res = await contractsApi.remind(c.id, 'link');
                if (tab) tab.location.href = res.whatsappUrl;
                else window.open(res.whatsappUrl, '_blank');
              }, t('contracts.reminded'));
            }}
          >
            {t('contracts.sent.whatsapp')}
          </button>
        </div>
      )}

      {canAct && (c.status !== 'signed' || external) && c.status !== 'void' && (
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
