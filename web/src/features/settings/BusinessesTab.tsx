import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type BusinessList, type EntityType, type NewBusinessInput, createBusiness, fetchBusinesses } from '../../api/businesses';
import { setCurrentBusiness } from '../../app/business';
import { type MessageKey, useT } from '../../i18n';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';
import { TypedConfirm, confirmMatches } from './BusinessTypeSwitchDialog';

interface Props {
  /** Injected in tests. */
  load?: () => Promise<BusinessList>;
  create?: (input: NewBusinessInput) => Promise<{ businessId: number }>;
  /** Opens the Add business form at once (the switcher's Add a business). */
  startAdding?: boolean;
}

const EMPTY: NewBusinessInput = { entityType: 'company', nameEn: '', nameHe: '', taxId: '', addressEn: '', addressHe: '' };

/**
 * R24 B4: Settings > Businesses. Lists every business, and adds one through the same steps as the
 * first-run setup: type, names, tax ID and address, then Connect the Tax Authority for it. A
 * Ledger that already has an עוסק business offers a company only (B3), and says why.
 */
export function BusinessesTab({ load = fetchBusinesses, create = createBusiness, startAdding = false }: Props) {
  const t = useT();
  const [data, setData] = useState<BusinessList | null>(null);
  const [adding, setAdding] = useState(startAdding);
  const [form, setForm] = useState<NewBusinessInput>(EMPTY);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  useEffect(() => {
    load()
      .then((d) => {
        setData(d);
        if (d.addableTypes.length > 0 && !d.addableTypes.includes(form.entityType)) setForm((f) => ({ ...f, entityType: d.addableTypes[0]! }));
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('businesses.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (error && !data) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const isCompany = form.entityType === 'company';
  const needsConfirm = form.entityType !== 'osek_patur';
  const ready =
    form.nameEn.trim() && form.nameHe.trim() && /^\d{9}$/.test(form.taxId.trim()) && form.addressEn.trim() && (!needsConfirm || confirmMatches(typed));
  const set = (key: keyof NewBusinessInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { businessId } = await create({ ...form, taxId: form.taxId.trim(), addressHe: form.addressHe || null });
      setCreated(businessId);
      setAdding(false);
      setForm(EMPTY);
      setTyped('');
      setData(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('businesses.addError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section>
        <h2 className="font-heading text-lg text-ink">{t('businesses.title')}</h2>
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {data.businesses.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{b.nameEn || b.nameHe}</span>
              <span className="text-muted">{t(`businessType.${b.entityType}` as MessageKey)}</span>
              <span className="ltr-nums text-muted">{b.taxId ?? ''}</span>
              <span className="text-xs text-muted">{t(`businesses.role.${b.role}` as MessageKey)}</span>
              {b.id === data.current && <span className="rounded-full bg-surface px-2 text-xs font-semibold text-accent-2">{t('businesses.current')}</span>}
            </li>
          ))}
        </ul>
      </section>

      {created !== null && (
        <section className="rounded-md border border-line bg-surface p-3 text-sm" data-testid="business-created">
          <p className="text-ink">{t('businesses.created')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => { setCurrentBusiness(created); window.location.assign('/ita'); }}>
              {t('businesses.connectIta')}
            </button>
            <Link to="/" className={btnSecondary} onClick={() => setCurrentBusiness(created)}>
              {t('businesses.openIt')}
            </Link>
          </div>
        </section>
      )}

      {data.addableTypes.length > 0 &&
        (adding ? (
          <section aria-labelledby="add-business-title" className="flex flex-col gap-3 rounded-card border border-line p-4">
            <h2 id="add-business-title" className="font-heading text-lg text-ink">
              {t('businesses.addTitle')}
            </h2>
            {data.addableTypes.length === 1 && data.addableTypes[0] === 'company' && (
              <p className="text-xs text-muted" data-testid="one-osek-note">
                {t('businesses.companyOnly')}
              </p>
            )}
            <div className="space-y-2">
              {data.addableTypes.map((type: EntityType) => (
                <label key={type} className={`flex gap-3 rounded-md border p-3 text-sm ${form.entityType === type ? 'border-brand bg-surface' : 'border-line'}`}>
                  <input type="radio" name="new-business-type" checked={form.entityType === type} onChange={() => setForm({ ...form, entityType: type })} />
                  <span>
                    <span className="block font-semibold text-ink">{t(`businessType.${type}` as MessageKey)}</span>
                    <span className="block text-xs text-muted">{t(`settings.setup.type_${type}` as MessageKey)}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="block">
              <span className={label}>{t('settings.business.nameEnLabel')}</span>
              <input className={`${input} mt-1`} value={form.nameEn} onChange={set('nameEn')} />
            </label>
            <label className="block">
              <span className={label}>{t('settings.business.nameHeLabel')}</span>
              <input className={`${input} mt-1`} dir="rtl" value={form.nameHe} onChange={set('nameHe')} />
            </label>
            <label className="block">
              <span className={label}>{t(isCompany ? 'settings.business.companyNumberLabel' : 'settings.business.taxIdLabel')}</span>
              <input className={`${input} mt-1`} dir="ltr" inputMode="numeric" value={form.taxId} onChange={set('taxId')} />
              <span className="mt-1 block text-xs text-muted">{t(isCompany ? 'settings.business.companyNumberHint' : 'settings.business.taxIdHint')}</span>
            </label>
            <label className="block">
              <span className={label}>{t('settings.business.addressEnLabel')}</span>
              <input className={`${input} mt-1`} value={form.addressEn} onChange={set('addressEn')} />
            </label>
            <label className="block">
              <span className={label}>{t('settings.business.addressHeLabel')}</span>
              <input className={`${input} mt-1`} dir="rtl" value={form.addressHe ?? ''} onChange={set('addressHe')} />
            </label>
            {needsConfirm && (
              <>
                <p className="rounded-md bg-surface p-3 text-sm text-ink">
                  {t(isCompany ? 'settings.setup.companyChanges' : 'settings.setup.mursheChanges')}
                </p>
                <TypedConfirm value={typed} onChange={setTyped} />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void submit()}>
                {t('businesses.addButton')}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setAdding(false)}>
                {t('ceilingCrossing.cancel')}
              </button>
            </div>
          </section>
        ) : (
          <button type="button" className={`${btnPrimary} w-fit`} onClick={() => setAdding(true)}>
            {t('businesses.switcher.add')}
          </button>
        ))}
    </div>
  );
}
