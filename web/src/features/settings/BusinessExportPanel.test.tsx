import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { BusinessExportPanel, type ExportRunView } from './BusinessExportPanel';

/** R48 task 4: each file is its own request, progress per file, and Retry on a failed file. */
describe('R48 business export panel', () => {
  it('builds each file, shows a failure with Retry, and the retry builds it', async () => {
    const plan: ExportRunView = { id: 'r1', completedAt: null, files: [{ name: 'data.json', built: false }, { name: 'manifest.json', built: false }] };
    let fail = true;
    const api = {
      start: vi.fn(async () => ({ run: plan })),
      build: vi.fn(async (_run: string, name: string) => {
        if (name === 'manifest.json' && fail) {
          fail = false;
          throw new Error('Build these files first.');
        }
        const files = plan.files.map((f) => (f.name === name ? { ...f, built: true, links: [`/access/downloads/${name}`] } : f));
        plan.files = files;
        return { run: { ...plan, files, completedAt: files.every((f) => f.built) ? 'now' : null } };
      }),
    };
    render(
      <PreferencesProvider persist={() => undefined}>
        <BusinessExportPanel api={api} />
      </PreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Build these files first.')).toBeTruthy();
    expect(api.build).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Every file is built. Download each one.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Download' })).toHaveLength(2);
  });
});
