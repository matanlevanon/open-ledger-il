import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CeilingMeter, ceilingTone } from './CeilingMeter';

describe('ceilingTone', () => {
  it('reads ok below 70 percent', () => {
    expect(ceilingTone(0)).toBe('ok');
    expect(ceilingTone(69.9)).toBe('ok');
  });

  it('reads notice from 70 up to 85 percent', () => {
    expect(ceilingTone(70)).toBe('notice');
    expect(ceilingTone(84.9)).toBe('notice');
  });

  it('reads warning from 85 up to 95 percent', () => {
    expect(ceilingTone(85)).toBe('warning');
    expect(ceilingTone(94.9)).toBe('warning');
  });

  it('reads danger at 95 percent and above, including over the ceiling', () => {
    expect(ceilingTone(95)).toBe('danger');
    expect(ceilingTone(100)).toBe('danger');
    expect(ceilingTone(140)).toBe('danger');
  });
});

describe('CeilingMeter', () => {
  it('shows the amount, the limit and the rounded percent', () => {
    render(<CeilingMeter year={2026} currency="ILS" limitMinor={12283300} currentMinor={8410000} />);
    expect(screen.getByText('₪84,100.00 of ₪122,833.00')).toBeInTheDocument();
    expect(screen.getByTestId('ceiling-percent')).toHaveTextContent('68%');
  });

  it('marks the meter with the danger tone once turnover reaches the ceiling', () => {
    render(<CeilingMeter year={2026} currency="ILS" limitMinor={100000} currentMinor={100000} />);
    expect(screen.getByRole('meter')).toHaveAttribute('data-tone', 'danger');
  });

  it('never draws the bar past full width when turnover exceeds the ceiling', () => {
    render(<CeilingMeter year={2026} currency="ILS" limitMinor={100000} currentMinor={200000} />);
    const meter = screen.getByRole('meter');
    const bar = meter.firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });
});
