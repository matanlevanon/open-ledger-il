import { useT } from '../../i18n';

/** About (R22): what the app is, its license, and the compliance notice. */
export function AboutPage() {
  const t = useT();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('about.title')}
      </h1>
      <p className="mt-4 text-sm text-ink">{t('about.what')}</p>
      <div role="note" className="mt-6 rounded-card border border-danger/40 bg-canvas p-4 text-sm text-ink shadow-card">
        <p className="font-semibold">{t('about.noticeTitle')}</p>
        <p className="mt-1">{t('about.notice')}</p>
      </div>
      <p className="mt-6 text-sm text-muted">{t('about.license')}</p>
    </section>
  );
}
