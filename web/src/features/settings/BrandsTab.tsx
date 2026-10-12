import { useEffect, useState } from 'react';
import { type Brand, type BrandInput, createBrand, fetchBrands, updateBrand } from '../../api/businesses';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { btnPrimary, btnSecondary, input, label } from '../documents/ui';

interface Props {
  /** Injected in tests. */
  load?: () => Promise<{ brands: Brand[] }>;
  create?: (input: BrandInput) => Promise<{ brands: Brand[] }>;
  update?: (id: number, input: BrandInput) => Promise<{ brands: Brand[] }>;
}

type Form = Required<Omit<BrandInput, 'active'>>;
const EMPTY: Form = { nameEn: '', nameHe: '', taglineEn: '', taglineHe: '', email: '', phone: '', website: '', addressEn: '', addressHe: '' };

const toForm = (b: Brand): Form => ({
  nameEn: b.name_en,
  nameHe: b.name_he,
  taglineEn: b.tagline_en ?? '',
  taglineHe: b.tagline_he ?? '',
  email: b.email ?? '',
  phone: b.phone ?? '',
  website: b.website ?? '',
  addressEn: b.address_en ?? '',
  addressHe: b.address_he ?? '',
});

const FIELDS: [keyof Form, string, boolean][] = [
  ['nameEn', 'settings.business.nameEnLabel', false],
  ['nameHe', 'settings.business.nameHeLabel', true],
  ['taglineEn', 'settings.business.taglineEnLabel', false],
  ['taglineHe', 'settings.business.taglineHeLabel', true],
  ['email', 'settings.business.emailLabel', false],
  ['phone', 'settings.business.phoneLabel', false],
  ['website', 'settings.business.websiteLabel', false],
  ['addressEn', 'settings.business.addressEnLabel', false],
  ['addressHe', 'settings.business.addressHeLabel', true],
];

/**
 * R24 Phase B (R23 task 4): Settings > Brands for the current business. A brand is the name,
 * tagline and contact block a document prints. An empty field prints the business's own value.
 * The tax ID and legal name always come from the business. A brand is turned off, never deleted.
 */
export function BrandsTab({ load = fetchBrands, create = createBrand, update = updateBrand }: Props) {
  const t = useT();
  const toast = useToast();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load()
      .then((b) => setBrands(b.brands))
      .catch((err) => setError(err instanceof Error ? err.message : t('brands.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (error && !brands) return <p className="text-sm text-danger">{error}</p>;
  if (!brands) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const save = async () => {
    const body: BrandInput = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k.startsWith('name') ? (v ?? '').trim() : (v ?? '').trim() || null]));
    try {
      const res = editing === 'new' ? await create(body) : await update(editing as number, body);
      setBrands(res.brands);
      setEditing(null);
      toast.push(t('brands.saved'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('brands.saveError'), 'danger');
    }
  };

  const toggle = async (b: Brand) => {
    try {
      setBrands((await update(b.id, { active: b.active !== 1 })).brands);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('brands.saveError'), 'danger');
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted">{t('brands.intro')}</p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {brands.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="font-semibold text-ink">{b.name_en || b.name_he || t('brands.sameAsBusiness')}</span>
            {b.is_default === 1 && <span className="rounded-full bg-surface px-2 text-xs font-semibold text-accent-2">{t('brands.default')}</span>}
            {b.active !== 1 && <span className="text-xs text-muted">{t('brands.off')}</span>}
            <span className="ms-auto flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => { setEditing(b.id); setForm(toForm(b)); }}>
                {t('brands.edit')}
              </button>
              {b.is_default !== 1 && (
                <button type="button" className={btnSecondary} onClick={() => void toggle(b)}>
                  {b.active === 1 ? t('brands.turnOff') : t('brands.turnOn')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editing === null ? (
        <button type="button" className={`${btnPrimary} w-fit`} onClick={() => { setEditing('new'); setForm(EMPTY); }}>
          {t('brands.add')}
        </button>
      ) : (
        <section className="grid grid-cols-1 gap-3 rounded-card border border-line p-4 sm:grid-cols-2">
          {FIELDS.map(([key, labelKey, rtl]) => (
            <label key={key} className="block">
              <span className={label}>{t(labelKey as never)}</span>
              <input className={`${input} mt-1`} dir={rtl ? 'rtl' : undefined} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </label>
          ))}
          <p className="text-xs text-muted sm:col-span-2">{t('brands.emptyHint')}</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={btnPrimary} onClick={() => void save()}>
              {t('brands.save')}
            </button>
            <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
              {t('ceilingCrossing.cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
