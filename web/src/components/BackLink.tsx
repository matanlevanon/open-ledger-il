import { Link } from 'react-router-dom';
import { usePreferences } from '../app/preferences';
import { useT } from '../i18n';

const CLASS = 'mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink hover:underline';

/**
 * R28: the small Back link at the top of a page that sits below another page, above its title.
 * It goes to the parent page, never browser history. The arrow points to the start of the line,
 * so in Hebrew it points the other way. `onClick` serves an editor shown inside its parent page.
 */
export function BackLink({ to, onClick, label }: { to?: string; onClick?: () => void; label?: string }) {
  const t = useT();
  const { locale } = usePreferences();
  const arrow = locale === 'he' ? '→' : '←';
  const text = (
    <>
      <span aria-hidden="true">{arrow}</span>
      <span>{label ?? t('common.back')}</span>
    </>
  );
  return (
    <div className="text-start">
      {to ? (
        <Link to={to} className={CLASS} data-testid="back-link">
          {text}
        </Link>
      ) : (
        <button type="button" className={CLASS} data-testid="back-link" onClick={onClick}>
          {text}
        </button>
      )}
    </div>
  );
}

/** A document's parent: its client's Documents tab, or the income list when it has no client. */
export const documentParent = (clientId: number | null | undefined) => (clientId ? `/clients/${clientId}?tab=documents` : '/income');

/** A contract's parent: its client's Contracts tab. */
export const contractParent = (clientId: number) => `/clients/${clientId}?tab=contracts`;
