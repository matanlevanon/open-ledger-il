import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n';
import { BusinessTab } from './BusinessTab';

interface SetupScreenProps {
  missing: string[];
  /** Re-checks the profile after a save. The shell leaves this screen once nothing is missing. */
  onSaved: () => void;
}

/**
 * First-run setup (R22): shown to the owner instead of every screen but Settings and About while
 * the business profile misses a required field. The Worker refuses to create a document until
 * then too, so this screen is guidance, not the enforcement.
 */
export function SetupScreen({ missing, onSaved }: SetupScreenProps) {
  const t = useT();
  const fields = missing.map((f) => t(`settings.setup.field${f.charAt(0).toUpperCase()}${f.slice(1)}` as MessageKey)).join(', ');
  return (
    <section aria-labelledby="setup-title" className="mx-auto max-w-3xl">
      <h1 id="setup-title" className="font-heading text-3xl text-ink">
        {t('settings.setup.title')}
      </h1>
      <p className="mt-2 text-sm text-muted">{t('settings.setup.intro')}</p>
      {missing.length > 0 && <p className="mt-1 text-sm text-danger">{t('settings.setup.missing', { fields })}</p>}
      <div className="mt-6 rounded-card border border-line bg-canvas p-4 shadow-card">
        <BusinessTab setup onSaved={onSaved} />
      </div>
    </section>
  );
}
