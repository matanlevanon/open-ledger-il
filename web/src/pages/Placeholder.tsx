import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

interface PlaceholderProps {
  titleKey: MessageKey;
  run: string;
}

/** Stand-in screen until the owning run ships it. */
export function Placeholder({ titleKey, run }: PlaceholderProps) {
  const t = useT();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t(titleKey)}
      </h1>
      <div className="mt-6 rounded-card border border-dashed border-line bg-surface p-10 text-center shadow-card">
        <p className="text-lg text-ink">{t('placeholder.comingIn', { run })}</p>
        <p className="mt-2 text-sm text-muted">{t('placeholder.laterRun')}</p>
      </div>
    </section>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('placeholder.notFoundTitle')}
      </h1>
      <p className="mt-4 text-muted">{t('placeholder.notFoundDescription')}</p>
    </section>
  );
}
