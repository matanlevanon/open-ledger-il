import { useState } from 'react';
import { useT } from '../../i18n';
import type { AccessFeatures } from './api';
import { DEFAULT_FEATURES, FEATURE_KEYS, FEATURE_LABEL_KEYS } from './features';

interface InviteFormProps {
  onInvite: (input: { email: string; name?: string; accessEndsOn: string; features: AccessFeatures }) => Promise<void>;
  onCancel: () => void;
}

function defaultEndDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function InviteForm({ onInvite, onCancel }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [accessEndsOn, setAccessEndsOn] = useState(defaultEndDate());
  const [features, setFeatures] = useState<AccessFeatures>(DEFAULT_FEATURES);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useT();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onInvite({ email, name: name.trim() || undefined, accessEndsOn, features });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('access.invite.errorFallback'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-surface p-4 shadow-card" aria-label={t('access.invite.ariaLabel')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-ink">
          {t('access.invite.emailLabel')}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-line bg-canvas px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {t('access.invite.nameLabel')}
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-line bg-canvas px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {t('access.invite.accessEndsOnLabel')}
          <input
            type="date"
            required
            dir="ltr"
            value={accessEndsOn}
            onChange={(e) => setAccessEndsOn(e.target.value)}
            className="rounded-md border border-line bg-canvas px-2 py-1 ltr-nums"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-ink">{t('access.invite.featuresLegend')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {FEATURE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={features[key]}
                onChange={(e) => setFeatures((f) => ({ ...f, [key]: e.target.checked }))}
              />
              {t(FEATURE_LABEL_KEYS[key])}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={saving} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
          {saving ? t('access.invite.inviting') : t('access.invite.sendInvite')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-line px-4 py-2 text-sm text-ink">
          {t('access.invite.cancel')}
        </button>
      </div>
    </form>
  );
}
