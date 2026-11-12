import { useEffect, useState } from 'react';
import { ApiError, apiGet } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';

/**
 * R48 task 3: Settings > Digital signature, per business. The key is made in this browser with
 * WebCrypto, or uploaded as a PEM pair or a .p12 file opened here. Only the key and certificate
 * are posted, once, over TLS. The Worker never makes RSA keys.
 */
export interface SigningKeyInfo {
  id: number;
  subject: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  source: 'generated' | 'uploaded';
  status: 'active' | 'retired';
  createdAt: string;
  retiredAt: string | null;
}

export interface SigningStatus {
  businessId: number;
  businessName: string;
  taxId: string | null;
  edition: 'single' | 'firm';
  mode: 'own' | 'ledger' | 'none';
  /** mode 'ledger': the subject of the Ledger's shared key. */
  ledgerSubject: string | null;
  active: SigningKeyInfo | null;
  history: SigningKeyInfo[];
}

export const fetchSigning = () => apiGet<SigningStatus>('/signing');

export async function postSigningKey(
  input: { keyPem: string; certPem: string; source: 'generated' | 'uploaded' },
  businessId?: number,
): Promise<{ key: SigningKeyInfo; warning: string | null }> {
  const res = await fetch('/api/signing/key', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'content-type': 'application/json',
      ...(businessId === undefined ? {} : { 'X-Business-Id': String(businessId) }),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as { key: SigningKeyInfo; warning: string | null };
}

/** Makes a key for the current business in this browser and stores it. Used right after Add business too. */
export async function createKeyInBrowser(name: string, taxId: string | null, businessId?: number) {
  const { makeSigningPair } = await import('./signing-cert');
  const pair = await makeSigningPair(name, taxId);
  return postSigningKey({ ...pair, source: 'generated' }, businessId);
}

const day = (iso: string) => iso.slice(0, 10);

export function DigitalSignatureCard() {
  const t = useT();
  const toast = useToast();
  const [status, setStatus] = useState<SigningStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [keyPem, setKeyPem] = useState('');
  const [certPem, setCertPem] = useState('');
  const [p12, setP12] = useState<File | null>(null);
  const [p12Password, setP12Password] = useState('');

  const load = () =>
    fetchSigning()
      .then(setStatus)
      .catch(() => setStatus(null));
  useEffect(() => {
    void load();
  }, []);

  if (!status) return null;
  const replacing = status.active !== null;
  const confirmed = !replacing || confirmText.trim() === status.businessName.trim();

  const act = async (fn: () => Promise<{ warning: string | null }>) => {
    setBusy(true);
    try {
      const { warning } = await fn();
      if (warning) toast.push(warning, 'danger');
      else toast.push(t('settings.signing.saved'));
      setConfirmText('');
      setUploading(false);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.signing.error'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (p12) {
      const { readPkcs12 } = await import('./signing-cert');
      const pair = await readPkcs12(await p12.arrayBuffer(), p12Password);
      return postSigningKey({ ...pair, source: 'uploaded' });
    }
    return postSigningKey({ keyPem, certPem, source: 'uploaded' });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="digital-signature">
      <h3 className="font-heading text-base text-ink">{t('settings.signing.title')}</h3>
      {status.active ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">{t('settings.signing.subject')}</dt>
          <dd className="text-ink">{status.active.subject}</dd>
          <dt className="text-muted">{t('settings.signing.serial')}</dt>
          <dd className="break-all text-ink">{status.active.serial}</dd>
          <dt className="text-muted">{t('settings.signing.valid')}</dt>
          <dd className="text-ink">
            {t('settings.signing.range', { from: day(status.active.notBefore), to: day(status.active.notAfter) })}
          </dd>
          <dt className="text-muted">{t('settings.signing.source')}</dt>
          <dd className="text-ink">{status.active.source === 'generated' ? t('settings.signing.sourceGenerated') : t('settings.signing.sourceUploaded')}</dd>
        </dl>
      ) : status.mode === 'ledger' ? (
        <p className="text-sm text-muted" data-testid="signing-shared">
          {t('settings.signing.shared', { subject: status.ledgerSubject ?? '' })}
        </p>
      ) : (
        <p className="text-sm text-danger" data-testid="signing-none">
          {t('settings.signing.none')}
        </p>
      )}
      {replacing && (
        <label className="flex flex-col text-xs text-muted">
          {t('settings.signing.confirm', { name: status.businessName })}
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !confirmed}
          onClick={() => act(() => createKeyInBrowser(status.businessName, status.taxId))}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? t('settings.signing.working') : t('settings.signing.create')}
        </button>
        <button type="button" disabled={busy} onClick={() => setUploading((v) => !v)} className="rounded-full border border-line px-4 py-2 text-sm">
          {t('settings.signing.upload')}
        </button>
      </div>
      {uploading && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col text-xs text-muted">
            {t('settings.signing.p12')}
            <input type="file" accept=".p12,.pfx" onChange={(e) => setP12(e.target.files?.[0] ?? null)} />
          </label>
          {p12 && (
            <label className="flex flex-col text-xs text-muted">
              {t('settings.signing.p12Password')}
              <input type="password" value={p12Password} onChange={(e) => setP12Password(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
            </label>
          )}
          {!p12 && (
            <>
              <label className="flex flex-col text-xs text-muted">
                {t('settings.signing.keyPem')}
                <textarea rows={3} value={keyPem} onChange={(e) => setKeyPem(e.target.value)} className="rounded-md border border-line px-2 py-1 font-mono text-xs" />
              </label>
              <label className="flex flex-col text-xs text-muted">
                {t('settings.signing.certPem')}
                <textarea rows={3} value={certPem} onChange={(e) => setCertPem(e.target.value)} className="rounded-md border border-line px-2 py-1 font-mono text-xs" />
              </label>
            </>
          )}
          <button type="button" disabled={busy || !confirmed} onClick={() => act(upload)} className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {t('settings.signing.uploadSave')}
          </button>
        </div>
      )}
      {status.history.filter((h) => h.status === 'retired').length > 0 && (
        <div className="text-xs text-muted">
          <p>{t('settings.signing.retired')}</p>
          <ul>
            {status.history
              .filter((h) => h.status === 'retired')
              .map((h) => (
                <li key={h.id}>
                  {h.subject} · {t('settings.signing.range', { from: day(h.notBefore), to: day(h.notAfter) })} · {t('settings.signing.retiredOn', { date: day(h.retiredAt ?? '') })}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
