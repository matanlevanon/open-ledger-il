import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { type MessageKey, useT } from '../../i18n';
import { type FirmTeamMember, addFirmTeamMember, fetchFirmTeam, makeFirmAdmin, removeFirmAdmin, revokeFirmTeamMember } from './api';

const ROLE_LABEL: Record<FirmTeamMember['role'], MessageKey> = {
  admin: 'settings.firmTeam.role.admin',
  assistant: 'settings.firmTeam.role.assistant',
  accountant: 'settings.firmTeam.role.accountant',
};

/**
 * R48 task 1: Settings > Firm team. Firm edition, Ledger admins only. Firm staff reach every
 * client business with one grant. Admins own every business and the Ledger-wide settings.
 */
export function FirmTeamTab() {
  const t = useT();
  const toast = useToast();
  const [team, setTeam] = useState<FirmTeamMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'assistant' | 'accountant'>('accountant');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchFirmTeam()
      .then(setTeam)
      .catch(() => setTeam([]));
  }, []);

  const run = async (fn: () => Promise<FirmTeamMember[] | void>) => {
    setBusy(true);
    try {
      const next = await fn();
      setTeam(next ?? (await fetchFirmTeam()));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.firmTeam.error'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (!team) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-lg text-ink">{t('settings.firmTeam.title')}</h2>
      <p className="text-xs text-muted">{t('settings.firmTeam.hint')}</p>
      <ul className="flex flex-col divide-y divide-line">
        {team.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="firm-team-row">
            <span className="min-w-0 flex-1 truncate text-ink">{m.email}</span>
            <span className="text-muted">{t(ROLE_LABEL[m.role])}</span>
            {m.endsAt && <span className="text-xs text-muted">{t('settings.firmTeam.until', { date: m.endsAt })}</span>}
            {m.role === 'admin' && !m.lastAdmin && (
              <button type="button" disabled={busy} className="text-xs text-danger" onClick={() => run(() => removeFirmAdmin(m.id))}>
                {t('settings.firmTeam.removeAdmin')}
              </button>
            )}
            {m.role !== 'admin' && (
              <>
                <button type="button" disabled={busy} className="text-xs text-brand" onClick={() => run(() => makeFirmAdmin(m.id))}>
                  {t('settings.firmTeam.makeAdmin')}
                </button>
                <button type="button" disabled={busy} className="text-xs text-danger" onClick={() => run(() => revokeFirmTeamMember(m.id))}>
                  {t('settings.firmTeam.revoke')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const next = await addFirmTeamMember({ email, role, endsAt: endsAt || null });
            setEmail('');
            setEndsAt('');
            return next;
          });
        }}
      >
        <label className="flex flex-col text-xs text-muted">
          {t('settings.firmTeam.email')}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
        </label>
        <label className="flex flex-col text-xs text-muted">
          {t('settings.firmTeam.roleLabel')}
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="rounded-md border border-line px-2 py-1 text-sm text-ink">
            <option value="accountant">{t('settings.firmTeam.role.accountant')}</option>
            <option value="assistant">{t('settings.firmTeam.role.assistant')}</option>
            <option value="admin">{t('settings.firmTeam.role.admin')}</option>
          </select>
        </label>
        {role !== 'admin' && (
          <label className="flex flex-col text-xs text-muted">
            {t('settings.firmTeam.endsAt')}
            <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="rounded-md border border-line px-2 py-1 text-sm text-ink" />
          </label>
        )}
        <button type="submit" disabled={busy} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {t('settings.firmTeam.add')}
        </button>
      </form>
      <p className="text-xs text-muted">{t('settings.firmTeam.accessNote')}</p>
    </section>
  );
}
