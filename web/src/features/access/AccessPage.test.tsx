import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessPage } from './AccessPage';

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

describe('AccessPage', () => {
  it('shows the users table on the Users tab, owner view', async () => {
    mockFetch({
      'GET /api/access/users': () =>
        new Response(
          JSON.stringify({
            users: [
              { id: 1, email: 'owner@example.com', name: 'Sample Owner', role: 'owner', active: true, accessEndsOn: null, features: null },
              {
                id: 2,
                email: 'cpa@example.com',
                name: 'Dana',
                role: 'accountant',
                active: true,
                accessEndsOn: '2027-01-01',
                features: {
                  income_documents: true,
                  expenses: true,
                  clients: true,
                  reports: true,
                  monthly_pack: true,
                  unified_file: true,
                  pcn874: true,
                  bank_matches: false,
                  notes: true,
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });

    render(<AccessPage />);
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('cpa@example.com')).toBeInTheDocument();
    expect(screen.getByText('2027-01-01')).toBeInTheDocument();
  });

  it('shows the owner-only message on both tabs for an accountant', async () => {
    mockFetch({
      'GET /api/access/users': () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'nope' } }), { status: 403 }),
      'GET /api/access/log': () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'nope' } }), { status: 403 }),
    });

    render(<AccessPage />);
    expect(await screen.findByText('This area is for the account owner.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Access log' }));
    await waitFor(() => expect(screen.getByText('This area is for the account owner.')).toBeInTheDocument());
  });

  it('loads the access log entries on the Access log tab', async () => {
    mockFetch({
      'GET /api/access/users': () => new Response(JSON.stringify({ users: [] }), { status: 200 }),
      'GET /api/access/log': () =>
        new Response(
          JSON.stringify({
            entries: [
              { id: 1, at: '2026-10-01T08:00:00Z', userEmail: 'cpa@example.com', role: 'accountant', action: 'request', entity: 'route', entityId: '/api/expenses', details: null, ip: '1.2.3.4' },
            ],
            nextBefore: null,
          }),
          { status: 200 },
        ),
    });

    render(<AccessPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Access log' }));
    expect(await screen.findByText('cpa@example.com')).toBeInTheDocument();
    expect(screen.getByText('request')).toBeInTheDocument();
  });
});
