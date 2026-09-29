import { type MessageKey, useT } from '../../i18n';
import { input } from './ui';

/** Bank, branch and account of a cheque. The unified file requires them on every cheque (D120 fields 1307 to 1309). */
export function ChequeBankFields({
  index,
  value,
  onChange,
}: {
  index: number;
  value: { bankNumber: string; branchNumber: string; accountNumber: string };
  onChange: (patch: Partial<{ bankNumber: string; branchNumber: string; accountNumber: string }>) => void;
}) {
  const t = useT();
  const field = (key: 'bankNumber' | 'branchNumber' | 'accountNumber', labelKey: MessageKey, max: number) => (
    <input
      aria-label={t(labelKey, { index })}
      placeholder={t(labelKey, { index })}
      inputMode="numeric"
      dir="ltr"
      maxLength={max}
      className={input}
      value={value[key]}
      onChange={(e) => onChange({ [key]: e.target.value.replace(/\D/g, '') })}
    />
  );
  return (
    <div className="grid gap-2 sm:grid-cols-3 md:col-span-full">
      {field('bankNumber', 'documents.cheque.bank', 10)}
      {field('branchNumber', 'documents.cheque.branch', 10)}
      {field('accountNumber', 'documents.cheque.account', 15)}
      <p className="text-xs text-muted sm:col-span-3">{t('documents.cheque.hint')}</p>
    </div>
  );
}
