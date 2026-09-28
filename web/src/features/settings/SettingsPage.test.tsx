import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import { SettingsPage } from './SettingsPage';

function renderPage() {
  return render(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>,
  );
}

const originalFetch = global.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

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

const business = {
  id: 1,
  name_en: 'Sample Business Ltd',
  name_he: 'אם.טי.אן שיווק',
  address_en: null,
  address_he: null,
  email: null,
  phone: null,
  website: null,
  bank_details: null,
  logo_r2_key: null,
  payment_link_stripe: null,
  payment_link_paypal: null,
};

describe('SettingsPage', () => {
  it('shows the business profile on the Business tab', async () => {
    mockFetch({ 'GET /api/ops/business': () => json({ business }) });
    renderPage();
    expect(await screen.findByDisplayValue('Sample Business Ltd')).toBeInTheDocument();
  });

  it('shows the owner-only message on a tab an accountant opens', async () => {
    mockFetch({
      'GET /api/ops/business': () => json({ error: { code: 'forbidden', message: 'nope' } }, 403),
      'GET /api/ops/backups': () => json({ error: { code: 'forbidden', message: 'nope' } }, 403),
    });
    renderPage();
    expect(await screen.findByText('This area is for the account owner.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Backups' }));
    await waitFor(() => expect(screen.getByText('This area is for the account owner.')).toBeInTheDocument());
  });

  it('shows the latest cached rate and fetches new rates on the Exchange rates tab', async () => {
    let backfillCalls: unknown[] = [];
    mockFetch({
      'GET /api/ops/business': () => json({ business }),
      'GET /api/fx/rates': () => json({ rates: [{ currency: 'USD', rate_date: '2026-10-05', rate: '3.712000', source: 'boi', fetched_at: '2026-10-05T06:00:00.000Z' }] }),
      'POST /api/fx/rates/backfill': () => {
        backfillCalls.push(true);
        return json({ currency: 'USD', from: '2026-10-05', to: '2026-10-06', cached: 1 });
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Exchange rates' }));
    expect(await screen.findAllByText('2026-10-05')).toHaveLength(3);
    expect(screen.getAllByText('3.712000')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Fetch rates now' }));
    await waitFor(() => expect(backfillCalls).toHaveLength(3));
  });

  it('lists backup history on the Backups tab', async () => {
    mockFetch({
      'GET /api/ops/business': () => json({ business }),
      'GET /api/ops/backups': () =>
        json({
          backups: [
            {
              id: 1,
              kind: 'quarterly',
              ran_at: '2026-10-01T03:00:00.000Z',
              d1_export_key: 'exports/2026-10-01/x-data.json',
              manifest_key: 'exports/2026-10-01/x-manifest.json',
              table_count: 19,
              document_count: 42,
              chain_head_hash: 'abc',
              restore_ok: 1,
              restore_error: null,
            },
          ],
        }),
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Backups' }));
    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows the Drive folder prefilled, the daily sync switch off, and the import runs on the Expenses tab', async () => {
    const puts: unknown[] = [];
    mockFetch({
      'GET /api/ops/business': () => json({ business }),
      'GET /api/expenses/settings/drive': () =>
        json({
          folderId: 'test-root-folder',
          folderIdSaved: true,
          indexTitlePattern: 'Expense index YYYY-MM',
          dailySync: false,
          runs: [
            {
              runId: 1,
              yearMonth: '2026-07',
              trigger: 'manual',
              source: 'sheet',
              startedAt: '2026-09-28T08:00:00.000Z',
              finishedAt: '2026-09-28T08:00:05.000Z',
              filesSeen: 14,
              created: 12,
              skippedDuplicate: 0,
              skippedNotExpense: 2,
              skippedIssuedBySelf: 0,
              errors: 0,
              statusCounts: {},
              createdIds: [],
              skips: [],
              errorList: [],
            },
          ],
        }),
      'PUT /api/expenses/settings/drive-daily-sync': () => {
        puts.push('sync');
        return json({ dailySync: true });
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }));
    expect(await screen.findByDisplayValue('test-root-folder')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Expense index YYYY-MM')).toBeInTheDocument();
    expect(screen.getByText(/2026-07 from the index sheet: 14 seen, 12 created/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Import from Drive every day' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(puts).toHaveLength(1);
  });
});
