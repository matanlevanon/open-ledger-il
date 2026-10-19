import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreferencesProvider } from '../app/preferences';
import { GuideTip, guideUrl } from './GuideTip';

describe('GuideTip', () => {
  it('links to the help page in the reader language, with the section anchor', () => {
    expect(guideUrl('mcp', 'en')).toBe('https://open-ledger.dev/en/help/connect-claude/');
    expect(guideUrl('upload', 'en')).toBe('https://open-ledger.dev/en/help/expenses/#upload');
    expect(guideUrl('upload', 'he')).toBe(`https://open-ledger.dev/help/expenses/#${encodeURIComponent('העלאה')}`);
  });

  it('opens a bubble with the text and the guide link on click, and closes on Escape', () => {
    render(
      <PreferencesProvider persist={() => undefined}>
        <GuideTip id="driveFolder" />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('One main folder with a folder per month');
    const link = screen.getByRole('link', { name: 'Read the guide' });
    expect(link).toHaveAttribute('href', 'https://open-ledger.dev/en/help/expenses/#connect-it-once');
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
