import { type ReactNode, useEffect, useRef } from 'react';
import { useT } from '../i18n';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** A centered modal dialog. Escape and an outside click close it; focus moves inside on open. */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button type="button" aria-label={t('dialog.closeDialog')} className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-card border border-line bg-canvas p-6 shadow-card focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="dialog-title" className="font-heading text-xl text-ink">
            {title}
          </h2>
          <button type="button" aria-label={t('dialog.close')} onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface">
            {t('dialog.close')}
          </button>
        </div>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
