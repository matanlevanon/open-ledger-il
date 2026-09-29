import { describe, expect, it } from 'vitest';
import { receiptName } from './image';

describe('receiptName', () => {
  const now = new Date(2026, 8, 29, 14, 5, 9);
  it('gives a camera capture a dated name', () => {
    expect(receiptName(new File(['x'], 'image.jpg', { type: 'image/jpeg' }), now).name).toBe('receipt-2026-09-29-140509.jpg');
  });
  it('keeps a real file name', () => {
    expect(receiptName(new File(['x'], 'Wolt-order.png', { type: 'image/png' }), now).name).toBe('Wolt-order.png');
  });
});
