import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { FINANCY_URL } from '../../lib/partners';
import { FinancyCard } from './FinancyCard';

const show = () =>
  render(
    <PreferencesProvider persist={() => undefined}>
      <FinancyCard />
    </PreferencesProvider>,
  );

describe('FinancyCard', () => {
  afterEach(() => localStorage.clear());

  it('links to Financy as a sponsored link in a new tab, and says it is a partner link', () => {
    show();
    const link = screen.getByRole('link', { name: 'Open Financy' });
    expect(link).toHaveAttribute('href', FINANCY_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'sponsored noopener');
    expect(screen.getByTestId('financy-card')).toHaveTextContent('Partner link');
  });

  it('stays hidden after Don’t show again', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Don’t show again' }));
    expect(screen.queryByTestId('financy-card')).toBeNull();
    show();
    expect(screen.queryByTestId('financy-card')).toBeNull();
  });
});
