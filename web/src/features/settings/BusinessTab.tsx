import { useEffect, useState } from 'react';
import { TextField, TextareaField } from '../../components/fields';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, type BusinessProfile, fetchBusiness, updateBusiness } from './api';
import { ImageUpload } from './ImageUpload';

type FormState = {
  nameEn: string;
  nameHe: string;
  taglineEn: string;
  taglineHe: string;
  addressEn: string;
  addressHe: string;
  taxId: string;
  email: string;
  phone: string;
  website: string;
  bankDetails: string;
  paymentLinkStripe: string;
  paymentLinkPaypal: string;
  paymentInstructions: string;
};

function toForm(b: BusinessProfile): FormState {
  return {
    nameEn: b.name_en,
    nameHe: b.name_he,
    taglineEn: b.tagline_en ?? '',
    taglineHe: b.tagline_he ?? '',
    addressEn: b.address_en ?? '',
    addressHe: b.address_he ?? '',
    taxId: b.tax_id ?? '',
    email: b.email ?? '',
    phone: b.phone ?? '',
    website: b.website ?? '',
    bankDetails: b.bank_details ?? '',
    paymentLinkStripe: b.payment_link_stripe ?? '',
    paymentLinkPaypal: b.payment_link_paypal ?? '',
    paymentInstructions: b.payment_instructions ?? '',
  };
}

interface BusinessTabProps {
  /** Runs after a successful save. The first-run setup screen uses it to re-check the profile. */
  onSaved?: () => void;
  /** Hides the logo and payment sections on the first-run setup screen. */
  setup?: boolean;
}

export function BusinessTab({ onSaved, setup = false }: BusinessTabProps = {}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    fetchBusiness()
      .then((body) => setForm(toForm(body.business)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.business.loadErrorFallback'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!form) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      const body = await updateBusiness(form);
      setForm(toForm(body.business));
      toast.push(t('settings.business.saveSuccess'));
      onSaved?.();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.business.saveErrorFallback'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label={t('settings.business.nameEnLabel')} required value={form.nameEn} onChange={set('nameEn')} />
        <TextField label={t('settings.business.nameHeLabel')} required dir="rtl" value={form.nameHe} onChange={set('nameHe')} />
        <TextField
          label={t('settings.business.taxIdLabel')}
          required
          inputMode="numeric"
          dir="ltr"
          value={form.taxId}
          onChange={set('taxId')}
          hint={t('settings.business.taxIdHint')}
        />
        <TextField label={t('settings.business.taglineEnLabel')} value={form.taglineEn} onChange={set('taglineEn')} />
        <TextField label={t('settings.business.taglineHeLabel')} dir="rtl" value={form.taglineHe} onChange={set('taglineHe')} />
        <TextareaField label={t('settings.business.addressEnLabel')} required value={form.addressEn} onChange={set('addressEn')} rows={2} />
        <TextareaField label={t('settings.business.addressHeLabel')} dir="rtl" value={form.addressHe} onChange={set('addressHe')} rows={2} />
        <TextField label={t('settings.business.emailLabel')} type="email" value={form.email} onChange={set('email')} />
        <TextField label={t('settings.business.phoneLabel')} value={form.phone} onChange={set('phone')} />
        <TextField label={t('settings.business.websiteLabel')} value={form.website} onChange={set('website')} />
        <TextField label={t('settings.business.paymentLinkStripeLabel')} value={form.paymentLinkStripe} onChange={set('paymentLinkStripe')} />
        <TextField label={t('settings.business.paymentLinkPaypalLabel')} value={form.paymentLinkPaypal} onChange={set('paymentLinkPaypal')} />
      </div>
      {!setup && (
        <>
      <TextareaField
        label={t('settings.business.bankDetailsLabel')}
        value={form.bankDetails}
        onChange={set('bankDetails')}
        rows={3}
        hint={t('settings.business.bankDetailsHint')}
      />
      <TextareaField
        label={t('settings.business.paymentInstructionsLabel')}
        value={form.paymentInstructions}
        onChange={set('paymentInstructions')}
        rows={3}
        hint={t('settings.business.paymentInstructionsHint')}
      />
        </>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
      >
        {saving ? t('settings.business.savingButton') : t('settings.business.saveButton')}
      </button>
      {!setup && <ImageUpload path="/business/logo" title={t('settings.business.logoTitle')} hint={t('settings.business.logoHint')} />}
    </div>
  );
}
