import { useState } from 'react';
import { useT } from '../../i18n';
import { btnPrimary, btnSecondary, ErrorNote, errorText, input, label } from '../documents/ui';
import { contractsApi, type ContractDetail, type TemplateKind } from './api';
import { toMinor } from './ContractEditor';

const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

/** R28: file a contract signed outside the Ledger, with its signed PDF. Saved as signed, never edited. */
export function ExternalContractForm({ clientId, onSaved, onCancel }: { clientId: number; onSaved: (c: ContractDetail) => void; onCancel: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TemplateKind>('contract');
  const [signedDate, setSignedDate] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fee, setFee] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = title.trim() && signedDate && signerName.trim() && file;
  const optional = (text: string) => `${text} (${t('contracts.external.optional')})`;

  async function save() {
    setError(null);
    const feeMinor = fee.trim() ? toMinor(fee) : null;
    if (fee.trim() && feeMinor === null) return setError(t('contracts.external.badFee'));
    const form = new FormData();
    form.set('file', file!);
    const fields: Record<string, string> = {
      clientId: String(clientId),
      title: title.trim(),
      kind,
      signedDate,
      signerName: signerName.trim(),
      signerRole: signerRole.trim(),
      signerEmail: signerEmail.trim(),
      startDate,
      endDate,
      feeAmountMinor: feeMinor === null ? '' : String(feeMinor),
      feeCurrency: feeMinor === null ? '' : currency,
      notes: notes.trim(),
    };
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    setBusy(true);
    try {
      onSaved((await contractsApi.uploadExternal(form)).contract);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-line p-4" data-testid="external-form">
      <h3 className="mb-1 font-semibold">{t('contracts.external.title')}</h3>
      <p className="mb-3 text-sm text-muted">{t('contracts.external.note')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className={label}>{t('contracts.external.name')}</span>
          <input className={input} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{t('contracts.external.kind')}</span>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
            <option value="contract">{t('contracts.external.kind.contract')}</option>
            <option value="work_order">{t('contracts.external.kind.work_order')}</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>{t('contracts.external.signedDate')}</span>
          <input type="date" className={input} value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{t('contracts.external.signerName')}</span>
          <input className={input} dir="auto" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{optional(t('contracts.external.signerRole'))}</span>
          <input className={input} dir="auto" value={signerRole} onChange={(e) => setSignerRole(e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className={label}>{optional(t('contracts.external.signerEmail'))}</span>
          <input type="email" className={input} dir="ltr" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{optional(t('contracts.external.start'))}</span>
          <input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{optional(t('contracts.external.end'))}</span>
          <input type="date" className={input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{optional(t('contracts.external.fee'))}</span>
          <input className={`${input} ltr-nums`} inputMode="decimal" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>{t('contracts.external.currency')}</span>
          <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className={label}>{optional(t('contracts.external.notes'))}</span>
          <textarea className={input} dir="auto" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className={label}>{t('contracts.external.file')}</span>
          <input type="file" accept="application/pdf,.pdf" className="mt-1 block text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={!ready || busy} onClick={() => void save()}>
          {t('contracts.external.save')}
        </button>
        <button type="button" className={btnSecondary} onClick={onCancel}>
          {t('contracts.templates.cancel')}
        </button>
      </div>
    </div>
  );
}
