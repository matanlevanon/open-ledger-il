import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ItaApi, Overview } from './api';
import { ItaScreen } from './ItaScreen';

const doc = (id: number, number: number) => ({
  id,
  type: '305',
  number,
  status: 'allocation_pending',
  date: '2027-02-25',
  customer_name: 'Acme Ltd',
  payment_amount_minor: 600000,
  vat_amount_minor: 108000,
});

function overview(partial: Partial<Overview> = {}): Overview {
  return {
    connection: {
      environment: 'sandbox',
      connected: true,
      status: 'active',
      status_reason: null,
      login_at: '2027-01-01T00:00:00Z',
      days_until_relogin: 40,
      days_since_login: 50,
      last_refresh_at: null,
      banner: false,
    },
    queue: [],
    refused: [],
    without_numbers: [],
    links: { web_app: 'https://secapp.taxes.gov.il/em-hkz-hsb-intr', hearing: 'https://www.gov.il/x' },
    ...partial,
  };
}

function fakeApi(o: Overview): ItaApi {
  const ok = { status: 'decided', message: 'Done.', short_number: null, hearing_url: null };
  return {
    overview: vi.fn(async () => o),
    request: vi.fn(async () => ok),
    decide: vi.fn(async () => ok),
    manual: vi.fn(async () => ({ ...ok, status: 'approved', message: 'The allocation number from the ITA web app is saved.' })),
  };
}

function renderScreen(api: ItaApi, path = '/ita') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ItaScreen api={api} />
    </MemoryRouter>,
  );
}

describe('ITA screen', () => {
  it('shows the connection and days until re-login', async () => {
    renderScreen(fakeApi(overview()));
    expect(await screen.findByTestId('connection-status')).toHaveTextContent('Connected to sandbox. Login ends in 40 days.');
    expect(screen.getByRole('link', { name: 'Connect again' })).toHaveAttribute('href', '/api/ita/connect');
  });

  it('shows the re-login banner from day 80 and the reconnect alert', async () => {
    const o = overview();
    o.connection.banner = true;
    o.connection.days_until_relogin = 9;
    renderScreen(fakeApi(o));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your ITA login ends in 9 days. Connect again now.');
  });

  it('reports the callback result', async () => {
    renderScreen(fakeApi(overview()), '/ita?error=state');
    expect(await screen.findByRole('status')).toHaveTextContent('The ITA login link expired. Connect again.');
  });

  it('offers the four choices for a refused invoice and sends the one picked', async () => {
    const api = fakeApi(
      overview({
        refused: [{ document_id: 7, status: 'refused', attempts: 1, next_attempt_at: null, last_error_code: '460', last_error_message: null, decision: null, document: doc(7, 1001) }],
      }),
    );
    renderScreen(api);
    const row = await screen.findByTestId('refused-7');
    const labels = within(row).getAllByRole('button').map((b) => b.querySelector('span')?.textContent);
    expect(labels).toEqual(['Cancel invoice', 'Issue without number', 'Reverse charge', 'Request a hearing']);
    fireEvent.click(within(row).getByRole('button', { name: /Reverse charge/ }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith(7, 'reverse_charge'));
    expect(await screen.findByRole('status')).toHaveTextContent('Done.');
  });

  it('queue rows retry and take a number from the web app', async () => {
    const api = fakeApi(
      overview({
        queue: [{ document_id: 9, status: 'stalled', attempts: 96, next_attempt_at: null, last_error_code: 'http_500', last_error_message: null, decision: null, document: doc(9, 1002) }],
      }),
    );
    renderScreen(api);
    const row = await screen.findByTestId('queue-9');
    expect(row).toHaveTextContent('No answer for 24 hours.');
    fireEvent.click(within(row).getByRole('button', { name: 'Retry now' }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(9));

    const save = within(row).getByRole('button', { name: 'Save number' });
    expect(save).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('Allocation number'), { target: { value: '202703010000000000111222333' } });
    fireEvent.change(within(row).getByLabelText('Note'), { target: { value: 'Web app' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.manual).toHaveBeenCalledWith(9, '202703010000000000111222333', 'Web app'));
  });

  it('lists documents without numbers', async () => {
    renderScreen(
      fakeApi(
        overview({
          without_numbers: [{ id: 3, type: '320', number: 55, status: 'final', date: '2027-02-01', subtotal_minor: 700000, client_name: 'Beta', decision: 'continue' }],
        }),
      ),
    );
    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('320 #55');
    expect(table).toHaveTextContent('Issued without number');
    expect(table).toHaveTextContent('₪7,000.00');
  });
});
