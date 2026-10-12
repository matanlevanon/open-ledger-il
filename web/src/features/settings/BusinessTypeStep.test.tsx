import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessTypeStatus, EntityType } from './api';
import { BusinessTypeStep } from './BusinessTypeStep';

const originalFetch = global.fetch;
const posts: string[] = [];

afterEach(() => {
  global.fetch = originalFetch;
  posts.length = 0;
});

const status = (over: Partial<BusinessTypeStatus>): BusinessTypeStatus => ({
  entityType: 'osek_patur',
  fresh: true,
  switchedOn: null,
  vatReporting: 'bimonthly',
  showCeiling: true,
  setupBusinessType: null,
  ...over,
});

function renderStep(first: BusinessTypeStatus, after?: BusinessTypeStatus) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push(new URL(String(input), 'http://localhost').pathname);
    expect(init?.method).toBe('POST');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  let calls = 0;
  const load = vi.fn(() => Promise.resolve(calls++ === 0 ? first : (after ?? first)));
  const settled: (EntityType | null)[] = [];
  render(<BusinessTypeStep load={load} onSettled={(t) => settled.push(t)} />);
  return settled;
}

describe('BusinessTypeStep (R24 first-run setup)', () => {
  it('defaults to עוסק פטור and shows the business fields at once', async () => {
    const settled = renderStep(status({}));
    expect(await screen.findByRole('radio', { name: /עוסק פטור/ })).toBeChecked();
    await waitFor(() => expect(settled.at(-1)).toBe('osek_patur'));
  });

  it('preselects the installer choice and holds the fields until the typed confirmation', async () => {
    const settled = renderStep(status({ setupBusinessType: 'company' }), status({ entityType: 'company', showCeiling: false }));
    expect(await screen.findByRole('radio', { name: /חברה בע"מ/ })).toBeChecked();
    await waitFor(() => expect(settled.at(-1)).toBeNull());
    const confirm = screen.getByRole('button', { name: 'Confirm business type' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('מורשה'), { target: { value: 'מורשה' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toEqual(['/api/legal-mode/start-company']));
    expect(await screen.findByTestId('setup-entity-type')).toHaveTextContent('חברה בע"מ');
    await waitFor(() => expect(settled.at(-1)).toBe('company'));
  });

  it('מורשה runs the registered switch', async () => {
    renderStep(status({ setupBusinessType: 'osek_murshe' }), status({ entityType: 'osek_murshe' }));
    expect(await screen.findByRole('radio', { name: /עוסק מורשה/ })).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('מורשה'), { target: { value: 'מורשה' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm business type' }));
    await waitFor(() => expect(posts).toEqual(['/api/legal-mode/switch']));
  });
});
