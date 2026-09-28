import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PeriodControl, previousRange, rangeFor, usePeriod } from './period';

const TODAY = '2026-09-28';

describe('rangeFor', () => {
  it('resolves every preset against today', () => {
    expect(rangeFor('thisMonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeFor('lastMonth', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(rangeFor('thisQuarter', TODAY)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(rangeFor('thisYear', TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(rangeFor('lastYear', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(rangeFor('last12', TODAY)).toEqual({ from: '2025-10-01', to: TODAY });
    expect(rangeFor('last24', TODAY)).toEqual({ from: '2024-10-01', to: TODAY });
  });

  it('crosses the year boundary for last month in January', () => {
    expect(rangeFor('lastMonth', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('gives the previous range of the same length', () => {
    expect(previousRange('2026-07-01', '2026-09-30')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(previousRange('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousRange('2026-03-10', '2026-03-19')).toEqual({ from: '2026-02-28', to: '2026-03-09' });
  });
});

function Harness({ storageKey }: { storageKey: string }) {
  const [period, setPeriod] = usePeriod(storageKey, 'thisYear', undefined, TODAY);
  return (
    <div>
      <PeriodControl value={period} onChange={setPeriod} today={TODAY} label="Card" />
      <output data-testid="range">{`${period.from}..${period.to}`}</output>
    </div>
  );
}

describe('PeriodControl and usePeriod', () => {
  beforeEach(() => localStorage.clear());

  it('starts on the default preset', () => {
    render(<Harness storageKey="a" />);
    expect(screen.getByTestId('range')).toHaveTextContent('2026-01-01..2026-12-31');
  });

  it('remembers the chosen preset per card', () => {
    const { unmount } = render(<Harness storageKey="a" />);
    fireEvent.change(screen.getByLabelText('Period: Card'), { target: { value: 'lastMonth' } });
    expect(screen.getByTestId('range')).toHaveTextContent('2026-08-01..2026-08-31');
    unmount();

    render(<Harness storageKey="a" />);
    expect(screen.getByTestId('range')).toHaveTextContent('2026-08-01..2026-08-31');
    expect(JSON.parse(localStorage.getItem('open-ledger-il-period:a')!)).toEqual({ preset: 'lastMonth' });
  });

  it('keeps another card on its own period', () => {
    localStorage.setItem('open-ledger-il-period:a', JSON.stringify({ preset: 'lastYear' }));
    render(<Harness storageKey="b" />);
    expect(screen.getByTestId('range')).toHaveTextContent('2026-01-01..2026-12-31');
  });

  it('shows date fields for a custom range and stores the dates', () => {
    render(<Harness storageKey="c" />);
    fireEvent.change(screen.getByLabelText('Period: Card'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-15' } });
    expect(screen.getByTestId('range')).toHaveTextContent('2026-03-01..2026-03-15');
    expect(JSON.parse(localStorage.getItem('open-ledger-il-period:c')!)).toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-15' });
  });

  it('ignores a stored value it cannot read', () => {
    localStorage.setItem('open-ledger-il-period:d', '{not json');
    render(<Harness storageKey="d" />);
    expect(screen.getByTestId('range')).toHaveTextContent('2026-01-01..2026-12-31');
  });
});
