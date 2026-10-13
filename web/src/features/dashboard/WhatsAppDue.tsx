import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { WhatsAppDueItem } from '../../api/dashboard';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { btnSecondary, errorText } from '../documents/ui';

/**
 * R28: "Reminders due on WhatsApp today". The 07:00 run could not email these, because the client
 * has a phone and no email, or email is off. Share on WhatsApp opens the prefilled message and
 * logs it, and the item leaves the list.
 */
export function WhatsAppDue({ items }: { items: WhatsAppDueItem[] }) {
  const t = useT();
  const [shared, setShared] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const open = items.filter((i) => !shared.includes(i.id));
  if (open.length === 0) return null;

  async function share(item: WhatsAppDueItem) {
    setError(null);
    // Opened before the request, so the browser does not block it as a pop-up.
    const tab = window.open('', '_blank');
    try {
      const res = await apiSend<{ waUrl: string }>('POST', `/dashboard/reminders/${item.id}/share`, {});
      if (tab) tab.location.href = res.waUrl;
      else window.open(res.waUrl, '_blank');
      setShared((s) => [...s, item.id]);
    } catch (e) {
      tab?.close();
      setError(errorText(e, t));
    }
  }

  return (
    <div data-testid="whatsapp-due" className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
      <p className="font-semibold">{t('dashboard.whatsappDue.title')}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {open.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Link to={item.targetKind === 'contract' ? `/contracts/${item.targetId}` : `/income/documents/${item.targetId}`} className="font-semibold text-accent-2 hover:underline">
                <bdi>{item.label || t(item.targetKind === 'contract' ? 'dashboard.whatsappDue.contract' : 'dashboard.whatsappDue.payment')}</bdi>
              </Link>{' '}
              · <bdi>{item.clientName}</bdi>
              {item.phone && <span className="ltr-nums text-muted"> · {item.phone}</span>}
            </span>
            <button type="button" className={btnSecondary} onClick={() => void share(item)}>
              {t('dashboard.whatsappDue.share')}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}
