/**
 * Pinch to zoom the page content on a phone, from 100% to 180%.
 *
 * The browser's own page zoom is off on phones (index.html viewport and `touch-action` in
 * src/styles/index.css), so a two-finger pinch reaches this code instead. It sets
 * `--content-zoom` on the root element, and the CSS applies it as `zoom` to the content area
 * only (`.content-zoom`, the app's <main>). CSS zoom changes layout size, so text wraps to the
 * screen width and nothing scrolls sideways. The top bar and the bottom menu sit outside it and
 * keep their size. Each phone stores its level in localStorage.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 1.8;
export const ZOOM_KEY = 'mtn-ledger-content-zoom';
const PHONE = '(max-width: 767px)';

/** The zoom after a pinch: the start level times how far the fingers moved apart, clamped and rounded. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_MIN;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v ? clampZoom(v) : ZOOM_MIN;
  } catch {
    return ZOOM_MIN;
  }
}

function saveZoom(z: number) {
  try {
    if (z === ZOOM_MIN) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    // Private mode: the level works now and is not remembered.
  }
}

function distance(t: TouchList): number {
  const a = t[0]!;
  const b = t[1]!;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function installContentZoom(win: Window = window): () => void {
  const doc = win.document;
  const root = doc.documentElement;
  const isPhone = () => (typeof win.matchMedia === 'function' ? win.matchMedia(PHONE).matches : false);
  let zoom = readZoom();
  let start: { zoom: number; distance: number } | null = null;
  let frame = 0;

  const apply = (z: number) => root.style.setProperty('--content-zoom', String(z));
  apply(zoom);

  function onStart(e: TouchEvent) {
    if (e.touches.length !== 2 || !isPhone()) return;
    start = { zoom, distance: distance(e.touches) };
    e.preventDefault();
  }

  function onMove(e: TouchEvent) {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    zoom = pinchZoom(start.zoom, start.distance, distance(e.touches));
    if (!frame) {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        apply(zoom);
      });
    }
  }

  function onEnd(e: TouchEvent) {
    if (!start || e.touches.length >= 2) return;
    start = null;
    apply(zoom);
    saveZoom(zoom);
  }

  // iOS Safari still pinch-zooms the page on its own gesture events, whatever the viewport says.
  const stopGesture = (e: Event) => {
    if (isPhone()) e.preventDefault();
  };

  const opts: AddEventListenerOptions = { passive: false };
  doc.addEventListener('touchstart', onStart, opts);
  doc.addEventListener('touchmove', onMove, opts);
  doc.addEventListener('touchend', onEnd);
  doc.addEventListener('touchcancel', onEnd);
  doc.addEventListener('gesturestart', stopGesture, opts);
  doc.addEventListener('gesturechange', stopGesture, opts);
  return () => {
    doc.removeEventListener('touchstart', onStart);
    doc.removeEventListener('touchmove', onMove);
    doc.removeEventListener('touchend', onEnd);
    doc.removeEventListener('touchcancel', onEnd);
    doc.removeEventListener('gesturestart', stopGesture);
    doc.removeEventListener('gesturechange', stopGesture);
    if (frame) win.cancelAnimationFrame(frame);
  };
}
