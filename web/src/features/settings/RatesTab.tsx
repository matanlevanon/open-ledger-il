import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, type FxRateRow, backfillRatesNow, fetchRecentRates } from './api';

/** PLAN.md's FX module: Bank of Israel representative rate, USD, EUR, GBP. */
const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

function jan1ThisYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export function RatesTab() {
  const [latest, setLatest] = useState<Record<string, FxRateRow | null> | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const toast = useToast();
  const t = useT();

  const load = () =>
    Promise.all(CURRENCIES.map((c) => fetchRecentRates(c).then((body) => [c, body.rates[0] ?? null] as const)))
      .then((entries) => setLatest(Object.fromEntries(entries)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.rates.loadErrorFallback'));
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!latest) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const fetchNow = async () => {
    setFetching(true);
    try {
      // Backfill each currency from its own latest cached date, or 1 January this year if
      // none is cached yet, through to today. The backfill route clamps "to" to today itself.
      for (const currency of CURRENCIES) {
        const from = latest[currency]?.rate_date ?? jan1ThisYear();
        await backfillRatesNow(currency, from);
      }
      toast.push(t('settings.rates.fetchSuccess'), 'success');
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.rates.fetchErrorFallback'), 'danger');
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg text-ink">{t('settings.rates.title')}</h2>
        <p className="text-xs text-muted">{t('settings.rates.hint')}</p>
        <button
          type="button"
          disabled={fetching}
          onClick={fetchNow}
          className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-60"
        >
          {fetching ? t('settings.rates.fetchingButton') : t('settings.rates.fetchNowButton')}
        </button>
        <table className="mt-2 w-full text-start text-sm">
          <caption className="sr-only">{t('settings.rates.caption')}</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted">
              <th className="py-2">{t('settings.rates.colCurrency')}</th>
              <th>{t('settings.rates.colLatestDate')}</th>
              <th>{t('settings.rates.colRate')}</th>
            </tr>
          </thead>
          <tbody>
            {CURRENCIES.map((c) => (
              <tr key={c} className="border-t border-line">
                <td className="py-2">{c}</td>
                <td className="ltr-nums">{latest[c]?.rate_date ?? t('settings.rates.noneYet')}</td>
                <td className="ltr-nums">{latest[c]?.rate ?? t('settings.rates.noneYet')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
