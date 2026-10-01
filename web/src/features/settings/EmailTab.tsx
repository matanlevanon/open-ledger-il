import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { sendingApi } from '../documents/api';
import { btnPrimary, input, label } from '../documents/ui';

/**
 * Settings > Email. Addresses copied on every document the Ledger emails, on top of each client's
 * own copy list. The send form shows both and lets you change them for one send.
 */
export function EmailTab() {
  const t = useT();
  const toast = useToast();
  const [cc, setCc] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sendingApi
      .settings()
      .then((s) => setCc(s.cc))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.email.loadError'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (cc === null) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await sendingApi.setCc(cc);
      setCc(saved.cc);
      toast.push(t('settings.email.saved'));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.email.saveError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('settings.email.title')}</h2>
        <p className="text-sm text-muted">{t('settings.email.hint')}</p>
      </div>
      <label className="block">
        <span className={label}>{t('settings.email.ccLabel')}</span>
        <input dir="ltr" className={input} value={cc} placeholder="you@example.com" onChange={(e) => setCc(e.target.value)} />
      </label>
      <div>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {t('settings.email.save')}
        </button>
      </div>
    </div>
  );
}
