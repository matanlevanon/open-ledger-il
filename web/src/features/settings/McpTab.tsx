import { useEffect, useState } from 'react';
import { ApiError, apiGet } from '../../api/client';
import { Dialog } from '../../components/Dialog';
import { GuideTip } from '../../components/GuideTip';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { btnPrimary, btnSecondary, label } from '../documents/ui';
import { ApiSection } from './ApiSection';

/**
 * R34: Settings > MCP. The address, the token state, Make a new token, and MCP on or off. A new
 * token shows once and lives only in this component's state: a reload or another tab drops it.
 */
export type McpTokenState =
  | { state: 'none' }
  | { state: 'installer' }
  | { state: 'ledger'; last4: string; createdAt: string; createdBy: string; lastUsedAt: string | null };

export interface McpSettings {
  address: string;
  enabled: boolean;
  token: McpTokenState;
}

export const mcpApi = {
  get: () => apiGet<McpSettings>('/settings/mcp'),
  makeToken: () => apiSend<{ token: string; last4: string }>('POST', '/settings/mcp/token'),
  setEnabled: (enabled: boolean) => apiSend<{ enabled: boolean }>('POST', '/settings/mcp/enabled', { enabled }),
};

/** The Claude Desktop file, the same entry the installer writes. */
export function claudeDesktopConfig(address: string, token: string) {
  return {
    mcpServers: {
      'open-ledger': { command: 'npx', args: ['-y', 'mcp-remote', address, '--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: `Bearer ${token}` } },
    },
  };
}

/** The Claude Code `.mcp.json`, the same entry the installer writes. */
export function claudeCodeConfig(address: string, token: string) {
  return { mcpServers: { 'open-ledger': { type: 'http', url: address, headers: { Authorization: `Bearer ${token}` } } } };
}

function download(name: string, obj: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`${JSON.stringify(obj, null, 2)}\n`], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const day = (iso: string) => iso.slice(0, 10);

export function McpTab() {
  const t = useT();
  const toast = useToast();
  const [info, setInfo] = useState<McpSettings | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const load = () =>
    mcpApi
      .get()
      .then(setInfo)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.mcp.loadError'));
      });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!info) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    toast.push(t('settings.mcp.copied'));
  };

  const make = async () => {
    setBusy(true);
    try {
      const made = await mcpApi.makeToken();
      setToken(made.token);
      setConfirming(false);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.mcp.makeError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const saved = await mcpApi.setEnabled(enabled);
      setInfo({ ...info, enabled: saved.enabled });
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.mcp.saveError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const host = new URL(info.address).hostname;
  const s = info.token;
  const stateLine =
    s.state === 'installer'
      ? t('settings.mcp.state.installer')
      : s.state === 'ledger'
        ? `${t('settings.mcp.state.ledger', { date: day(s.createdAt), email: s.createdBy, last4: s.last4 })} ${
            s.lastUsedAt ? t('settings.mcp.state.lastUsed', { date: day(s.lastUsedAt) }) : t('settings.mcp.state.notUsed')
          }`
        : t('settings.mcp.state.none');

  // R41: one page, two sections. MCP first, then the API for other apps.
  return (
    <div className="flex flex-col gap-8">
    <section data-testid="mcp-section" className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          {t('settings.mcp.title')}
          <GuideTip id="mcp" />
        </h2>
        <p className="text-sm text-muted">{t('settings.mcp.intro')}</p>
      </div>

      <div>
        <span className={label}>{t('settings.mcp.address')}</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code dir="ltr" data-testid="mcp-address" className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
            {info.address}
          </code>
          <button type="button" className={btnSecondary} onClick={() => void copy(info.address)}>
            {t('settings.mcp.copy')}
          </button>
        </div>
      </div>

      <p data-testid="mcp-state" className="text-sm text-ink">
        {stateLine}
      </p>

      {token && (
        <div data-testid="mcp-new-token" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <span className={label}>{t('settings.mcp.newToken')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" data-testid="mcp-token" className="break-all rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink">
              {token}
            </code>
            <button type="button" className={btnSecondary} onClick={() => void copy(token)}>
              {t('settings.mcp.copy')}
            </button>
          </div>
          <p className="text-sm font-semibold text-ink">{t('settings.mcp.shownOnce')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => download(`claude-desktop-${host}.json`, claudeDesktopConfig(info.address, token))}>
              {t('settings.mcp.downloadDesktop')}
            </button>
            <button type="button" className={btnSecondary} onClick={() => download('.mcp.json', claudeCodeConfig(info.address, token))}>
              {t('settings.mcp.downloadCode')}
            </button>
          </div>
          <p className="text-xs text-muted">{t('settings.mcp.filesHint')}</p>
        </div>
      )}

      <div>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => setConfirming(true)}>
          {t('settings.mcp.make')}
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" role="switch" checked={info.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        {t('settings.mcp.enabled')}
      </label>
      {!info.enabled && (
        <p role="status" data-testid="mcp-off" className="text-sm text-danger">
          {t('settings.mcp.off')}
        </p>
      )}

      <Dialog
        open={confirming}
        title={t('settings.mcp.confirmTitle')}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setConfirming(false)}>
              {t('settings.mcp.cancel')}
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void make()}>
              {t('settings.mcp.confirm')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{t('settings.mcp.confirmBody')}</p>
      </Dialog>
      <p className="text-xs text-muted">{t('settings.mcp.switchNote')}</p>
    </section>
    <ApiSection />
    </div>
  );
}
