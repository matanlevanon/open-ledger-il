import { useEffect, useId, useRef, useState } from 'react';

interface HelpTipProps {
  /** Accessible name of the "?" button. */
  label: string;
  /** The explanation shown on click. */
  text: string;
  /** A link under the text, for example to the help page on the site. Opens in a new tab. */
  href?: string;
  linkLabel?: string;
  /** Sit in the text flow, next to a heading, instead of on the parent's top corner. */
  inline?: boolean;
}

/**
 * A small "?" that sits on the top corner of its parent and opens a short explanation on click.
 * The parent needs `relative`. Escape or a click outside closes it.
 */
export function HelpTip({ label, text, href, linkLabel, inline = false }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={inline ? 'relative z-10 ms-2 inline-flex align-middle' : 'absolute -end-2 -top-2 z-10'}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-canvas text-[11px] font-semibold leading-none text-muted shadow-card hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-2"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute ${inline ? 'start-0' : 'end-0'} top-6 block w-64 rounded-md border border-line bg-canvas px-3 py-2 text-start text-xs font-normal leading-relaxed text-ink shadow-card`}
        >
          {text}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 block font-semibold text-brand underline">
              {linkLabel ?? href}
            </a>
          )}
        </span>
      )}
    </span>
  );
}
