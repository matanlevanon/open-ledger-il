import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { Card, ErrorNote, Loading, useLoad } from './ui';

/** R28: one row of reminder_log, as the client page shows it. */
export interface ReminderLogItem {
  id: number;
  targetKind: 'document' | 'contract';
  targetId: number;
  channel: 'email' | 'whatsapp_due';
  rule: string;
  result: 'sent' | 'failed' | 'due' | 'shared';
  label: string | null;
  at: string;
}

const RESULT: Record<ReminderLogItem['result'], MessageKey> = {
  sent: 'clients.reminders.sent',
  failed: 'clients.reminders.failed',
  due: 'clients.reminders.due',
  shared: 'clients.reminders.shared',
};

/** "unsigned_3" to "3 days unsigned", "before_3" to "3 days before due". */
export function ruleLabel(rule: string, t: ReturnType<typeof useT>): string {
  const [kind, n] = rule.split('_');
  const days = n ?? '';
  if (kind === 'unsigned') return t('clients.reminders.rule.unsigned', { days });
  if (kind === 'ends') return t('clients.reminders.rule.ends', { days });
  if (kind === 'before') return t('clients.reminders.rule.before', { days });
  if (kind === 'after') return t('clients.reminders.rule.after', { days });
  return rule;
}

/** R28: the client page Reminders list, every automatic reminder for this client. */
export function ClientReminders({ clientId }: { clientId: number }) {
  const t = useT();
  const { locale } = usePreferences();
  const { data, error } = useLoad(() => apiGet<{ reminders: ReminderLogItem[] }>(`/sending/clients/${clientId}/reminders`), [clientId]);
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  return (
    <Card title={t('clients.reminders.title')}>
      {data.reminders.length === 0 ? (
        <p className="text-sm text-muted">{t('clients.reminders.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" data-testid="client-reminders">
          {data.reminders.map((r) => (
            <li key={r.id}>
              <span className="ltr-nums text-muted">{new Date(r.at).toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' })}</span> ·{' '}
              <Link to={r.targetKind === 'contract' ? `/contracts/${r.targetId}` : `/income/documents/${r.targetId}`} className="text-accent-2 hover:underline">
                <bdi>{r.label ?? `#${r.targetId}`}</bdi>
              </Link>{' '}
              · {ruleLabel(r.rule, t)} · {t(RESULT[r.result])}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
