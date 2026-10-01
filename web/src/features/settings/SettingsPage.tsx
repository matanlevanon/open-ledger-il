import { useState } from 'react';
import type { MessageKey } from '../../i18n';
import { useT } from '../../i18n';
import { BackupsTab } from './BackupsTab';
import { BusinessTab } from './BusinessTab';
import { DashboardTab } from './DashboardTab';
import { ExpensesTab } from './ExpensesTab';
import { EmailTab } from './EmailTab';
import { IssuingTab } from './IssuingTab';
import { NumberingTab } from './NumberingTab';
import { PaymentMethodsTab } from './PaymentMethodsTab';
import { RatesTab } from './RatesTab';
import { ServicesTab } from './ServicesTab';
import { SignatureTab } from './SignatureTab';
import { TaxTab } from './TaxTab';

type Tab = 'business' | 'issuing' | 'email' | 'numbering' | 'tax' | 'rates' | 'paymentMethods' | 'services' | 'signature' | 'expenses' | 'dashboard' | 'backups';

const TABS: [Tab, MessageKey][] = [
  ['business', 'settings.tabs.business'],
  ['issuing', 'settings.tabs.issuing'],
  ['email', 'settings.tabs.email'],
  ['numbering', 'settings.tabs.numbering'],
  ['tax', 'settings.tabs.tax'],
  ['rates', 'settings.tabs.rates'],
  ['paymentMethods', 'settings.tabs.paymentMethods'],
  ['services', 'settings.tabs.services'],
  ['signature', 'settings.tabs.signature'],
  ['expenses', 'settings.tabs.expenses'],
  ['dashboard', 'settings.tabs.dashboard'],
  ['backups', 'settings.tabs.backups'],
];

/**
 * runs/R14-ops.md: business details in both languages, logo, bank details, payment links,
 * series starting numbers, ceilings table, VAT rates table, signature mode, plus the backup and
 * integrity check history. One page with tabs, owner only (the backend enforces it on every call).
 */
/** `?tab=dashboard` opens a tab directly, for links such as the dashboard's "Customize". */
function initialTab(): Tab {
  const wanted = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
  return TABS.some(([key]) => key === wanted) ? (wanted as Tab) : 'business';
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const t = useT();

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('settings.title')}
      </h1>

      <div role="tablist" aria-label={t('settings.title')} className="mt-6 flex flex-wrap gap-2 border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-semibold ${tab === key ? 'border-b-2 border-brand text-brand' : 'text-muted'}`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-card border border-line bg-canvas p-4 shadow-card">
        {tab === 'business' && <BusinessTab />}
        {tab === 'issuing' && <IssuingTab />}
        {tab === 'email' && <EmailTab />}
        {tab === 'numbering' && <NumberingTab />}
        {tab === 'tax' && <TaxTab />}
        {tab === 'rates' && <RatesTab />}
        {tab === 'paymentMethods' && <PaymentMethodsTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'signature' && <SignatureTab />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'backups' && <BackupsTab />}
      </div>
    </section>
  );
}
