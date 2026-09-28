import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Money, ShareRow } from '../../api/dashboard';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';

/**
 * R21 chart pieces. Colors are the validated series tokens in web/src/styles/tokens.css,
 * assigned in fixed order. Every chart pairs with a table of its numbers (SUMIT shows the
 * figures under each chart), which is also the text alternative for the contrast and
 * color-vision cases.
 */

export const SERIES = [1, 2, 3, 4, 5].map((n) => `rgb(var(--color-series-${n}))`);
export const SERIES_SOFT = 'rgb(var(--color-series-1-soft))';
export const OTHER_COLOR = 'rgb(var(--color-muted))';
export const GRID = 'rgb(var(--color-line))';
export const AXIS = 'rgb(var(--color-muted))';
export const INK = 'rgb(var(--color-ink))';
export const SURFACE = 'rgb(var(--color-canvas))';

/** "₪12K" style tick, whole shekels, for axes and bar labels. Tables keep full precision. */
export function compactIls(minor: number): string {
  const major = Math.round(minor / 100);
  return `₪${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(major)}`;
}

export function useMonthLabel() {
  const { locale } = usePreferences();
  const fmt = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (month: string) => fmt.format(new Date(`${month}-01T00:00:00Z`));
}

export function useIsRtl(): boolean {
  return usePreferences().locale === 'he';
}

/** Original-currency amounts, "$1,200.00 + ₪300.00". Empty when the row is ILS only. */
export function originalAmounts(byCurrency: Money): string {
  const entries = Object.entries(byCurrency).filter(([, v]) => v !== 0);
  if (entries.length === 1 && entries[0]![0] === 'ILS') return '';
  return entries.map(([c, v]) => formatMoney(v, c)).join(' + ');
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  dataKey?: unknown;
}

/** Tooltip body for money series: label, then one row per series in ILS. */
export function MoneyTooltip({ active, label, payload, labelFormat }: { active?: boolean; label?: unknown; payload?: readonly TooltipEntry[]; labelFormat?: (l: string) => string }) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = typeof label === 'string' && labelFormat ? labelFormat(label) : String(label ?? '');
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink shadow-card">
      <p className="mb-1 font-semibold">{heading}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ltr-nums ms-auto font-semibold">{formatMoney(Number(p.value ?? 0), 'ILS')}</span>
        </p>
      ))}
    </div>
  );
}

export interface TableColumn<R> {
  key: string;
  header: string;
  render: (row: R) => ReactNode;
  numeric?: boolean;
}

/** The numbers under a chart. Compact, scrolls sideways on a narrow screen instead of the page. */
export function ChartTable<R>({ columns, rows, rowKey, footer, caption }: { columns: TableColumn<R>[]; rows: R[]; rowKey: (r: R) => string; footer?: ReactNode; caption: string }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`py-1 pe-2 font-semibold ${c.numeric ? 'text-end' : 'text-start'}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-line">
              {columns.map((c) => (
                <td key={c.key} className={`py-1 pe-2 text-ink ${c.numeric ? 'ltr-nums text-end' : ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t-2 border-line font-semibold text-ink">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="me-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: color }} />;
}

/**
 * Donut with its table: top rows in series order, Other in gray. The table names every slice,
 * so identity never rests on color alone.
 */
export function DonutWithTable({ rows, other, totalIlsMinor, caption, nameHeader, importedLabel }: { rows: ShareRow[]; other: ShareRow | null; totalIlsMinor: number; caption: string; nameHeader: string; importedLabel?: string }) {
  const t = useT();
  const { locale } = usePreferences();
  const name = (r: ShareRow) => (r.key === 'other' ? t('dash.other') : locale === 'he' ? r.nameHe : r.nameEn);
  const all = other ? [...rows, other] : rows;
  const color = (i: number, r: ShareRow) => (r.key === 'other' ? OTHER_COLOR : SERIES[i % SERIES.length]!);
  const share = (r: ShareRow) => (totalIlsMinor === 0 ? 0 : Math.round((r.ilsMinor / totalIlsMinor) * 100));
  const positive = all.filter((r) => r.ilsMinor > 0);

  return (
    <div>
      <div className="h-44" role="img" aria-label={caption}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={positive} dataKey="ilsMinor" nameKey="nameEn" innerRadius="58%" outerRadius="90%" stroke={SURFACE} strokeWidth={2} isAnimationActive={false}>
              {positive.map((r) => (
                <Cell key={r.key} fill={color(all.indexOf(r), r)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ShareRow | undefined;
                if (!active || !p) return null;
                const orig = originalAmounts(p.byCurrency);
                return (
                  <div className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink shadow-card">
                    <p className="font-semibold">{name(p)}</p>
                    <p className="ltr-nums">{formatMoney(p.ilsMinor, 'ILS')}</p>
                    {orig && <p className="ltr-nums text-muted">{orig}</p>}
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption={caption}
        rows={all}
        rowKey={(r) => r.key}
        columns={[
          {
            key: 'name',
            header: nameHeader,
            render: (r) => (
              <span>
                <Swatch color={color(all.indexOf(r), r)} />
                {name(r)}
                {r.imported && importedLabel && <span className="ms-2 rounded bg-surface px-1 text-[10px] uppercase text-muted">{importedLabel}</span>}
              </span>
            ),
          },
          {
            key: 'ils',
            header: t('dash.col.amountIls'),
            numeric: true,
            render: (r) => (
              <span title={originalAmounts(r.byCurrency) || undefined}>
                {formatMoney(r.ilsMinor, 'ILS')}
                {originalAmounts(r.byCurrency) && <span className="block text-[10px] text-muted">{originalAmounts(r.byCurrency)}</span>}
              </span>
            ),
          },
          { key: 'share', header: '%', numeric: true, render: (r) => `${share(r)}%` },
        ]}
        footer={
          <tr>
            <td className="py-1 pe-2">{t('dash.total')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(totalIlsMinor, 'ILS')}</td>
            <td />
          </tr>
        }
      />
    </div>
  );
}
