import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { ApiError, type ApiErrorBody, apiGet } from '../api/client';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';

/**
 * R26, R29: the public demo, as the web app sees it. Null on every real Ledger. The banner shows
 * on every page. The sample data is read-only: its buttons hide and one line says why. A visitor's
 * own drafts stay editable, and Issue, Send, Record payment and Sign open previews.
 */
export interface DemoInfo {
  admin: boolean;
  ctaUrl: string;
  product: string;
  /** R29: the session key on the visitor's own rows. Null for the admin. */
  ownKey?: string | null;
}

const DemoContext = createContext<DemoInfo | null>(null);

export function DemoProvider({ value, children }: { value: DemoInfo | null; children: ReactNode }) {
  // R29: in the demo the browser tab carries the demo product name. It goes back on leave.
  const product = value?.product || null;
  useEffect(() => {
    if (!product || typeof document === 'undefined') return;
    const before = document.title;
    document.title = product;
    return () => {
      document.title = before;
    };
  }, [product]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoInfo | null {
  return useContext(DemoContext);
}

/** R29: the app name in the sidebar. The demo shows its own product name in both languages. */
export function useAppName(): string {
  const t = useT();
  const demo = useDemo();
  return demo?.product || t('app.name');
}

/** True when this screen is read-only: the demo, for a visitor. The admin's sample set is not. */
export function useDemoLocked(): boolean {
  const demo = useDemo();
  return demo !== null && !demo.admin;
}

/**
 * R29: true when this row is sample data the visitor may not change. A row the visitor created
 * carries its session key. Without the key on the row, `draft` decides: a visitor's documents and
 * contracts are always drafts, and the sample set has none.
 */
export function useDemoReadOnly(row: { demo_session_id?: string | null; status?: string } | null | undefined): boolean {
  const demo = useDemo();
  if (!demo || demo.admin || !row) return false;
  if (row.demo_session_id !== undefined) return !row.demo_session_id || row.demo_session_id !== demo.ownKey;
  return row.status !== 'draft';
}

/** The one line that says why a sample row has no edit buttons. */
export function DemoReadOnlyNote({ text }: { text?: string }) {
  const t = useT();
  return (
    <p role="note" data-testid="demo-read-only" className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
      {text ?? t('demo.readOnly')}
    </p>
  );
}

/**
 * Opens a preview PDF from /api/demo-app in a new tab. The tab opens first, so a popup blocker
 * lets it through, then gets the file.
 */
export async function openDemoPdf(path: string, body: unknown = {}): Promise<void> {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const res = await fetch(`/api/demo-app${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(res.status, err?.error.code ?? 'http_error', err?.error.message ?? 'Request failed.');
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Builds the email a send would deliver, files it in the visitor's outbox, and shows it. */
export async function previewDemoSend(documentId: number): Promise<void> {
  const res = await fetch(`/api/demo-app/documents/${documentId}/send-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, err?.error.code ?? 'http_error', err?.error.message ?? 'Request failed.');
  }
  announceDemoSend();
}

/** The real signing page, in preview mode, for a visitor's own contract draft. */
export function openDemoSigningPage(contractId: number, lang: 'en' | 'he'): void {
  window.open(`/api/demo-app/sign-preview/c/${contractId}?lang=${lang}`, '_blank', 'noopener');
}

export const DEMO_SENT_EVENT = 'ledger:demo-sent';

/** Call after any send. In the demo it opens the email preview. Elsewhere it does nothing. */
export function announceDemoSend(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_SENT_EVENT));
}

export function DemoBanner() {
  const t = useT();
  const demo = useDemo();
  if (!demo) return null;
  return (
    <div role="note" data-testid="demo-banner" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-ink md:px-8">
      <span>{demo.admin ? t('demo.bannerAdmin') : t('demo.banner')}</span>
      <a href={demo.ctaUrl} className="font-semibold text-accent-2 hover:underline">
        {t('demo.cta')}
      </a>
    </div>
  );
}

interface OutboxEmail {
  to_addr: string;
  subject: string;
  text: string;
}

/** The email a send would have delivered, shown instead of sending it. */
export function DemoOutboxPreview({ load = () => apiGet<{ emails: OutboxEmail[] }>('/demo-app/outbox') }: { load?: () => Promise<{ emails: OutboxEmail[] }> }) {
  const t = useT();
  const demo = useDemo();
  const [email, setEmail] = useState<OutboxEmail | null>(null);
  useEffect(() => {
    if (!demo) return;
    const show = () => {
      load()
        .then((r) => setEmail(r.emails[0] ?? null))
        .catch(() => setEmail(null));
    };
    window.addEventListener(DEMO_SENT_EVENT, show);
    return () => window.removeEventListener(DEMO_SENT_EVENT, show);
  }, [demo, load]);
  if (!demo || !email) return null;
  return (
    <Dialog open title={t('demo.preview.title')} onClose={() => setEmail(null)}>
      <p className="text-sm font-semibold text-ink">{t('demo.preview.note')}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">{t('demo.preview.to')}</dt>
        <dd className="ltr-nums">{email.to_addr}</dd>
        <dt className="text-muted">{t('demo.preview.subject')}</dt>
        <dd>
          <bdi>{email.subject}</bdi>
        </dd>
      </dl>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-3 text-xs" dir="auto">
        {email.text}
      </pre>
    </Dialog>
  );
}
