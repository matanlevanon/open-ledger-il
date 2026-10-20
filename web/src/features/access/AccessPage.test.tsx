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
                  business_documents: false,
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

describe('R39: a business always keeps one owner', () => {
  const owner = (id: number, email: string, extra: Record<string, unknown> = {}) => ({ id, email, name: null, role: 'owner', active: true, accessEndsOn: null, features: null, ...extra });
  const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

  afterEach(() => vi.restoreAllMocks());

  it('the only owner has no Remove and a locked role, with a line that says why', async () => {
    mockFetch({ 'GET /api/access/users': ok({ users: [owner(1, 'owner@example.com', { lastOwner: true })] }), 'GET /api/me': ok({ user: { email: 'owner@example.com' } }) });
    render(<AccessPage />);
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /owner@example.com/ })).toBeDisabled();
    expect(screen.getByText('The only owner. Add another owner to change this.')).toBeInTheDocument();
  });

  it('with two owners both can be removed, and removing yourself says you lose access', async () => {
    mockFetch({
      'GET /api/access/users': ok({ users: [owner(1, 'owner@example.com'), owner(2, 'partner@example.com')] }),
      'GET /api/me': ok({ user: { email: 'Owner@example.com' } }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AccessPage />);
    expect(await screen.findByText('partner@example.com')).toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Revoke' });
    expect(removes).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: /owner@example.com/ })).toBeEnabled();
    await waitFor(() => {
      fireEvent.click(removes[0]!);
      expect(confirm).toHaveBeenLastCalledWith('Remove yourself from this business? You lose access to it.');
    });
    fireEvent.click(removes[1]!);
    expect(confirm).toHaveBeenLastCalledWith('Remove partner@example.com from this business? Someone left with no business loses the account.');
  });

  it('a refused Remove shows the reason in its row and keeps the table', async () => {
    mockFetch({
      'GET /api/access/users': ok({ users: [owner(1, 'owner@example.com'), owner(2, 'partner@example.com', { active: false })] }),
      'GET /api/me': ok({ user: { email: 'owner@example.com' } }),
      'DELETE /api/access/users/1': () =>
        new Response(JSON.stringify({ error: { code: 'last_owner', message: 'A business must keep at least one owner. Add another owner first.' } }), { status: 409 }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AccessPage />);
    expect(await screen.findByText('partner@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('A business must keep at least one owner. Add another owner first.');
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('partner@example.com')).toBeInTheDocument();
  });

  it('a refused role change shows the reason in its row', async () => {
    mockFetch({
      'GET /api/access/users': ok({ users: [owner(1, 'owner@example.com'), owner(2, 'partner@example.com')] }),
      'PATCH /api/access/users/2': () => new Response(JSON.stringify({ error: { code: 'last_owner', message: 'A business must keep at least one owner. Add another owner first.' } }), { status: 409 }),
    });
    render(<AccessPage />);
    fireEvent.change(await screen.findByRole('combobox', { name: /partner@example.com/ }), { target: { value: 'assistant' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('A business must keep at least one owner.');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
