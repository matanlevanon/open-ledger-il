import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import { EmailTab } from './EmailTab';
import { parseDays } from './RemindersSection';

/** R28 task 5: Settings > Email > Reminders, payment and contract signing reminders. */

const calls: { key: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      if (key === 'GET /api/sending/settings')
        return new Response(
          JSON.stringify({
            cc: '',
            reminders: { enabled: true, beforeDays: [3], afterDays: [3, 10] },
            contractReminders: { enabled: true, afterDays: [3, 7], beforeEnd: true },
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings > Email > Reminders', () => {
  it('shows payment and signing reminders with their days, and the WhatsApp line', async () => {
    render(
      <ToastProvider>
        <EmailTab />
      </ToastProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeInTheDocument();
    expect(screen.getByLabelText('Remind clients about open payment requests and pro formas')).toBeChecked();
    expect(screen.getByLabelText('Days before due')).toHaveValue('3');
    expect(screen.getByLabelText('Days after due')).toHaveValue('3, 10');
    expect(screen.getByLabelText('Remind signers about contracts they have not signed')).toBeChecked();
    expect(screen.getByLabelText('Days after sending without a signature')).toHaveValue('3, 7');
    expect(screen.getByLabelText('One reminder 2 days before the signing link ends')).toBeChecked();
    expect(screen.getByText('Automatic reminders go by email. WhatsApp reminders show on the dashboard.')).toBeInTheDocument();
  });

  it('saves both, with the existing payment keys and the signing settings', async () => {
    render(
      <ToastProvider>
        <EmailTab />
      </ToastProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Days after due'), { target: { value: '5, 14' } });
    fireEvent.click(screen.getByLabelText('One reminder 2 days before the signing link ends'));
    fireEvent.click(screen.getByLabelText('Remind clients about open payment requests and pro formas'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PUT /api/sending/settings/contract-reminders')).toBe(true));
    expect(calls.find((c) => c.key === 'PUT /api/sending/settings/reminders')!.body).toEqual({ enabled: false, beforeDays: [3], afterDays: [5, 14] });
    expect(calls.find((c) => c.key === 'PUT /api/sending/settings/contract-reminders')!.body).toEqual({ enabled: true, afterDays: [3, 7], beforeEnd: false });
  });

  it('refuses days that are not whole numbers', async () => {
    render(
      <ToastProvider>
        <EmailTab />
      </ToastProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Days after sending without a signature'), { target: { value: 'three' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    expect(await screen.findByText(/whole numbers from 1 to 60/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('reads day lists', () => {
    expect(parseDays('10, 3,3')).toEqual([3, 10]);
    expect(parseDays('')).toEqual([]);
    expect(parseDays('0')).toBeNull();
    expect(parseDays('2.5')).toBeNull();
  });
});
