import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-surface text-muted',
  brand: 'bg-band text-brand',
  success: 'bg-tile-green text-success',
  warning: 'bg-tile-peach text-warning',
  danger: 'bg-tile-peach text-danger',
};

interface StatusChipProps {
  tone?: ChipTone;
  children: ReactNode;
}

/** A single pill used for document and request status. Tone is a color, not a status lookup. */
export function StatusChip({ tone = 'neutral', children }: StatusChipProps) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}
