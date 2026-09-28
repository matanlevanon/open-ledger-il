import { useEffect, useState } from 'react';
import { SelectField, TextField } from '../../components/fields';
import { useToast } from '../../components/Toast';
import { type PaymentMethod, paymentMethodsApi } from '../documents/api';
import { CURRENCIES } from '../documents/format';
import { type MessageKey, useT } from '../../i18n';
import { ApiError } from './api';

const TYPE_KEYS: Record<PaymentMethod['type'], MessageKey> = {
  bank_transfer: 'settings.paymentMethods.type.bank_transfer',
  bit: 'settings.paymentMethods.type.bit',
  paybox: 'settings.paymentMethods.type.paybox',
  paypal: 'settings.paymentMethods.type.paypal',
  card: 'settings.paymentMethods.type.card',
  cash: 'settings.paymentMethods.type.cash',
  cheque: 'settings.paymentMethods.type.cheque',
  other: 'settings.paymentMethods.type.other',
};
const TYPES = Object.keys(TYPE_KEYS) as PaymentMethod['type'][];

type BankCountry = 'IL' | 'US' | 'OTHER';
const BANK_COUNTRY_KEYS: Record<BankCountry, MessageKey> = {
  IL: 'settings.paymentMethods.bankCountry.IL',
  US: 'settings.paymentMethods.bankCountry.US',
  OTHER: 'settings.paymentMethods.bankCountry.OTHER',
};

interface FormState {
  id: number | null;
  displayName: string;
  type: PaymentMethod['type'];
  currency: string;
  bankCountry: BankCountry;
  routingNumber: string;
  accountType: 'checking' | 'savings';
  bankName: string;
  bankNumber: string;
  branch: string;
  accountNumber: string;
  accountHolder: string;
  iban: string;
  swiftBic: string;
  bankAddress: string;
  identifier: string;
}

const emptyForm = (): FormState => ({
  id: null,
  displayName: '',
  type: 'bank_transfer',
  currency: '',
  bankCountry: 'IL',
  routingNumber: '',
  accountType: 'checking',
  bankName: '',
  bankNumber: '',
  branch: '',
  accountNumber: '',
  accountHolder: '',
  iban: '',
  swiftBic: '',
  bankAddress: '',
  identifier: '',
});

function toForm(m: PaymentMethod): FormState {
  const d = m.details;
  return {
    id: m.id,
    displayName: m.display_name,
    type: m.type,
    currency: m.currency ?? '',
    bankCountry: d.bankCountry === 'US' || d.bankCountry === 'OTHER' ? d.bankCountry : 'IL',
    routingNumber: (d.routingNumber as string) ?? '',
    accountType: d.accountType === 'savings' ? 'savings' : 'checking',
    bankName: (d.bankName as string) ?? '',
    bankNumber: (d.bankNumber as string) ?? '',
    branch: (d.branch as string) ?? '',
    accountNumber: (d.accountNumber as string) ?? '',
    accountHolder: (d.accountHolder as string) ?? '',
    iban: (d.iban as string) ?? '',
    swiftBic: (d.swiftBic as string) ?? '',
    bankAddress: (d.bankAddress as string) ?? '',
    identifier: (d.identifier as string) ?? '',
  };
}

/** A 9-digit ABA routing number with a valid 3-7-1 check digit, the same rule the server applies. */
function isValidAbaRouting(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const d = value.split('').map(Number);
  return (3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!)) % 10 === 0;
}

function toBody(f: FormState) {
  const us = f.bankCountry === 'US';
  const il = f.bankCountry === 'IL';
  // Only the fields the chosen account format shows are sent, so a hidden leftover never prints.
  const details =
    f.type === 'bank_transfer'
      ? {
          bankCountry: f.bankCountry,
          bankName: f.bankName || null,
          bankNumber: il ? f.bankNumber || null : null,
          branch: il ? f.branch || null : null,
          accountNumber: f.accountNumber || null,
          accountHolder: f.accountHolder || null,
          routingNumber: us ? f.routingNumber.trim() || null : null,
          accountType: us ? f.accountType : null,
          iban: us ? null : f.iban || null,
          swiftBic: f.swiftBic || null,
          bankAddress: f.bankAddress || null,
        }
      : { identifier: f.identifier || null };
  return { displayName: f.displayName, type: f.type, currency: f.currency || null, details };
}

export function PaymentMethodsTab() {
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const t = useT();

  const load = () =>
    paymentMethodsApi
      .list()
      .then((body) => setMethods(body.paymentMethods))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.paymentMethods.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!methods) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const body = form.id === null ? await paymentMethodsApi.create(toBody(form)) : await paymentMethodsApi.update(form.id, toBody(form));
      setMethods(body.paymentMethods);
      setForm(null);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.paymentMethods.saveErrorFallback'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: PaymentMethod) => {
    const body = m.active === 1 ? await paymentMethodsApi.deactivate(m.id) : await paymentMethodsApi.activate(m.id);
    setMethods(body.paymentMethods);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const ids = methods.map((m) => m.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const body = await paymentMethodsApi.reorder(ids);
    setMethods(body.paymentMethods);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('settings.paymentMethods.intro')}</p>

      {methods.length === 0 && !form && <p className="text-sm text-muted">{t('settings.paymentMethods.empty')}</p>}

      <ul className="flex flex-col gap-2">
        {methods.map((m, i) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
            <div className="text-sm">
              <span className={m.active === 0 ? 'text-muted' : ''}>{m.display_name}</span>
              <span className="ms-2 text-xs text-muted">
                {t(TYPE_KEYS[m.type])}
                {m.currency ? ` · ${m.currency}` : ` · ${t('settings.paymentMethods.anyCurrency')}`}
              </span>
              {m.active === 0 && <span className="ms-2 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{t('settings.paymentMethods.inactiveLabel')}</span>}
            </div>
            <div className="flex shrink-0 gap-1 text-xs">
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => move(i, -1)} disabled={i === 0}>
                {t('settings.paymentMethods.moveUpButton')}
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-2 py-1 hover:bg-surface"
                onClick={() => move(i, 1)}
                disabled={i === methods.length - 1}
              >
                {t('settings.paymentMethods.moveDownButton')}
              </button>
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => setForm(toForm(m))}>
                {t('settings.paymentMethods.editButton')}
              </button>
              <button type="button" className="rounded-full border border-line px-2 py-1 hover:bg-surface" onClick={() => void toggleActive(m)}>
                {m.active === 1 ? t('settings.paymentMethods.deactivateButton') : t('settings.paymentMethods.activateButton')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {form ? (
        <div className="flex flex-col gap-3 rounded-md border border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('settings.paymentMethods.displayNameLabel')} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <SelectField
              label={t('settings.paymentMethods.typeLabel')}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as PaymentMethod['type'] })}
              options={TYPES.map((v) => ({ value: v, label: t(TYPE_KEYS[v]) }))}
            />
            <SelectField
              label={t('settings.paymentMethods.currencyLabel')}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              options={[{ value: '', label: t('settings.paymentMethods.anyCurrency') }, ...CURRENCIES.map((c) => ({ value: c, label: c }))]}
            />
          </div>
          {form.type === 'bank_transfer' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label={t('settings.paymentMethods.bankCountryLabel')}
                value={form.bankCountry}
                onChange={(e) => setForm({ ...form, bankCountry: e.target.value as BankCountry })}
                options={(Object.keys(BANK_COUNTRY_KEYS) as BankCountry[]).map((v) => ({ value: v, label: t(BANK_COUNTRY_KEYS[v]) }))}
              />
              <TextField label={t('settings.paymentMethods.bankNameLabel')} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              {form.bankCountry === 'IL' && (
                <>
                  <TextField label={t('settings.paymentMethods.bankNumberLabel')} value={form.bankNumber} onChange={(e) => setForm({ ...form, bankNumber: e.target.value })} />
                  <TextField label={t('settings.paymentMethods.branchLabel')} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </>
              )}
              {form.bankCountry === 'US' && (
                <TextField
                  label={t('settings.paymentMethods.routingNumberLabel')}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={9}
                  value={form.routingNumber}
                  error={form.routingNumber !== '' && !isValidAbaRouting(form.routingNumber) ? t('settings.paymentMethods.routingNumberInvalid') : undefined}
                  onChange={(e) => setForm({ ...form, routingNumber: e.target.value.replace(/\D/g, '') })}
                />
              )}
              <TextField
                label={t('settings.paymentMethods.accountNumberLabel')}
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
              />
              {form.bankCountry === 'US' && (
                <SelectField
                  label={t('settings.paymentMethods.accountTypeLabel')}
                  value={form.accountType}
                  onChange={(e) => setForm({ ...form, accountType: e.target.value as 'checking' | 'savings' })}
                  options={[
                    { value: 'checking', label: t('settings.paymentMethods.accountType.checking') },
                    { value: 'savings', label: t('settings.paymentMethods.accountType.savings') },
                  ]}
                />
              )}
              <TextField
                label={t('settings.paymentMethods.accountHolderLabel')}
                value={form.accountHolder}
                onChange={(e) => setForm({ ...form, accountHolder: e.target.value })}
              />
              {form.bankCountry !== 'US' && (
                <TextField label={t('settings.paymentMethods.ibanLabel')} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
              )}
              <TextField label={t('settings.paymentMethods.swiftBicLabel')} value={form.swiftBic} onChange={(e) => setForm({ ...form, swiftBic: e.target.value })} />
              <TextField
                label={t('settings.paymentMethods.bankAddressLabel')}
                value={form.bankAddress}
                onChange={(e) => setForm({ ...form, bankAddress: e.target.value })}
              />
            </div>
          ) : (
            <TextField label={t('settings.paymentMethods.identifierLabel')} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={
                saving ||
                !form.displayName.trim() ||
                (form.type === 'bank_transfer' && form.bankCountry === 'US' && (!isValidAbaRouting(form.routingNumber) || !form.accountNumber.trim()))
              }
              onClick={save}
              className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
            >
              {t('settings.paymentMethods.saveButton')}
            </button>
            <button type="button" className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface" onClick={() => setForm(null)}>
              {t('settings.paymentMethods.cancelButton')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="w-fit rounded-full border border-line px-4 py-2 text-sm hover:bg-surface"
          onClick={() => setForm(emptyForm())}
        >
          {t('settings.paymentMethods.addButton')}
        </button>
      )}
    </div>
  );
}
