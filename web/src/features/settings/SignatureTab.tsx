import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError, fetchSignatureMode, setSignatureMode } from './api';
import { ImageUpload } from './ImageUpload';

export function SignatureTab() {
  const [mode, setMode] = useState<'secured' | 'none' | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    fetchSignatureMode()
      .then((body) => setMode(body.mode))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('settings.signature.loadErrorFallback'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) return <p className="text-sm text-muted">{t('settings.ownerOnly')}</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!mode) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const choose = async (next: 'secured' | 'none') => {
    if (next === mode) return;
    try {
      await setSignatureMode(next);
      setMode(next);
      toast.push(
        t('settings.signature.modeSetSuccess', {
          mode: next === 'secured' ? t('settings.signature.modeSecured') : t('settings.signature.modeNone'),
        }),
      );
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.signature.setErrorFallback'), 'danger');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ImageUpload path="/business/signature" title={t('settings.signature.imageTitle')} hint={t('settings.signature.imageHint')} />
      <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('settings.signature.description')}</p>
      <div className="flex flex-col gap-2">
        {(
          [
            ['secured', t('settings.signature.securedLabel')],
            ['none', t('settings.signature.noneLabel')],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="signature-mode" checked={mode === value} onChange={() => choose(value)} />
            {label}
          </label>
        ))}
      </div>
      </div>
    </div>
  );
}
