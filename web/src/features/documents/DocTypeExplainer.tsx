import { type MessageKey, useT } from '../../i18n';

/**
 * A short "what this document is and what happens next" note per document type, shown in the
 * editor while creating the document and on the document page once it is issued. Types without
 * an entry show nothing.
 */
const EXPLAINED = new Set(['QT', 'PR', '300', 'PF', '400', '405', '305', '320', '330']);

export function DocTypeExplainer({ type, issued }: { type: string; issued: boolean }) {
  const t = useT();
  if (!EXPLAINED.has(type)) return null;
  const code = type === 'PF' ? '300' : type;
  return (
    <aside
      data-testid="doc-type-explainer"
      className="mb-6 rounded-card border border-line bg-surface px-4 py-3 text-sm"
      aria-label={t('documents.explainer.label')}
    >
      <p className="text-ink">{t(`documents.explainer.${code}.what` as MessageKey)}</p>
      <p className="mt-1 text-muted">
        {t((issued ? `documents.explainer.${code}.afterIssue` : `documents.explainer.${code}.beforeIssue`) as MessageKey)}
      </p>
    </aside>
  );
}
