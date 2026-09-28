import { useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { CsvImportSection } from './CsvImportSection';
import { UploadExistingDocumentsSection } from './UploadExistingDocumentsSection';
import { commitWaveCustomers, previewWaveCustomers } from './api';

/** Two sources only: a customer CSV from any system, and PDFs of documents issued before the ledger. */
const TABS: readonly { key: 'customers' | 'uploads'; label: MessageKey }[] = [
  { key: 'customers', label: 'import.tab.customers' },
  { key: 'uploads', label: 'import.tab.uploads' },
];

export function ImportPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('customers');
  const t = useT();

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('import.page.title')}
      </h1>
      <p className="mt-1 text-sm text-muted">{t('import.page.subtitle')}</p>

      <div className="mt-6 flex gap-1 border-b border-line" role="tablist" aria-label={t('import.page.tabsAriaLabel')}>
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            role="tab"
            aria-selected={tab === tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`rounded-t-md px-3 py-2 text-sm ${tab === tabItem.key ? 'border-b-2 border-brand font-semibold text-brand' : 'text-muted hover:text-ink'}`}
          >
            {t(tabItem.label)}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'customers' && (
          <CsvImportSection
            title={t('import.waveCustomers.title')}
            hint={t('import.waveCustomers.hint')}
            fields={[
              { key: 'nameEn', label: t('import.waveCustomers.field.nameEn'), required: true },
              { key: 'nameHe', label: t('import.waveCustomers.field.nameHe') },
              { key: 'companyId', label: t('import.waveCustomers.field.companyId') },
              { key: 'vatNumber', label: t('import.waveCustomers.field.vatNumber') },
              { key: 'country', label: t('import.waveCustomers.field.country') },
              { key: 'currency', label: t('import.waveCustomers.field.currency') },
              { key: 'email', label: t('import.waveCustomers.field.email') },
              { key: 'phone', label: t('import.waveCustomers.field.phone') },
              { key: 'addressEn', label: t('import.waveCustomers.field.addressEn') },
              { key: 'notes', label: t('import.waveCustomers.field.notes') },
            ]}
            preview={previewWaveCustomers}
            commit={commitWaveCustomers}
          />
        )}
        {tab === 'uploads' && <UploadExistingDocumentsSection />}
      </div>
    </section>
  );
}
