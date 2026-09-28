import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CeilingCrossingDialog, type CeilingCrossingDetails } from './CeilingCrossingDialog';

const originalFetch = global.fetch;

function mockFetch(handlers: Record<string, () => Response>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const key = `${method} ${new URL(url, 'http://localhost').pathname}`;
    const handler = handlers[key] ?? handlers[url];
    if (!handler) throw new Error(`No mock for ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

const DETAILS: CeilingCrossingDetails = {
  year: 2026,
  currency: 'ILS',
  turnoverMinor: 10000000,
  amountMinor: 5000000,
  limitMinor: 12283300,
  gapMinor: 2283300,
};

function renderDialog(props: Partial<{ onClose: () => void; onRetry: () => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onRetry = props.onRetry ?? vi.fn();
  render(
    <MemoryRouter>
      <CeilingCrossingDialog details={DETAILS} onClose={onClose} onRetry={onRetry} />
    </MemoryRouter>,
  );
  return { onClose, onRetry };
}

describe('CeilingCrossingDialog: the three ceiling-crossing actions (docs/legal-requirements.md)', () => {
  it('shows turnover, this receipt, the ceiling and the remaining room', () => {
    renderDialog();
    expect(screen.getByText(/This receipt crosses the עוסק פטור ceiling/)).toBeInTheDocument();
    expect(screen.getByText(/₪100,000/)).toBeInTheDocument(); // turnover so far
    expect(screen.getByText(/₪50,000/)).toBeInTheDocument(); // this receipt
    expect(screen.getByText(/₪122,833/)).toBeInTheDocument(); // ceiling
    expect(screen.getByText(/₪22,833/)).toBeInTheDocument(); // room left
  });

  it('"Cancel" closes the dialog without calling the switch endpoint', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Issue as עוסק פטור" retries the finalize call, not the switch', () => {
    const { onRetry } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Issue as עוסק פטור' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('"Confirm switch" posts to /legal-mode/switch and then lists the open payment requests to reissue or cancel by hand', async () => {
    mockFetch({
      'POST /api/legal-mode/switch': () =>
        new Response(
          JSON.stringify({
            message: 'Switched to עוסק מורשה from 2026-11-20.',
            openPaymentRequests: [{ id: 42, displayNumber: 'PR-0007', clientNameEn: 'Acme Ltd', date: '2026-11-01', currency: 'ILS', totalMinor: 100000 }],
            repricedDrafts: [],
          }),
          { status: 200 },
        ),
    });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Confirm switch to עוסק מורשה/ }));

    expect(await screen.findByText(/Switched to עוסק מורשה from 2026-11-20/)).toBeInTheDocument();
    expect(screen.getByText('PR-0007')).toBeInTheDocument();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    // Confirming the switch never edits the open payment request itself (CLAUDE.md rule 1):
    // no button in this dialog calls anything but GET/POST /legal-mode/switch.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toMatch(/\/api\/legal-mode\/switch$/);
  });

  /** R19: a Hebrew-only open payment request (no clientNameEn) still shows a real name, not a blank one. */
  it('falls back to the Hebrew name for an open payment request with no English name', async () => {
    mockFetch({
      'POST /api/legal-mode/switch': () =>
        new Response(
          JSON.stringify({
            message: 'Switched to עוסק מורשה from 2026-11-20.',
            openPaymentRequests: [
              { id: 42, displayNumber: 'PR-0007', clientNameEn: null, clientNameHe: 'לקוח עברי', date: '2026-11-01', currency: 'ILS', totalMinor: 100000 },
            ],
            repricedDrafts: [],
          }),
          { status: 200 },
        ),
    });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Confirm switch to עוסק מורשה/ }));

    expect(await screen.findByText('לקוח עברי')).toBeInTheDocument();
  });

  it('shows the error message and lets the owner retry when the switch call fails', async () => {
    mockFetch({
      'POST /api/legal-mode/switch': () => new Response(JSON.stringify({ error: { code: 'already_murshe', message: 'Already switched.' } }), { status: 409 }),
    });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Confirm switch to עוסק מורשה/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Already switched\.|Could not record the switch request\./);
    // Still on the form, not the result screen: the owner can fix the date and try again.
    expect(screen.getByRole('button', { name: /Confirm switch to עוסק מורשה/ })).toBeInTheDocument();
  });
});
