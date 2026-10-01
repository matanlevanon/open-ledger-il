import { useCallback, useEffect, useRef, useState } from 'react';
import { useIssuing } from '../../app/issuing';
import { Link, useNavigate } from 'react-router-dom';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { CREATE_NEW_LABEL_KEYS } from '../../layout/nav';
import { usePendingApprovals } from '../documents/Recurring';
import { type DocType, docsApi } from '../documents/api';
import { money, newDocumentPath, offeredDocumentTypes } from '../documents/format';
import { Card, ErrorNote, PageTitle, StatusChip, errorText, useLoad } from '../documents/ui';
import { STATUS_LABEL_KEYS } from '../expenses/format';
import { type ActivityItem, activityApi, uploadReceipt } from './api';
import { receiptName, shrinkForUpload } from './image';
import { dropPending, isNetworkFailure, pendingReceipts, queueReceipt, toFile } from './queue';

/**
 * Phone home (/quick): add an expense from the camera or the gallery, issue a document, and see
 * what happened lately. The installed app opens here (web/public/manifest.webmanifest).
 */

type UploadState =
  | { phase: 'idle' }
  | { phase: 'working'; done: number; total: number }
  | { phase: 'done'; ids: number[]; duplicates: number; queued: number; failed: string[] };

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const bigBtn =
  'flex min-h-[6.5rem] flex-1 flex-col items-center justify-center gap-2 rounded-card border border-line px-3 py-4 text-base font-semibold shadow-card active:opacity-80 cursor-pointer';

export function QuickPage() {
  const pendingApprovals = usePendingApprovals();
  const t = useT();
  const issuing = useIssuing();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' });
  const [pending, setPending] = useState(0);
  const [types, setTypes] = useState<DocType[] | null>(null);
  const activity = useLoad(() => activityApi.recent(15), []);

  useEffect(() => {
    let live = true;
    docsApi
      .types()
      .then((r) => live && setTypes(r.types))
      .catch(() => live && setTypes([]));
    return () => {
      live = false;
    };
  }, []);

  const refreshPending = useCallback(async () => setPending((await pendingReceipts()).length), []);

  /** Sends every queued receipt. Stops at the first network failure, since the rest would fail too. */
  const flushQueue = useCallback(async () => {
    const rows = await pendingReceipts();
    if (rows.length === 0) return;
    let sent = 0;
    for (const row of rows) {
      try {
        await uploadReceipt(toFile(row));
        await dropPending(row.id);
        sent += 1;
      } catch (e) {
        if (isNetworkFailure(e)) break;
        await dropPending(row.id);
      }
    }
    await refreshPending();
    if (sent > 0) activity.reload();
  }, [activity, refreshPending]);

  useEffect(() => {
    void refreshPending().then(() => flushQueue());
    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFiles(list: FileList | null, input: HTMLInputElement | null) {
    const files = Array.from(list ?? []);
    if (input) input.value = '';
    if (files.length === 0) return;
    const ids: number[] = [];
    const failed: string[] = [];
    let duplicates = 0;
    let queued = 0;
    setUpload({ phase: 'working', done: 0, total: files.length });
    for (const [i, raw] of files.entries()) {
      const file = await shrinkForUpload(receiptName(raw));
      try {
        const id = await uploadReceipt(file);
        if (id === null) duplicates += 1;
        else ids.push(id);
      } catch (e) {
        if (isNetworkFailure(e) && (await queueReceipt(file))) queued += 1;
        else failed.push(`${raw.name || file.name}: ${errorText(e, t)}`);
      }
      setUpload({ phase: 'working', done: i + 1, total: files.length });
    }
    await refreshPending();
    // One receipt read and saved: open it for review straight away, the usual next step.
    if (files.length === 1 && ids.length === 1) {
      navigate(`/expenses/${ids[0]}`);
      return;
    }
    setUpload({ phase: 'done', ids, duplicates, queued, failed });
    if (ids.length > 0) activity.reload();
  }

  // A credit receipt starts from the receipt it credits, not from a blank form, so it is left out here.
  const issue = offeredDocumentTypes(types ?? []).filter((ty) => ty.code !== '405');

  return (
    <section aria-labelledby="page-title" className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageTitle>{t('quick.title')}</PageTitle>
      {pendingApprovals > 0 && (
        <Link to="/income/approvals" className="flex items-center justify-between rounded-card border border-brand bg-surface px-4 py-3 text-sm font-semibold text-ink">
          <span>{t('quick.pendingApprovals', { count: pendingApprovals })}</span>
          <span className="text-brand">{t('quick.review')}</span>
        </Link>
      )}

      <Card title={t('quick.expense.title')}>
        <div className="flex gap-3">
          <label className={`${bigBtn} bg-brand text-brand-ink`}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden {...stroke}>
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {t('quick.expense.camera')}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={upload.phase === 'working'}
              onChange={(e) => void onFiles(e.target.files, camera.current)}
            />
          </label>
          <label className={`${bigBtn} bg-canvas text-ink`}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden {...stroke}>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="10" r="2" />
              <path d="m21 16-5-5-9 9" />
            </svg>
            {t('quick.expense.gallery')}
            <input
              ref={gallery}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              disabled={upload.phase === 'working'}
              onChange={(e) => void onFiles(e.target.files, gallery.current)}
            />
          </label>
        </div>
        <UploadStatus state={upload} />
        {pending > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-sm">
            <span>{t('quick.expense.pending', { count: pending })}</span>
            <button type="button" className="font-semibold text-brand" onClick={() => void flushQueue()}>
              {t('quick.expense.retry')}
            </button>
          </div>
        )}
        <Link to="/expenses" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
          {t('quick.expense.all')}
        </Link>
      </Card>

      {issuing && issue.length > 0 && (
        <Card title={t('quick.issue.title')}>
          <div className="grid grid-cols-2 gap-2">
            {issue.map((ty) => (
              <Link
                key={ty.code}
                to={newDocumentPath(ty.code)}
                className="flex min-h-[3.25rem] items-center justify-center rounded-card border border-line bg-canvas px-3 py-2 text-center text-sm font-semibold text-ink active:opacity-80"
              >
                {CREATE_NEW_LABEL_KEYS[ty.code] ? t(CREATE_NEW_LABEL_KEYS[ty.code]!) : ty.name_en}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card title={t('quick.activity.title')}>
        <ErrorNote error={activity.error} />
        {!activity.data && !activity.error && <p className="text-sm text-muted">{t('documents.loading')}</p>}
        {activity.data && activity.data.items.length === 0 && <p className="text-sm text-muted">{t('quick.activity.empty')}</p>}
        {activity.data && activity.data.items.length > 0 && (
          <ul className="-mx-1 divide-y divide-line">
            {activity.data.items.map((item) => (
              <ActivityRow key={`${item.kind}-${item.id}`} item={item} types={types ?? []} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function UploadStatus({ state }: { state: UploadState }) {
  const t = useT();
  if (state.phase === 'idle') return null;
  if (state.phase === 'working') {
    return (
      <p role="status" className="mt-3 text-sm text-muted">
        {t('quick.expense.working', { done: state.done, total: state.total })}
      </p>
    );
  }
  return (
    <div role="status" className="mt-3 flex flex-col gap-1 text-sm">
      {state.ids.length > 0 && (
        <p>
          {t('quick.expense.saved', { count: state.ids.length })}{' '}
          <Link to={state.ids.length === 1 ? `/expenses/${state.ids[0]}` : '/expenses'} className="font-semibold text-brand hover:underline">
            {t('quick.expense.review')}
          </Link>
        </p>
      )}
      {state.duplicates > 0 && <p className="text-muted">{t('quick.expense.duplicates', { count: state.duplicates })}</p>}
      {state.queued > 0 && <p className="text-muted">{t('quick.expense.queued', { count: state.queued })}</p>}
      {state.failed.map((f) => (
        <p key={f} className="text-danger">
          {f}
        </p>
      ))}
    </div>
  );
}

function ActivityRow({ item, types }: { item: ActivityItem; types: DocType[] }) {
  const t = useT();
  const { locale } = usePreferences();
  const isDoc = item.kind === 'document';
  const ty = isDoc ? types.find((x) => x.code === item.type) : undefined;
  const typeName = ty ? (locale === 'he' ? ty.name_he : ty.name_en) : (item.type ?? '');
  const title = isDoc
    ? item.number !== null
      ? `${typeName} ${item.number}`
      : t('quick.activity.draft', { typeName })
    : (item.name ?? t('quick.activity.expense'));
  const who = isDoc ? ((locale === 'he' ? item.nameHe : null) ?? item.name) : t('quick.activity.expense');
  const when = new Date(item.at);
  const whenText = Number.isNaN(when.getTime())
    ? item.at.slice(0, 10)
    : when.toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' });
  return (
    <li>
      <Link to={isDoc ? `/income/documents/${item.id}` : `/expenses/${item.id}`} className="flex items-center gap-3 px-1 py-3 active:bg-surface">
        <span
          aria-hidden
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isDoc ? 'bg-tile-green text-ink' : 'bg-tile-lilac text-ink'}`}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
            {isDoc ? <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" /> : <path d="M3 6h18v13H3zM3 10h18M7 15h4" />}
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{title}</span>
          <span className="block truncate text-sm text-muted">
            {who ? `${who} · ` : ''}
            {whenText}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-semibold tabular-nums text-ink" dir="ltr">
            {money(item.amountMinor, item.currency)}
          </span>
          {isDoc ? (
            <StatusChip state={item.status} />
          ) : (
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink">
              {t(STATUS_LABEL_KEYS[item.status] ?? 'expenses.status.new')}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
