import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { type ContractReminderSettings, type PaymentReminderSettings, sendingApi } from '../documents/api';
import { btnPrimary, input, label } from '../documents/ui';

/** "3, 10" to [3, 10]. Null when a part is not a whole number from 1 to 60. */
export function parseDays(text: string): number[] | null {
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const days = parts.map(Number);
  if (days.some((n) => !Number.isInteger(n) || n < 1 || n > 60)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * R28: Settings > Email > Reminders. Payment reminders (the R06 keys) and contract signing
 * reminders. Automatic reminders go by email. WhatsApp reminders show on the dashboard.
 */
export function RemindersSection({ payments, contracts }: { payments: PaymentReminderSettings; contracts: ContractReminderSettings }) {
  const t = useT();
  const toast = useToast();
  const [payOn, setPayOn] = useState(payments.enabled);
  const [before, setBefore] = useState(payments.beforeDays.join(', '));
  const [after, setAfter] = useState(payments.afterDays.join(', '));
  const [signOn, setSignOn] = useState(contracts.enabled);
  const [unsigned, setUnsigned] = useState(contracts.afterDays.join(', '));
  const [beforeEnd, setBeforeEnd] = useState(contracts.beforeEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [before, after, unsigned]);

  const save = async () => {
    const beforeDays = parseDays(before);
    const afterDays = parseDays(after);
    const unsignedDays = parseDays(unsigned);
    if (!beforeDays || !afterDays || !unsignedDays) return setError(t('settings.reminders.badDays'));
    setBusy(true);
    try {
      await sendingApi.setReminders({ enabled: payOn, beforeDays, afterDays });
      await sendingApi.setContractReminders({ enabled: signOn, afterDays: unsignedDays, beforeEnd });
      toast.push(t('settings.reminders.saved'));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.reminders.saveError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-6" data-testid="reminders-section">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('settings.reminders.title')}</h2>
        <p className="text-sm text-muted">{t('settings.reminders.hint')}</p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">{t('settings.reminders.payments')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={payOn} onChange={(e) => setPayOn(e.target.checked)} />
          {t('settings.reminders.paymentsOn')}
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={label}>{t('settings.reminders.beforeDue')}</span>
            <input dir="ltr" className={`${input} ltr-nums`} value={before} disabled={!payOn} onChange={(e) => setBefore(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>{t('settings.reminders.afterDue')}</span>
            <input dir="ltr" className={`${input} ltr-nums`} value={after} disabled={!payOn} onChange={(e) => setAfter(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">{t('settings.reminders.signing')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={signOn} onChange={(e) => setSignOn(e.target.checked)} />
          {t('settings.reminders.signingOn')}
        </label>
        <label className="block md:max-w-sm">
          <span className={label}>{t('settings.reminders.unsignedDays')}</span>
          <input dir="ltr" className={`${input} ltr-nums`} value={unsigned} disabled={!signOn} onChange={(e) => setUnsigned(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={beforeEnd} disabled={!signOn} onChange={(e) => setBeforeEnd(e.target.checked)} />
          {t('settings.reminders.beforeEnd')}
        </label>
      </fieldset>

      <p className="rounded-md bg-surface px-3 py-2 text-sm">{t('settings.reminders.channels')}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {t('settings.reminders.save')}
        </button>
      </div>
    </div>
  );
}
