import { useState } from 'react';
import { apiSend } from '../documents/api';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';

/**
 * R48 task 5: moving a client to a Ledger of their own.
 * - ContinueFromLedger (Settings > Numbering): the old Ledger's manifest.json sets the start numbers.
 * - ImportLedgerData (Settings > Businesses): the old Ledger's data.json brings clients, items and
 *   payment methods in as new rows.
 * - MarkMovedOut (Settings > Businesses, Ledger admins): the firm's copy becomes read-only.
 */

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

export function ContinueFromLedger({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const toast = useToast();
  const [result, setResult] = useState<string | null>(null);
  return (
    <section className="mt-6 flex flex-col gap-2" data-testid="continue-from-ledger">
      <h3 className="font-heading text-base text-ink">{t('settings.numbering.continueTitle')}</h3>
      <p className="text-xs text-muted">{t('settings.numbering.continueHint')}</p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label={t('settings.numbering.continueTitle')}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const body = await apiSend<{ applied: unknown[]; skipped: { docType: string; reason: string }[] }>('POST', '/ops/series/continue', await readJson(file));
            setResult(t('settings.numbering.continueResult', { applied: String(body.applied.length), skipped: String(body.skipped.length) }));
            onDone?.();
          } catch (err) {
            toast.push(err instanceof Error ? err.message : t('settings.numbering.setErrorFallback'), 'danger');
          }
        }}
      />
      {result && <p className="text-sm text-ink">{result}</p>}
    </section>
  );
}

export function ImportLedgerData() {
  const t = useT();
  const toast = useToast();
  const [result, setResult] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-2" data-testid="import-ledger-data">
      <h3 className="font-heading text-base text-ink">{t('businesses.move.importTitle')}</h3>
      <p className="text-xs text-muted">{t('businesses.move.importHint')}</p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label={t('businesses.move.importTitle')}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const body = await apiSend<{ created: { clients: number; items: number; paymentMethods: number }; skipped: unknown[] }>('POST', '/import/ledger-data', await readJson(file));
            setResult(
              t('businesses.move.importResult', {
                clients: String(body.created.clients),
                items: String(body.created.items),
                methods: String(body.created.paymentMethods),
                skipped: String(body.skipped.length),
              }),
            );
          } catch (err) {
            toast.push(err instanceof Error ? err.message : t('businesses.addError'), 'danger');
          }
        }}
      />
      {result && <p className="text-sm text-ink">{result}</p>}
    </section>
  );
}

export function MarkMovedOut({ businessId, name, onDone }: { businessId: number; name: string; onDone?: () => void }) {
  const t = useT();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex flex-col gap-2" data-testid="mark-moved-out">
      <h3 className="font-heading text-base text-ink">{t('businesses.move.markTitle')}</h3>
      <p className="text-xs text-muted">{t('businesses.move.markHint')}</p>
      <label className="flex flex-col text-xs text-muted">
        {t('businesses.move.confirm', { name })}
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
      </label>
      <label className="flex flex-col text-xs text-muted">
        {t('businesses.move.note')}
        <input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
      </label>
      <button
        type="button"
        disabled={busy || typed.trim() !== name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await apiSend('POST', `/businesses/${businessId}/moved-out`, { confirmName: typed, note: note || null });
            toast.push(t('businesses.move.done'));
            onDone?.();
          } catch (err) {
            toast.push(err instanceof Error ? err.message : t('businesses.addError'), 'danger');
          } finally {
            setBusy(false);
          }
        }}
        className="w-fit rounded-full border border-danger px-4 py-2 text-sm text-danger disabled:opacity-60"
      >
        {t('businesses.move.markButton')}
      </button>
    </section>
  );
}
