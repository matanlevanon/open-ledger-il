import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { Dialog } from '../../components/Dialog';
import { GuideTip, guideUrl } from '../../components/GuideTip';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { btnDanger, btnPrimary, btnSecondary, input, label } from '../documents/ui';

/**
 * R41: Settings > MCP and API, the API half. The address, the Business ID, the keys, Create key
 * and Revoke. A new key shows once and lives only in this component's state.
 */

export interface ApiKeyView {
  id: number;
  name: string;
  scope: 'read' | 'write';
  last4: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
}

export interface ApiSettings {
  address: string;
  businessId: number;
  keys: ApiKeyView[];
}

export const apiKeysApi = {
  get: () => apiGet<ApiSettings>('/settings/api-keys'),
  create: (name: string, scope: 'read' | 'write') => apiSend<{ key: string; apiKey: ApiKeyView }>('POST', '/settings/api-keys', { name, scope }),
  revoke: (id: number) => apiSend<{ revoked: boolean }>('DELETE', `/settings/api-keys/${id}`),
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function ApiSection() {
  const t = useT();
  const toast = useToast();
  const { locale } = usePreferences();
  const [info, setInfo] = useState<ApiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);

  const load = () =>
    apiKeysApi
      .get()
      .then((body) => {
        setInfo(body);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('settings.api.loadError')));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    toast.push(t('settings.mcp.copied'));
  };

  const create = async () => {
    setBusy(true);
    try {
      const made = await apiKeysApi.create(name.trim(), scope);
      setNewKey(made.key);
      setCreating(false);
      setName('');
      setScope('read');
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.api.createError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await apiKeysApi.revoke(revoking.id);
      setRevoking(null);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.api.revokeError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="api-section" className="flex max-w-2xl flex-col gap-4 border-t border-line pt-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          {t('settings.api.title')}
          <GuideTip id="api" />
        </h2>
        <p className="text-sm text-muted">{t('settings.api.intro')}</p>
      </div>

      {error && !info && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {info && (
        <>
          <div className="flex flex-wrap gap-6">
            <div>
              <span className={label}>{t('settings.api.address')}</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code dir="ltr" data-testid="api-address" className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
                  {info.address}
                </code>
                <button type="button" className={btnSecondary} onClick={() => void copy(info.address)}>
                  {t('settings.mcp.copy')}
                </button>
              </div>
            </div>
            <div>
              <span className={label}>{t('settings.api.businessId')}</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code dir="ltr" data-testid="api-business-id" className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
                  {info.businessId}
                </code>
                <button type="button" className={btnSecondary} onClick={() => void copy(String(info.businessId))}>
                  {t('settings.mcp.copy')}
                </button>
              </div>
            </div>
          </div>
          <a href={guideUrl('api', locale)} target="_blank" rel="noopener" className="w-fit text-sm text-brand hover:underline">
            {t('settings.api.docs')}
          </a>

          {newKey && (
            <div data-testid="api-new-key" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
              <span className={label}>{t('settings.api.newKey')}</span>
              <div className="flex flex-wrap items-center gap-2">
                <code dir="ltr" className="break-all rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink">
                  {newKey}
                </code>
                <button type="button" className={btnSecondary} onClick={() => void copy(newKey)}>
                  {t('settings.mcp.copy')}
                </button>
              </div>
              <p className="text-sm font-semibold text-ink">{t('settings.api.shownOnce')}</p>
              <button type="button" className={`${btnPrimary} w-fit`} onClick={() => setNewKey(null)}>
                {t('settings.api.copiedIt')}
              </button>
            </div>
          )}

          {info.keys.length === 0 ? (
            <p className="text-sm text-muted">{t('settings.api.noKeys')}</p>
          ) : (
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{t('settings.api.keys')}</caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">{t('settings.api.colName')}</th>
                  <th>{t('settings.api.colScope')}</th>
                  <th>{t('settings.api.colEnds')}</th>
                  <th>{t('settings.api.colCreated')}</th>
                  <th>{t('settings.api.colUsed')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {info.keys.map((k) => (
                  <tr key={k.id} className="border-t border-line">
                    <td className="py-2" dir="auto">
                      {k.name}
                    </td>
                    <td>{k.scope === 'write' ? t('settings.api.scopeWrite') : t('settings.api.scopeRead')}</td>
                    <td className="ltr-nums">…{k.last4}</td>
                    <td className="ltr-nums">{day(k.createdAt)}</td>
                    <td className="ltr-nums">{day(k.lastUsedAt) ?? t('settings.api.never')}</td>
                    <td>
                      <button type="button" className="rounded-full border border-line px-3 py-1 text-xs text-danger hover:bg-surface" onClick={() => setRevoking(k)}>
                        {t('settings.api.revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {creating ? (
            <form
              className="flex flex-col gap-3 rounded-md border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className={label}>{t('settings.api.name')}</span>
                <input className={input} value={name} placeholder={t('settings.api.namePlaceholder')} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
              <fieldset className="flex flex-col gap-1">
                <legend className={label}>{t('settings.api.scope')}</legend>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="api-scope" checked={scope === 'read'} onChange={() => setScope('read')} />
                  {t('settings.api.scopeRead')}
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="api-scope" checked={scope === 'write'} onChange={() => setScope('write')} />
                  {t('settings.api.scopeWrite')}
                </label>
              </fieldset>
              {scope === 'write' && (
                <p role="note" data-testid="api-write-warning" className="text-sm text-ink">
                  {t('settings.api.writeWarning')}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>
                  {t('settings.api.create')}
                </button>
                <button type="button" className={btnSecondary} onClick={() => setCreating(false)}>
                  {t('settings.mcp.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
                {t('settings.api.create')}
              </button>
            </div>
          )}

          <p className="text-xs text-muted">{t('settings.api.stateNote')}</p>
        </>
      )}

      <Dialog
        open={revoking !== null}
        title={t('settings.api.revoke')}
        onClose={() => setRevoking(null)}
        footer={
          <>
            <button type="button" className={btnSecondary} onClick={() => setRevoking(null)}>
              {t('settings.mcp.cancel')}
            </button>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void revoke()}>
              {t('settings.api.revoke')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink">{t('settings.api.revokeConfirm', { name: revoking?.name ?? '' })}</p>
      </Dialog>
    </section>
  );
}
