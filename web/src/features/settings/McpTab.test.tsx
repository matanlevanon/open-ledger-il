import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import { claudeCodeConfig, claudeDesktopConfig, McpTab } from './McpTab';

/** R34 task 4: Settings > MCP. The token shows once, Copy works, the downloads hold the installer's JSON. */

const TOKEN = 'olil_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const calls: string[] = [];
let state: Record<string, unknown>;
const writeText = vi.fn(async () => undefined);
const blobs: { name: string; text: Promise<string> }[] = [];

beforeEach(() => {
  calls.length = 0;
  blobs.length = 0;
  writeText.mockClear();
  state = { address: 'https://ledger.example.com/mcp', enabled: true, token: { state: 'installer' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      if (key === 'GET /api/settings/mcp') return new Response(JSON.stringify(state), { status: 200 });
      if (key === 'POST /api/settings/mcp/token') {
        state = { ...state, token: { state: 'ledger', last4: 'DEFG', createdAt: '2026-10-16T10:00:00.000Z', createdBy: 'owner@example.com', lastUsedAt: null } };
        return new Response(JSON.stringify({ token: TOKEN, last4: 'DEFG' }), { status: 201 });
      }
      if (key === 'POST /api/settings/mcp/enabled') {
        const enabled = JSON.parse(String(init?.body)).enabled as boolean;
        state = { ...state, enabled };
        return new Response(JSON.stringify({ enabled }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push({ name: '', text: b.text() }), 'blob:x'), revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    blobs[blobs.length - 1]!.name = this.download;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderTab = () =>
  render(
    <ToastProvider>
      <McpTab />
    </ToastProvider>,
  );

describe('Settings > MCP', () => {
  it('shows the address with Copy and the installer state', async () => {
    renderTab();
    expect(await screen.findByTestId('mcp-address')).toHaveTextContent('https://ledger.example.com/mcp');
    expect(screen.getByTestId('mcp-state')).toHaveTextContent('Token from the installer. It cannot be shown again.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ledger.example.com/mcp'));
  });

  it('asks before making a token, then shows it once with Copy and the new state', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new token' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('The current token stops working now. Every app connected with it must get the new one.');
    expect(calls).not.toContain('POST /api/settings/mcp/token');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).not.toContain('POST /api/settings/mcp/token');

    fireEvent.click(screen.getByRole('button', { name: 'Make a new token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the token' }));
    expect(await screen.findByTestId('mcp-token')).toHaveTextContent(TOKEN);
    expect(screen.getByText('Shown once. Copy it now. If you lose it, make a new one.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mcp-state')).toHaveTextContent('Token made here on 2026-10-16 by owner@example.com, ends in …DEFG. Not used yet.'));
    const copies = screen.getAllByRole('button', { name: 'Copy' });
    fireEvent.click(copies[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
  });

  it('drops the token when the tab is left', async () => {
    const view = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the token' }));
    await screen.findByTestId('mcp-token');
    view.unmount();
    renderTab();
    await screen.findByTestId('mcp-state');
    expect(screen.queryByTestId('mcp-token')).toBeNull();
  });

  it('downloads the same files the installer makes', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new token' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the token' }));
    await screen.findByTestId('mcp-token');
    fireEvent.click(screen.getByRole('button', { name: 'Download for Claude Desktop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download for Claude Code' }));
    expect(blobs.map((b) => b.name)).toEqual(['claude-desktop-ledger.example.com.json', '.mcp.json']);
    const desktop = JSON.parse(await blobs[0]!.text);
    const code = JSON.parse(await blobs[1]!.text);
    expect(desktop).toEqual({
      mcpServers: {
        'open-ledger': {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'https://ledger.example.com/mcp', '--header', 'Authorization:${AUTH_HEADER}'],
          env: { AUTH_HEADER: `Bearer ${TOKEN}` },
        },
      },
    });
    expect(code).toEqual({ mcpServers: { 'open-ledger': { type: 'http', url: 'https://ledger.example.com/mcp', headers: { Authorization: `Bearer ${TOKEN}` } } } });
    expect(desktop).toEqual(claudeDesktopConfig('https://ledger.example.com/mcp', TOKEN));
    expect(code).toEqual(claudeCodeConfig('https://ledger.example.com/mcp', TOKEN));
  });

  it('turns MCP off and says every app is refused', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByTestId('mcp-off')).toHaveTextContent('MCP is off. Every app is refused until you turn it on.');
    expect(calls).toContain('POST /api/settings/mcp/enabled');
  });

  it('shows the last used date of a Ledger token', async () => {
    state = { ...state, token: { state: 'ledger', last4: 'WXYZ', createdAt: '2026-10-01T09:00:00.000Z', createdBy: 'a@b.co', lastUsedAt: '2026-10-15T08:00:00.000Z' } };
    renderTab();
    expect(await screen.findByTestId('mcp-state')).toHaveTextContent('Token made here on 2026-10-01 by a@b.co, ends in …WXYZ. Last used 2026-10-15.');
  });
});
