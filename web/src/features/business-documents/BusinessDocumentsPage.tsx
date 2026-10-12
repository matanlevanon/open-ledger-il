import { useT } from '../../i18n';
import { BusinessDocumentsPanel } from './BusinessDocumentsPanel';

/** R24 Phase C: the same panel as Settings > Business documents, for the assistant and the accountant. */
export function BusinessDocumentsPage() {
  const t = useT();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('nav.businessDocuments')}
      </h1>
      <div className="mt-6">
        <BusinessDocumentsPanel />
      </div>
    </section>
  );
}
