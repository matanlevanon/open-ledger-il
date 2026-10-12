import { useEffect, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { btnPrimary } from '../documents/ui';
import { type BusinessTypeStatus, type EntityType, fetchBusinessTypeStatus } from './api';
import { TypedConfirm, confirmMatches } from './BusinessTypeSwitchDialog';

const TYPES: EntityType[] = ['osek_patur', 'osek_murshe', 'company'];

interface Props {
  /** Injected in tests. */
  load?: () => Promise<BusinessTypeStatus>;
  /** The type the business fields below describe. Null until the step is settled. */
  onSettled: (type: EntityType | null) => void;
}

/**
 * R24 A6: the Business type step on the first-run setup screen, before the business fields.
 * Preselected from the installer's SETUP_BUSINESS_TYPE, else עוסק פטור. מורשה runs the
 * `registered` switch and a company runs start-company, each behind the typed confirmation.
 */
export function BusinessTypeStep({ load = fetchBusinessTypeStatus, onSettled }: Props) {
  const t = useT();
  const [status, setStatus] = useState<BusinessTypeStatus | null>(null);
  const [choice, setChoice] = useState<EntityType>('osek_patur');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    load()
      .then((s) => {
        setStatus(s);
        setChoice(s.entityType !== 'osek_patur' ? s.entityType : (s.setupBusinessType ?? 'osek_patur'));
      })
      .catch(() => setStatus(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), [load]);

  const done = status !== null && status.entityType !== 'osek_patur';
  useEffect(() => {
    if (!status) onSettled('osek_patur');
    else if (done) onSettled(status.entityType);
    else onSettled(choice === 'osek_patur' ? 'osek_patur' : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, choice, done]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (choice === 'company') await apiSend('POST', '/legal-mode/start-company', {});
      else await apiSend('POST', '/legal-mode/switch', { kind: 'registered' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.businessType.switchError'));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <section aria-labelledby="setup-type-title" className="rounded-card border border-line bg-canvas p-4 shadow-card">
      <h2 id="setup-type-title" className="font-heading text-lg text-ink">
        {t('settings.businessType.title')}
      </h2>
      {done ? (
        <p className="mt-2 text-sm text-ink">
          <span data-testid="setup-entity-type" className="rounded-full bg-surface px-3 py-0.5 font-semibold text-accent-2">
            {t(`businessType.${status.entityType}` as MessageKey)}
          </span>{' '}
          {t('settings.setup.typeDone')}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {TYPES.map((type) => (
            <label key={type} className={`flex gap-3 rounded-md border p-3 text-sm ${choice === type ? 'border-brand bg-surface' : 'border-line'}`}>
              <input type="radio" name="setup-business-type" checked={choice === type} onChange={() => setChoice(type)} />
              <span>
                <span className="block font-semibold text-ink">{t(`businessType.${type}` as MessageKey)}</span>
                <span className="block text-xs text-muted">{t(`settings.setup.type_${type}` as MessageKey)}</span>
              </span>
            </label>
          ))}
          {choice !== 'osek_patur' && (
            <div className="space-y-2 rounded-md bg-surface p-3 text-sm">
              <p className="text-ink">{t(choice === 'company' ? 'settings.setup.companyChanges' : 'settings.setup.mursheChanges')}</p>
              <TypedConfirm value={typed} onChange={setTyped} />
              <button type="button" className={btnPrimary} disabled={busy || !confirmMatches(typed)} onClick={() => void confirm()}>
                {t('settings.setup.confirmType')}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
