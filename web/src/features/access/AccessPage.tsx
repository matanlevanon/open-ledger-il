import { useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { AccessLogTab } from './AccessLogTab';
import { UsersTab } from './UsersTab';

type Tab = 'users' | 'log';

const TABS: readonly [Tab, MessageKey][] = [
  ['users', 'access.tab.users'],
  ['log', 'access.tab.log'],
];

/**
 * runs/R09-accountant.md: the Users screen and the Access log screen, both owner only. One page
 * with two tabs rather than two nav routes, since both are gated the same way and this keeps
 * web/src/layout/nav.ts (R00) untouched. Each tab calls its API regardless of who is signed in;
 * an accountant sees "This area is for the account owner" from the 403 the backend already
 * enforces, rather than the page guessing at their role.
 */
export function AccessPage() {
  const [tab, setTab] = useState<Tab>('users');
  const t = useT();

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('access.title')}
      </h1>

      <div role="tablist" aria-label={t('access.tablistAriaLabel')} className="mt-6 flex gap-2 border-b border-line">
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
        {tab === 'users' ? <UsersTab /> : <AccessLogTab />}
      </div>
    </section>
  );
}
