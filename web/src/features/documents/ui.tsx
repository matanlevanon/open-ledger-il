import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { STATE_LABEL_KEYS } from './format';

export const btn = 'inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50 md:min-h-0 md:px-4 md:py-2';
export const btnPrimary = `${btn} bg-brand text-brand-ink hover:opacity-90`;
export const btnSecondary = `${btn} border border-line bg-canvas text-ink hover:bg-surface`;
export const btnDanger = `${btn} border border-danger text-danger hover:bg-surface`;
export const input = 'w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-sm text-ink md:py-2';
export const label = 'block text-xs font-semibold uppercase tracking-wide text-muted';

const CHIP: Record<string, string> = {
  draft: 'bg-surface text-muted',
  open: 'bg-tile-blue text-ink',
  partial: 'bg-tile-peach text-ink',
  paid: 'bg-tile-green text-success',
  converted: 'bg-tile-lilac text-ink',
  final: 'bg-tile-green text-success',
  partially_credited: 'bg-tile-peach text-ink',
  credited: 'bg-tile-lilac text-ink',
  cancelled: 'bg-surface text-danger',
  overdue: 'bg-danger text-brand-ink',
};

export function StatusChip({ state, overdue = false }: { state: string; overdue?: boolean }) {
  const t = useT();
  const key = overdue ? 'overdue' : state;
  const stateKey = STATE_LABEL_KEYS[state];
  const text = overdue ? t('documents.state.overdue') : stateKey ? t(stateKey) : state;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[key] ?? 'bg-surface text-ink'}`}>{text}</span>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-canvas p-4 shadow-card md:p-6">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** `subtitle` sits directly under the title, e.g. a client's Hebrew name under the English one. */
export function PageTitle({ children, actions, subtitle }: { children: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 id="page-title" className="break-words font-heading text-2xl text-ink md:text-3xl">
          {children}
        </h1>
        {subtitle && <p className="mt-1 text-base text-muted md:text-lg">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="my-3 rounded-md border border-danger px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

export function Loading() {
  const t = useT();
  return <p className="text-sm text-muted">{t('documents.loading')}</p>;
}

/** Loads data on mount and whenever `deps` change. `reload` fetches again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const t = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : t('documents.error.generic')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

/** Turns a caught error into display text. `t` comes from the caller's own `useT()` (this is a
 * plain function, not a hook, so it cannot call `useT()` itself). */
export function errorText(e: unknown, t: ReturnType<typeof useT>): string {
  return e instanceof Error ? e.message : t('documents.error.generic');
}
