import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import type { SigningStatus } from '../settings/DigitalSignatureCard';
import { NoSigningKeyBanner } from './NoSigningKeyBanner';

const base: SigningStatus = { businessId: 2, businessName: 'Client', taxId: null, edition: 'firm', mode: 'none', ledgerSubject: null, active: null, history: [] };

function wrap(load: () => Promise<SigningStatus>) {
  return render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>
        <NoSigningKeyBanner load={load} />
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R48 no signing key banner', () => {
  it('shows in the firm edition when the business has no key', async () => {
    wrap(async () => base);
    expect(await screen.findByTestId('no-signing-key')).toBeTruthy();
  });

  it('never shows in the single edition, or with a key', async () => {
    const loads = [async () => ({ ...base, edition: 'single' as const }), async () => ({ ...base, mode: 'own' as const })];
    for (const load of loads) {
      const { container, unmount } = wrap(load);
      await waitFor(() => expect(container.querySelector('[data-testid="no-signing-key"]')).toBeNull());
      unmount();
    }
  });
});
