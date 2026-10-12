import { useEffect, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { useToast } from '../../components/Toast';
import { type MessageKey, useT } from '../../i18n';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';
import {
  type BusinessDocument,
  type BusinessDocumentType,
  type DocumentsList,
  type ShareLink,
  confirmDocument,
  emailDocument,
  fetchDocuments,
  fetchLinks,
  fileUrl,
  revokeLink,
  shareDocument,
  storePrefill,
  uploadDocument,
} from './api';

export interface BusinessDocumentsApi {
  load: typeof fetchDocuments;
  upload: typeof uploadDocument;
  confirm: typeof confirmDocument;
  share: typeof shareDocument;
  email: typeof emailDocument;
  links: typeof fetchLinks;
  revoke: typeof revokeLink;
}

const DEFAULT_API: BusinessDocumentsApi = {
  load: fetchDocuments,
  upload: uploadDocument,
  confirm: confirmDocument,
  share: shareDocument,
  email: emailDocument,
  links: fetchLinks,
  revoke: revokeLink,
};

interface Props {
  /** Injected in tests. */
  api?: BusinessDocumentsApi;
  /** "Use these details": Settings switches to the Business tab. Elsewhere it opens Settings. */
  onUseDetails?: () => void;
}

/**
 * R24 Phase C: Settings > Business documents. The owner uploads and confirms. Owner and assistant
 * view, download and share. An accountant with the switch on views. Share links expire after 1, 7
 * or 30 days and can be revoked.
 */
export function BusinessDocumentsPanel({ api = DEFAULT_API, onUseDetails }: Props) {
  const t = useT();
  const toast = useToast();
  const { locale } = usePreferences();
  const [data, setData] = useState<DocumentsList | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<number | null>(null);

  const reload = async () => {
    const d = await api.load();
    setData(d);
    if (d.canShare) setLinks((await api.links()).links);
  };

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : t('bdocs.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (error && !data) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const typeName = (d: { typeLabel: { en: string; he: string } }) => (locale === 'he' ? d.typeLabel.he : d.typeLabel.en);
  const useDetails = (d: BusinessDocument) => {
    storePrefill({ nameEn: d.extracted?.nameEn ?? undefined, nameHe: d.extracted?.nameHe ?? undefined, taxId: d.extracted?.taxId ?? undefined });
    if (onUseDetails) onUseDetails();
    else window.location.assign('/settings?tab=business');
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <p className="text-sm text-muted">{t('bdocs.intro')}</p>
      {data.canManage && (
        <UploadForm
          types={data.types}
          readerOn={data.reader.keySet}
          typeName={typeName}
          onUpload={async (input) => {
            const res = await api.upload(input);
            if (res.readError) toast.push(t('bdocs.readFailed'), 'danger');
            await reload();
          }}
        />
      )}

      <section aria-labelledby="bdocs-list">
        <h2 id="bdocs-list" className="font-heading text-lg text-ink">
          {t('bdocs.listTitle')}
        </h2>
        {data.documents.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('bdocs.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {data.documents.map((d) => (
              <li key={d.id} className="px-3 py-3 text-sm" data-testid={`bdoc-${d.id}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold text-ink">{typeName(d)}</span>
                  <span className="text-muted">{d.fileName}</span>
                  {!d.current && <span className="rounded-full bg-surface px-2 text-xs text-muted">{t('bdocs.replaced')}</span>}
                  {d.current && !d.confirmedAt && <span className="rounded-full bg-surface px-2 text-xs text-danger">{t('bdocs.notConfirmed')}</span>}
                  <span className="ltr-nums text-muted">
                    {t('bdocs.dates', { issue: d.issueDate ?? '-', until: d.validUntil ?? '-' })}
                  </span>
                  <span className="text-xs text-muted">{t('bdocs.uploaded', { who: d.uploadedBy ?? '-', when: d.uploadedAt.slice(0, 10) })}</span>
                  <span className="ms-auto flex flex-wrap gap-2">
                    <a className={btnSecondary} href={fileUrl(d.id)} target="_blank" rel="noreferrer">
                      {t('bdocs.view')}
                    </a>
                    <a className={btnSecondary} href={fileUrl(d.id, true)}>
                      {t('bdocs.download')}
                    </a>
                    {data.canShare && (
                      <button type="button" className={btnSecondary} onClick={() => setSharing(sharing === d.id ? null : d.id)}>
                        {t('bdocs.share')}
                      </button>
                    )}
                  </span>
                </div>
                {data.canManage && d.current && !d.confirmedAt && (
                  <ReviewCard doc={d} expires={data.types.find((x) => x.type === d.type)?.expires ?? false} onConfirm={async (v) => {
                    await api.confirm(d.id, v);
                    await reload();
                  }} onUseDetails={() => useDetails(d)} />
                )}
                {sharing === d.id && (
                  <SharePanel
                    days={data.shareDays}
                    onLink={async (days, channel) => (await api.share(d.id, days, channel)).link.url}
                    onEmail={async (days, to) => {
                      await api.email(d.id, days, to);
                    }}
                    onDone={() => void reload()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.canShare && (
        <section aria-labelledby="bdocs-links">
          <h2 id="bdocs-links" className="font-heading text-lg text-ink">
            {t('bdocs.linksTitle')}
          </h2>
          {links.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('bdocs.noLinks')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-ink">{l.fileName}</span>
                  <span className="text-muted">{t(`bdocs.channel.${l.channel}` as MessageKey)}{l.sentTo ? ` ${l.sentTo}` : ''}</span>
                  <span className="ltr-nums text-muted">{t('bdocs.linkExpires', { date: l.expiresAt.slice(0, 10) })}</span>
                  <span className="text-xs text-muted">{t('bdocs.opened', { count: String(l.openCount) })}</span>
                  <button
                    type="button"
                    className={`${btnSecondary} ms-auto`}
                    onClick={async () => {
                      try {
                        setLinks((await api.revoke(l.id)).links);
                      } catch (err) {
                        toast.push(err instanceof Error ? err.message : t('bdocs.actionError'), 'danger');
                      }
                    }}
                  >
                    {t('bdocs.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function UploadForm({
  types,
  readerOn,
  typeName,
  onUpload,
}: {
  types: DocumentsList['types'];
  readerOn: boolean;
  typeName: (d: { typeLabel: { en: string; he: string } }) => string;
  onUpload: (input: { file: File; type: BusinessDocumentType; issueDate?: string; validUntil?: string }) => Promise<void>;
}) {
  const t = useT();
  const [type, setType] = useState<BusinessDocumentType>(types[0]?.type ?? 'other');
  const [file, setFile] = useState<File | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expires = types.find((x) => x.type === type)?.expires ?? false;

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onUpload({ file, type, issueDate: issueDate || undefined, validUntil: validUntil || undefined });
      setFile(null);
      setIssueDate('');
      setValidUntil('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bdocs.actionError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="bdocs-upload" className="grid grid-cols-1 gap-3 rounded-card border border-line p-4 sm:grid-cols-2">
      <h2 id="bdocs-upload" className="font-heading text-lg text-ink sm:col-span-2">
        {t('bdocs.uploadTitle')}
      </h2>
      <label className="block">
        <span className={label}>{t('bdocs.typeLabel')}</span>
        <select className={`${input} mt-1`} value={type} onChange={(e) => setType(e.target.value as BusinessDocumentType)}>
          {types.map((x) => (
            <option key={x.type} value={x.type}>
              {typeName({ typeLabel: x.label })}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={label}>{t('bdocs.fileLabel')}</span>
        <input className={`${input} mt-1`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="mt-1 block text-xs text-muted">{t('bdocs.fileHint')}</span>
      </label>
      <label className="block">
        <span className={label}>{t('bdocs.issueDateLabel')}</span>
        <input className={`${input} mt-1`} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
      </label>
      {expires && (
        <label className="block">
          <span className={label}>{t('bdocs.validUntilLabel')}</span>
          <input className={`${input} mt-1`} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      )}
      <p className="text-xs text-muted sm:col-span-2">{t(readerOn ? 'bdocs.readerOn' : 'bdocs.readerOff')}</p>
      {error && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <button type="button" className={`${btnPrimary} w-fit`} disabled={!file || busy} onClick={() => void submit()}>
        {t('bdocs.upload')}
      </button>
    </section>
  );
}

function ReviewCard({
  doc,
  expires,
  onConfirm,
  onUseDetails,
}: {
  doc: BusinessDocument;
  expires: boolean;
  onConfirm: (v: { issueDate: string | null; validUntil: string | null }) => Promise<void>;
  onUseDetails: () => void;
}) {
  const t = useT();
  const [issueDate, setIssueDate] = useState(doc.issueDate ?? '');
  const [validUntil, setValidUntil] = useState(doc.validUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  const x = doc.extracted;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md bg-surface p-3" data-testid="bdoc-review">
      {x ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          <dt className="text-muted">{t('bdocs.readName')}</dt>
          <dd className="text-ink">{[x.nameEn, x.nameHe].filter(Boolean).join(' / ') || '-'}</dd>
          <dt className="text-muted">{t('bdocs.readTaxId')}</dt>
          <dd className="ltr-nums text-ink">{x.taxId ?? '-'}</dd>
        </dl>
      ) : (
        <p className="text-muted">{t('bdocs.notRead')}</p>
      )}
      {doc.check.taxIdValid === false && (
        <p role="alert" className="text-danger">
          {t('bdocs.taxIdInvalid')}
        </p>
      )}
      {doc.check.taxIdValid !== false && doc.check.taxIdMatches === false && (
        <p role="alert" className="text-danger">
          {t('bdocs.taxIdDiffers')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className={label}>{t('bdocs.issueDateLabel')}</span>
          <input className={`${input} mt-1`} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </label>
        {(expires || doc.validUntil) && (
          <label className="block">
            <span className={label}>{t('bdocs.validUntilLabel')}</span>
            <input className={`${input} mt-1`} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
        )}
      </div>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={async () => {
            try {
              await onConfirm({ issueDate: issueDate || null, validUntil: validUntil || null });
            } catch (err) {
              setError(err instanceof Error ? err.message : t('bdocs.actionError'));
            }
          }}
        >
          {t('bdocs.confirm')}
        </button>
        {x && (x.nameEn || x.nameHe || x.taxId) && (
          <button type="button" className={btnSecondary} onClick={onUseDetails}>
            {t('bdocs.useDetails')}
          </button>
        )}
      </div>
    </div>
  );
}

function SharePanel({
  days,
  onLink,
  onEmail,
  onDone,
}: {
  days: number[];
  onLink: (days: number, channel: 'link' | 'whatsapp') => Promise<string>;
  onEmail: (days: number, to: string) => Promise<void>;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [chosen, setChosen] = useState(7);
  const [to, setTo] = useState('');
  const [url, setUrl] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    try {
      await work();
      onDone();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('bdocs.actionError'), 'danger');
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md bg-surface p-3" data-testid="bdoc-share">
      <label className="block w-fit">
        <span className={label}>{t('bdocs.linkLasts')}</span>
        <select className={`${input} mt-1`} value={chosen} onChange={(e) => setChosen(Number(e.target.value))}>
          {days.map((d) => (
            <option key={d} value={d}>
              {t(d === 1 ? 'bdocs.oneDay' : 'bdocs.days', { days: String(d) })}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() =>
            void run(async () => {
              const link = await onLink(chosen, 'link');
              setUrl(link);
              try {
                await navigator.clipboard.writeText(link);
                toast.push(t('bdocs.copied'), 'success');
              } catch {
                // The URL shows below for a manual copy.
              }
            })
          }
        >
          {t('bdocs.copyLink')}
        </button>
        <button
          type="button"
          className={btnSecondary}
          onClick={() =>
            void run(async () => {
              const link = await onLink(chosen, 'whatsapp');
              setUrl(link);
              window.open(`https://wa.me/?text=${encodeURIComponent(link)}`, '_blank', 'noopener');
            })
          }
        >
          {t('bdocs.whatsapp')}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className={label}>{t('bdocs.emailTo')}</span>
          <input className={`${input} mt-1`} type="email" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className={btnSecondary}
          disabled={!to.includes('@')}
          onClick={() =>
            void run(async () => {
              await onEmail(chosen, to.trim());
              toast.push(t('bdocs.emailed', { to: to.trim() }), 'success');
              setTo('');
            })
          }
        >
          {t('bdocs.sendEmail')}
        </button>
      </div>
      {url && (
        <p className="break-all text-xs text-muted" data-testid="bdoc-link">
          {url}
        </p>
      )}
    </div>
  );
}
