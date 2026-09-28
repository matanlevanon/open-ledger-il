import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { ApiError } from './api';

interface ImageUploadProps {
  /** API path under /api/ops, for example "/business/logo". GET serves it, POST uploads, DELETE removes. */
  path: string;
  title: string;
  hint: string;
}

/** Upload, preview and remove one business image (logo or signature). PNG, JPEG, WebP or SVG, up to 2 MB. */
export function ImageUpload({ path, title, hint }: ImageUploadProps) {
  const [version, setVersion] = useState(0);
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const t = useT();
  const url = `/api/ops${path}?v=${version}`;

  useEffect(() => {
    let live = true;
    fetch(url, { method: 'GET' })
      .then((res) => live && setPresent(res.ok))
      .catch(() => live && setPresent(false));
    return () => {
      live = false;
    };
  }, [url]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/ops${path}`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
        throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? t('settings.image.uploadError'));
      }
      setVersion((v) => v + 1);
      toast.push(t('settings.image.uploaded'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.image.uploadError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ops${path}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('settings.image.removeError'));
      setVersion((v) => v + 1);
      toast.push(t('settings.image.removed'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.image.removeError'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-lg text-ink">{title}</h2>
      <p className="text-xs text-muted">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        {present ? (
          <img src={url} alt={title} className="h-16 max-w-[240px] rounded-md border border-line bg-white object-contain p-1" />
        ) : (
          <p className="text-sm text-muted">{t('settings.image.none')}</p>
        )}
        <label className="cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
          {present ? t('settings.image.replace') : t('settings.image.upload')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
        </label>
        {present && (
          <button type="button" disabled={busy} onClick={remove} className="text-sm text-danger hover:underline disabled:opacity-60">
            {t('settings.image.remove')}
          </button>
        )}
      </div>
    </section>
  );
}
