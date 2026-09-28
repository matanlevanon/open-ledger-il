import { useEffect, useState } from 'react';
import { SelectField, TextField } from '../../components/fields';
import { useToast } from '../../components/Toast';
import { type MessageKey, useT } from '../../i18n';
import { type Service, servicesApi } from '../documents/api';
import { CURRENCIES, formatMinor, parseMinor } from '../documents/format';
import { PageTitle } from '../documents/ui';
import { ApiError } from './api';

const UNIT_KEYS: Record<Service['unit'], MessageKey> = {
  hour: 'settings.services.unit.hour',
  day: 'settings.services.unit.day',
  month: 'settings.services.unit.month',
  project: 'settings.services.unit.project',
  item: 'settings.services.unit.item',
};
const UNITS = Object.keys(UNIT_KEYS) as Service['unit'][];

const VAT_KEYS: Record<Service['vat_treatment'], MessageKey> = {
  standard: 'settings.services.vat.standard',
  exempt: 'settings.services.vat.exempt',
  zero_rated: 'settings.services.vat.zero_rated',
};
const VAT_TREATMENTS = Object.keys(VAT_KEYS) as Service['vat_treatment'][];

interface FormState {
  id: number | null;
  nameEn: string;
  nameHe: string;
  descriptionEn: string;
  descriptionHe: string;
  price: string;
  currency: string;
  quantity: string;
  unit: Service['unit'];
  vatTreatment: Service['vat_treatment'];
}

const emptyForm = (): FormState => ({
  id: null,
  nameEn: '',
  nameHe: '',
  descriptionEn: '',
  descriptionHe: '',
  price: '',
  currency: 'ILS',
  quantity: '1',
  unit: 'item',
  vatTreatment: 'standard',
});

function toForm(s: Service): FormState {
  return {
    id: s.id,
    nameEn: s.name_en,
    nameHe: s.name_he ?? '',
    descriptionEn: s.description_en ?? '',
    descriptionHe: s.description_he ?? '',
    price: formatMinor(s.unit_price_minor).replace(/,/g, ''),
    currency: s.currency,
    quantity: String(s.default_quantity_milli / 1000),
    unit: s.unit,
    vatTreatment: s.vat_treatment,
  };
}

function toBody(f: FormState) {
  return {
    nameEn: f.nameEn,
    nameHe: f.nameHe || null,
    descriptionEn: f.descriptionEn || null,
    descriptionHe: f.descriptionHe || null,
    unitPriceMinor: parseMinor(f.price) ?? 0,
    currency: f.currency,
    defaultQuantityMilli: Math.round((Number(f.quantity) || 1) * 1000),
    unit: f.unit,
    vatTreatment: f.vatTreatment,
  };
}

/** R17 task 5: create, edit, reorder and archive services. Embedded in Settings and, standalone, at /services. */
export function ServicesTab() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const t = useT();

  const load = () =>
    servicesApi
      .list()
      .then((body) => setServices(body.services))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.services.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!services) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body = form.id === null ? await servicesApi.create(toBody(form)) : await servicesApi.update(form.id, toBody(form));
      setServices(body.services);
      setForm(null);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.services.saveErrorFallback'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: Service) => {
    const body = s.active === 1 ? await servicesApi.archive(s.id) : await servicesApi.activate(s.id);
    setServices(body.services);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const ids = services.map((s) => s.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setServices((await servicesApi.reorder(ids)).services);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('settings.services.intro')}</p>

      {services.length === 0 && !form && <p className="text-sm text-muted">{t('settings.services.empty')}</p>}

      <ul className="flex flex-col gap-2">
        {services.map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
            <div className="text-sm">
              <span className={s.active === 0 ? 'text-muted' : ''}>{s.name_en}</span>
              <span className="ms-2 text-xs text-muted">
                {formatMinor(s.unit_price_minor)} {s.currency} / {t(UNIT_KEYS[s.unit])}
              </span>
              {s.active === 0 && <span className="ms-2 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{t('settings.services.archivedLabel')}</span>}
            </div>
            <div className="flex shrink-0 gap-1 text-xs">
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => move(i, -1)} disabled={i === 0}>
                {t('settings.services.moveUpButton')}
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-2 py-1 hover:bg-surface"
                onClick={() => move(i, 1)}
                disabled={i === services.length - 1}
              >
                {t('settings.services.moveDownButton')}
              </button>
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => setForm(toForm(s))}>
                {t('settings.services.editButton')}
              </button>
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => void toggleActive(s)}>
                {s.active === 1 ? t('settings.services.archiveButton') : t('settings.services.activateButton')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {form ? (
        <div className="flex flex-col gap-3 rounded-md border border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('settings.services.nameEnLabel')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            <TextField label={t('settings.services.nameHeLabel')} dir="rtl" value={form.nameHe} onChange={(e) => setForm({ ...form, nameHe: e.target.value })} />
            <TextField
              label={t('settings.services.descriptionEnLabel')}
              value={form.descriptionEn}
              onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })}
            />
            <TextField
              label={t('settings.services.descriptionHeLabel')}
              dir="rtl"
              value={form.descriptionHe}
              onChange={(e) => setForm({ ...form, descriptionHe: e.target.value })}
            />
            <TextField
              label={t('settings.services.priceLabel')}
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <SelectField
              label={t('settings.services.currencyLabel')}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
            <TextField
              label={t('settings.services.quantityLabel')}
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <SelectField
              label={t('settings.services.unitLabel')}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value as Service['unit'] })}
              options={UNITS.map((u) => ({ value: u, label: t(UNIT_KEYS[u]) }))}
            />
            <SelectField
              label={t('settings.services.vatTreatmentLabel')}
              value={form.vatTreatment}
              onChange={(e) => setForm({ ...form, vatTreatment: e.target.value as Service['vat_treatment'] })}
              options={VAT_TREATMENTS.map((v) => ({ value: v, label: t(VAT_KEYS[v]) }))}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !form.nameEn.trim()}
              onClick={save}
              className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
            >
              {t('settings.services.saveButton')}
            </button>
            <button type="button" className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface" onClick={() => setForm(null)}>
              {t('settings.services.cancelButton')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface" onClick={() => setForm(emptyForm())}>
          {t('settings.services.addButton')}
        </button>
      )}
    </div>
  );
}

/** Standalone /services page (sidebar entry), the same screen Settings embeds as a tab. */
export function ServicesPage() {
  const t = useT();
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <PageTitle>{t('settings.services.title')}</PageTitle>
      <ServicesTab />
    </section>
  );
}
