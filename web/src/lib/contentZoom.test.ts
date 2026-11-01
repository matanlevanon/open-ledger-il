import { afterEach, describe, expect, it } from 'vitest';
import { ZOOM_KEY, clampZoom, installContentZoom, pinchZoom } from './contentZoom';

describe('pinchZoom', () => {
  it('scales the start level by how far the fingers moved', () => {
    expect(pinchZoom(1, 100, 150)).toBe(1.5);
    expect(pinchZoom(1.5, 200, 100)).toBe(1);
  });

  it('stays between 100% and 180%', () => {
    expect(pinchZoom(1, 100, 400)).toBe(1.8);
    expect(pinchZoom(1.2, 100, 10)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('installContentZoom', () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    localStorage.clear();
    document.documentElement.style.removeProperty('--content-zoom');
  });

  it('applies the level this phone saved', () => {
    localStorage.setItem(ZOOM_KEY, '1.4');
    stop = installContentZoom();
    expect(document.documentElement.style.getPropertyValue('--content-zoom')).toBe('1.4');
  });

  it('ignores a saved level out of range', () => {
    localStorage.setItem(ZOOM_KEY, '5');
    stop = installContentZoom();
    expect(document.documentElement.style.getPropertyValue('--content-zoom')).toBe('1.8');
  });
});
