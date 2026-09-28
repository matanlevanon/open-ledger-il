import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyCell } from './MoneyCell';

describe('MoneyCell', () => {
  it('shows the document currency with grouping', () => {
    render(<MoneyCell amountMinor={123456} currency="USD" />);
    expect(screen.getByText('$1,234.56')).toBeInTheDocument();
  });

  it('shows a negative amount with a leading minus', () => {
    render(<MoneyCell amountMinor={-4000} currency="ILS" />);
    expect(screen.getByText('₪-40.00')).toBeInTheDocument();
  });

  it('adds the ILS figure under the line for a foreign amount', () => {
    render(<MoneyCell amountMinor={50000} currency="USD" ilsMinor={182000} />);
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('₪1,820.00')).toBeInTheDocument();
  });

  it('never adds a second ILS line for an ILS amount', () => {
    render(<MoneyCell amountMinor={50000} currency="ILS" ilsMinor={50000} />);
    expect(screen.getAllByText('₪500.00')).toHaveLength(1);
  });

  it('omits the second line when no ILS figure is given yet', () => {
    render(<MoneyCell amountMinor={50000} currency="USD" />);
    expect(screen.getByTestId('money-cell').children).toHaveLength(1);
  });
});
