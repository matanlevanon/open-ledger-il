import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { type MessageKey, useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { type BusinessTypeStatus, type VatReporting, fetchBusiness, fetchBusinessTypeStatus } from './api';
import { BusinessTypeSwitchDialog } from './BusinessTypeSwitchDialog';

interface Props {
  /** Injected in tests. */
  load?: () => Promise<BusinessTypeStatus>;
}

/**
 * R24 Screens A and D: the business type at the top of Settings > Tax. Only עוסק פטור gets the
 * switch. A מורשה or a company sees the status alone: the Ledger never goes back to פטור.
 */
export function BusinessTypeCard({ load = fetchBusinessTypeStatus }: Props) {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<BusinessTypeStatus | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const reload = () => {
    load()
      .then(setStatus)
      .catch(() => setStatus(null));
    fetchBusiness()
      .then((b) => setTaxId(b.business.tax_id))
      .catch(() => setTaxId(null));
  };
  useEffect(reload, [load]);

  if (!status) return null;
  const type = status.entityType;

  const setReporting = async (vatReporting: VatReporting) => {
    try {
      setStatus(await apiSend<BusinessTypeStatus>('PUT', '/legal-mode/vat-reporting', { vatReporting }));
      toast.push(t('settings.businessType.reportingSaved'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.businessType.switchError'), 'danger');
    }
  };

  return (
    <section aria-labelledby="business-type-title" className="rounded-card border border-line p-4">
      <h2 id="business-type-title" className="font-heading text-lg text-ink">
        {t('settings.businessType.title')}
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span data-testid="entity-type" className="rounded-full bg-surface px-3 py-0.5 text-sm font-semibold text-accent-2">
            {t(`businessType.${type}` as MessageKey)}
          </span>
          <p className="mt-1 text-xs text-muted ltr-nums">
            {type === 'osek_patur' && t('settings.businessType.paturLine')}
            {type === 'osek_murshe' && t('settings.businessType.mursheLine', { date: status.switchedOn ?? '' })}
            {type === 'company' && t('settings.businessType.companyLine', { taxId: taxId || '-' })}
          </p>
        </div>
        {type === 'osek_patur' && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            {t('settings.businessType.switchButton')}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t('settings.businessType.oneWay')}</p>
      {type !== 'osek_patur' && (
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-ink">
          {t('settings.businessType.reportingLabel')}
          <select
            value={status.vatReporting}
            onChange={(e) => void setReporting(e.target.value as VatReporting)}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-sm"
          >
            <option value="bimonthly">{t('settings.businessType.bimonthly')}</option>
            <option value="monthly">{t('settings.businessType.monthly')}</option>
          </select>
        </label>
      )}
      {open && <BusinessTypeSwitchDialog fresh={status.fresh} onClose={() => setOpen(false)} onSwitched={reload} />}
    </section>
  );
}
