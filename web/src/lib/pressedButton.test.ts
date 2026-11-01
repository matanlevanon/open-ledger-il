import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackPressedButtons } from './pressedButton';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('trackPressedButtons', () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('marks the clicked button while it is disabled, and clears it when enabled again', async () => {
    document.body.innerHTML = '<button id="send">Send</button><button id="cancel">Cancel</button>';
    stop = trackPressedButtons();
    const send = document.getElementById('send') as HTMLButtonElement;
    const cancel = document.getElementById('cancel') as HTMLButtonElement;
    send.click();
    send.disabled = true;
    cancel.disabled = true;
    await flush();
    expect(send.hasAttribute('data-pressed')).toBe(true);
    expect(cancel.hasAttribute('data-pressed')).toBe(false);
    send.disabled = false;
    await flush();
    expect(send.hasAttribute('data-pressed')).toBe(false);
  });

  it('drops the mark when the click disabled nothing', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="open">Open</button>';
    stop = trackPressedButtons();
    const open = document.getElementById('open') as HTMLButtonElement;
    open.click();
    expect(open.hasAttribute('data-pressed')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(open.hasAttribute('data-pressed')).toBe(false);
  });
});
