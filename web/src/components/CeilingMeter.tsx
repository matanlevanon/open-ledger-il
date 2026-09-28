import { useT } from '../i18n';
import { formatMoney } from '../lib/money';

/** Alert bands from docs/legal-requirements.md: Slack and dashboard alerts fire at 70, 85 and 95 percent. */
export type CeilingTone = 'ok' | 'notice' | 'warning' | 'danger';

export function ceilingTone(percent: number): CeilingTone {
  if (percent >= 95) return 'danger';
  if (percent >= 85) return 'warning';
  if (percent >= 70) return 'notice';
  return 'ok';
}

const TONE_BAR_CLASS: Record<CeilingTone, string> = {
  ok: 'bg-success',
  // Not bg-accent: that token now maps to the brand red (task 14), which would make this
  // mid-tier "notice" band visually identical to the "danger" band and lose the distinction.
  notice: 'bg-blue-2',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

interface CeilingMeterProps {
  year: number;
  currency: string;
  limitMinor: number;
  currentMinor: number;
}

/** The עוסק פטור ceiling meter: turnover to date plus open payment requests, against the year's ceiling. */
export function CeilingMeter({ year, currency, limitMinor, currentMinor }: CeilingMeterProps) {
  const t = useT();
  const percent = limitMinor > 0 ? Math.max(0, (currentMinor / limitMinor) * 100) : 0;
  const tone = ceilingTone(percent);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink ltr-nums">
          {t('ceilingMeter.amountOfLimit', { current: formatMoney(currentMinor, currency), limit: formatMoney(limitMinor, currency) })}
        </span>
        <span className="font-semibold text-ink ltr-nums" data-testid="ceiling-percent">
          {percent.toFixed(0)}%
        </span>
      </div>
      <div
        role="meter"
        aria-label={t('ceilingMeter.ariaLabel', { year })}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        data-tone={tone}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface"
      >
        <div className={`h-full rounded-full ${TONE_BAR_CLASS[tone]}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{t('ceilingMeter.caption', { year })}</p>
    </div>
  );
}
