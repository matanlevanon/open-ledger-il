/**
 * Marks the button a person pressed, so CSS can show that its action is running.
 *
 * Pages disable every action button while one request runs (`disabled={busy}`), so a disabled
 * button alone does not say which action is in progress. A click marks its button with
 * `data-pressed`. While that button stays disabled, src/styles/index.css draws a spinner on it.
 * The mark goes when the button is enabled again, or after a moment when the click disabled
 * nothing, so a button disabled later for another reason never shows the spinner.
 */
export function trackPressedButtons(doc: Document = document): () => void {
  let current: HTMLButtonElement | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    observer?.disconnect();
    observer = null;
    current?.removeAttribute('data-pressed');
    current = null;
  }

  function onClick(event: Event) {
    const target = event.target as Element | null;
    const button = target?.closest?.('button');
    if (!button || button.disabled) return;
    clear();
    current = button;
    button.setAttribute('data-pressed', '');
    let wasDisabled = false;
    observer = new MutationObserver(() => {
      if (!current) return;
      if (current.disabled) wasDisabled = true;
      else if (wasDisabled) clear();
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    // A click that disables nothing (opens a form, navigates) leaves no mark behind.
    timer = setTimeout(() => {
      timer = undefined;
      if (current && !current.disabled && !wasDisabled) clear();
    }, 400);
  }

  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    clear();
  };
}
