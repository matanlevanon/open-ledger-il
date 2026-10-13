import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';

/**
 * R26: the public demo, as the web app sees it. Null on every real Ledger. The banner shows on
 * every page, Settings stay visible and read-only, and a sent email opens as a preview.
 */
export interface DemoInfo {
  admin: boolean;
  ctaUrl: string;
  product: string;
}

const DemoContext = createContext<DemoInfo | null>(null);

export function DemoProvider({ value, children }: { value: DemoInfo | null; children: ReactNode }) {
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoInfo | null {
  return useContext(DemoContext);
}

/** True when this screen is read-only: the demo, for a visitor. The admin's sample set is not. */
export function useDemoLocked(): boolean {
  const demo = useDemo();
  return demo !== null && !demo.admin;
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
