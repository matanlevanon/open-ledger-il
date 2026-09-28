import { useState } from 'react';
import { type MessageKey, useT } from '../../i18n';

/**
 * R21 task 1: the period control shared by dashboard cards and reports. A preset resolves to a
 * from/to pair against today's Israel date. Each card or report remembers its own choice in
 * localStorage, per browser, under `open-ledger-il-period:<key>`.
 */

export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'last12' | 'last24' | 'custom';

export const PERIOD_PRESETS: PeriodPreset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear', 'last12', 'last24', 'custom'];

const PRESET_LABELS: Record<PeriodPreset, MessageKey> = {
  thisMonth: 'period.thisMonth',
  lastMonth: 'period.lastMonth',
  thisQuarter: 'period.thisQuarter',
  thisYear: 'period.thisYear',
  lastYear: 'period.lastYear',
  last12: 'period.last12',
  last24: 'period.last24',
  custom: 'period.custom',
};

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
}

/** Today in Israel as YYYY-MM-DD, the business date every report uses. */
export function todayIsrael(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day));

/** The from/to pair for a preset. `custom` has no range of its own and falls back to this year. */
export function rangeFor(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const month = m - 1;
  switch (preset) {
    case 'thisMonth':
      return { from: iso(utc(y, month, 1)), to: iso(utc(y, month + 1, 0)) };
    case 'lastMonth':
      return { from: iso(utc(y, month - 1, 1)), to: iso(utc(y, month, 0)) };
    case 'thisQuarter': {
      const q = Math.floor(month / 3) * 3;
      return { from: iso(utc(y, q, 1)), to: iso(utc(y, q + 3, 0)) };
    }
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'last12':
      return { from: iso(utc(y, month - 11, 1)), to: today };
    case 'last24':
      return { from: iso(utc(y, month - 23, 1)), to: today };
    case 'thisYear':
    case 'custom':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/**
 * The period right before `from`, for compare-to-previous. Whole calendar months step back by
 * the same number of months (a quarter compares to the quarter before). Anything else steps back
 * by the same number of days.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const lastDayOfTo = utc(ty, tm, 0).getUTCDate();
  if (fd === 1 && td === lastDayOfTo) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    return { from: iso(utc(fy, fm - 1 - months, 1)), to: iso(utc(fy, fm - 1, 0)) };
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const day = 86_400_000;
  const days = Math.round((end - start) / day);
  const prevTo = start - day;
  return { from: iso(new Date(prevTo - days * day)), to: iso(new Date(prevTo)) };
}

const STORAGE_PREFIX = 'open-ledger-il-period:';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readStored(key: string, allowed: PeriodPreset[], today: string): Period | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Period>;
    if (!parsed.preset || !allowed.includes(parsed.preset)) return null;
    if (parsed.preset === 'custom') {
      if (!parsed.from || !parsed.to || !DATE.test(parsed.from) || !DATE.test(parsed.to) || parsed.from > parsed.to) return null;
      return { preset: 'custom', from: parsed.from, to: parsed.to };
    }
    // A preset is stored, never its dates, so "This month" moves with the calendar.
    return { preset: parsed.preset, ...rangeFor(parsed.preset, today) };
  } catch {
    return null;
  }
}

function writeStored(key: string, period: Period) {
  try {
    const value = period.preset === 'custom' ? period : { preset: period.preset };
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
}

/** A remembered period for one card or report. */
export function usePeriod(
  key: string,
  defaultPreset: PeriodPreset,
  allowed: PeriodPreset[] = PERIOD_PRESETS,
  today: string = todayIsrael(),
): [Period, (p: Period) => void] {
  const [period, setPeriod] = useState<Period>(
    () => readStored(key, allowed, today) ?? { preset: defaultPreset, ...rangeFor(defaultPreset, today) },
  );
  const update = (p: Period) => {
    setPeriod(p);
    writeStored(key, p);
  };
  return [period, update];
}

interface PeriodControlProps {
  value: Period;
  onChange: (p: Period) => void;
  /** Presets to offer. Default: all of them. */
  options?: PeriodPreset[];
  today?: string;
  /** Accessible name, for example the card title. */
  label?: string;
}

export function PeriodControl({ value, onChange, options = PERIOD_PRESETS, today = todayIsrael(), label }: PeriodControlProps) {
  const t = useT();
  const field = 'rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={label ? `${t('period.label')}: ${label}` : t('period.label')}
        className={field}
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as PeriodPreset;
          onChange(preset === 'custom' ? { preset, from: value.from, to: value.to } : { preset, ...rangeFor(preset, today) });
        }}
      >
        {options.map((p) => (
          <option key={p} value={p}>
            {t(PRESET_LABELS[p])}
          </option>
        ))}
      </select>
      {value.preset === 'custom' && (
        <>
          <input
            type="date"
            aria-label={t('period.from')}
            className={`${field} ltr-nums`}
            value={value.from}
            max={value.to}
            onChange={(e) => DATE.test(e.target.value) && onChange({ ...value, from: e.target.value })}
          />
          <input
            type="date"
            aria-label={t('period.to')}
            className={`${field} ltr-nums`}
            value={value.to}
            min={value.from}
            onChange={(e) => DATE.test(e.target.value) && onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}
