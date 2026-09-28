import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { formatMinor } from '../../lib/money';
import { ApiError, type CeilingRow, type VatRateRow, addVatRate, fetchCeilings, fetchVatRates, upsertCeiling } from './api';

export function TaxTab() {
  const [ceilings, setCeilings] = useState<CeilingRow[] | null>(null);
  const [vatRates, setVatRates] = useState<VatRateRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState('');
  const [amount, setAmount] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const toast = useToast();
  const t = useT();

  const load = () =>
    Promise.all([fetchCeilings(), fetchVatRates()])
      .then(([c, v]) => {
        setCeilings(c.ceilings);
        setVatRates(v.vatRates);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.tax.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!ceilings || !vatRates) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const saveCeiling = async () => {
    const y = Number(year);
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isInteger(y) || !Number.isFinite(minor) || minor <= 0) {
      toast.push(t('settings.tax.invalidCeiling'), 'danger');
      return;
    }
    try {
      const body = await upsertCeiling({ year: y, amountMinor: minor, currency: 'ILS' });
      setCeilings(body.ceilings);
      setYear('');
      setAmount('');
      toast.push(t('settings.tax.ceilingSaved', { year: y }));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.tax.saveCeilingErrorFallback'), 'danger');
    }
  };

  const saveVatRate = async () => {
    const bp = Math.round(Number(ratePercent) * 100);
    if (!Number.isInteger(bp) || bp < 0 || bp > 10000 || !effectiveFrom) {
      toast.push(t('settings.tax.invalidVatRate'), 'danger');
      return;
    }
    try {
      const body = await addVatRate({ rateBp: bp, effectiveFrom });
      setVatRates(body.vatRates);
      setRatePercent('');
      setEffectiveFrom('');
      toast.push(t('settings.tax.vatRateAdded'));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.tax.addVatRateErrorFallback'), 'danger');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-heading text-lg text-ink">{t('settings.tax.ceilingsTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.tax.ceilingsHint')}</p>
        <table className="mt-3 w-full text-start text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-2">{t('settings.tax.colYear')}</th>
              <th>{t('settings.tax.colCeiling')}</th>
              <th>{t('settings.tax.colNote')}</th>
            </tr>
          </thead>
          <tbody>
            {ceilings.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="py-2 ltr-nums">{c.year}</td>
                <td className="ltr-nums">₪{formatMinor(c.amount_minor)}</td>
                <td>{c.note ?? t('settings.tax.noteNone')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="number"
            placeholder={t('settings.tax.yearPlaceholder')}
            dir="ltr"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-24 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
          />
          <input
            type="number"
            placeholder={t('settings.tax.amountPlaceholder')}
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
          />
          <button type="button" onClick={saveCeiling} className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-surface">
            {t('settings.tax.saveCeilingButton')}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg text-ink">{t('settings.tax.vatRatesTitle')}</h2>
        <p className="text-xs text-muted">{t('settings.tax.vatRatesHint')}</p>
        <table className="mt-3 w-full text-start text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-2">{t('settings.tax.colEffectiveFrom')}</th>
              <th>{t('settings.tax.colRate')}</th>
              <th>{t('settings.tax.colNote')}</th>
            </tr>
          </thead>
          <tbody>
            {vatRates.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="py-2 ltr-nums">{v.effective_from}</td>
                <td className="ltr-nums">{(v.rate_bp / 100).toFixed(2)}%</td>
                <td>{v.note ?? t('settings.tax.noteNone')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="number"
            placeholder={t('settings.tax.ratePlaceholder')}
            dir="ltr"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            className="w-24 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
          />
          <input type="date" dir="ltr" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="rounded-md border border-line bg-canvas px-2 py-1 text-sm" />
          <button type="button" onClick={saveVatRate} className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-surface">
            {t('settings.tax.addVatRateButton')}
          </button>
        </div>
      </section>
    </div>
  );
}
