import { useEffect, useState } from 'react';
import { fetchMe } from '../../api/client';
import { type MessageKey, useT } from '../../i18n';
import { ApiError, fetchUsers, inviteAccountant, revokeAccountant, updateAccountant, type AccessUser } from './api';
import { FEATURE_KEYS, FEATURE_LABEL_KEYS } from './features';
import { InviteForm } from './InviteForm';

const ROLE_LABEL_KEYS: Record<AccessUser['role'], MessageKey> = {
  owner: 'access.role.owner',
  assistant: 'access.role.assistant',
  accountant: 'access.role.accountant',
};

function statusLabelKey(user: AccessUser): MessageKey {
  if (user.role === 'owner' || user.role === 'assistant') return 'access.status.owner';
  if (!user.active) return 'access.status.disabled';
  if (user.accessEndsOn && user.accessEndsOn < new Date().toISOString().slice(0, 10)) return 'access.status.expired';
  return 'access.status.active';
}

export function UsersTab() {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // R23 task 7: the app cannot add an email to Cloudflare Access. This line says where to.
  const [accessNote, setAccessNote] = useState<string | null>(null);
  // R39: an error from Remove or a role change shows in its row. The table stays on screen.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const t = useT();

  const load = () =>
    fetchUsers()
      .then((body) => setUsers(body.users))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof Error ? err.message : t('access.users.errorFallback'));
      });

  useEffect(() => {
    load();
    fetchMe()
      .then((me) => setMyEmail(me.email.toLowerCase()))
      .catch(() => setMyEmail(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) {
    return <p className="text-sm text-muted">{t('access.ownerOnly')}</p>;
  }
  if (error && !users) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!users) {
    return <p className="text-sm text-muted">{t('access.loading')}</p>;
  }

  const rowAction = async (user: AccessUser, action: () => Promise<unknown>) => {
    setRowErrors(({ [user.id]: _, ...rest }) => rest);
    try {
      await action();
    } catch (err) {
      setRowErrors((all) => ({ ...all, [user.id]: err instanceof Error && err.message ? err.message : t('access.users.actionError') }));
    }
    await load();
  };

  const toggleFeature = (user: AccessUser, feature: keyof NonNullable<AccessUser['features']>) => {
    if (!user.features) return;
    void rowAction(user, () => updateAccountant(user.id, { features: { [feature]: !user.features![feature] } }));
  };

  const revoke = (user: AccessUser) => {
    const self = myEmail !== null && user.email.toLowerCase() === myEmail;
    if (!window.confirm(self ? t('access.users.revokeSelfConfirm') : t('access.users.revokeConfirm', { email: user.email }))) return;
    void rowAction(user, () => revokeAccountant(user.id));
  };

  const changeRole = (user: AccessUser, role: AccessUser['role']) => {
    void rowAction(user, () => updateAccountant(user.id, { role }));
  };

  return (
    <div className="flex flex-col gap-4">
      {accessNote && (
        <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-ink" data-testid="access-note">
          {accessNote}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{t('access.users.caption')}</caption>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th className="py-2">{t('access.users.colEmail')}</th>
            <th>{t('access.users.colName')}</th>
            <th>{t('access.users.colRole')}</th>
            <th>{t('access.users.colStatus')}</th>
            <th>{t('access.users.colAccessEnds')}</th>
            <th>{t('access.users.colFeatures')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-line align-top">
              <td className="py-2">{user.email}</td>
              <td>{user.name ?? t('access.users.noneFallback')}</td>
              <td>
                <select
                  aria-label={t('access.users.roleFor', { email: user.email })}
                  value={user.role}
                  disabled={user.lastOwner}
                  onChange={(e) => changeRole(user, e.target.value as AccessUser['role'])}
                  className="rounded-md border border-line bg-canvas px-1 py-0.5 text-sm disabled:opacity-60"
                >
                  {(['owner', 'assistant', 'accountant'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_LABEL_KEYS[r])}
                    </option>
                  ))}
                </select>
                {user.lastOwner && <p className="mt-1 max-w-[14rem] text-xs text-muted">{t('access.users.onlyOwner')}</p>}
              </td>
              <td>{t(statusLabelKey(user))}</td>
              <td className="ltr-nums">{user.accessEndsOn ?? t('access.users.noneFallback')}</td>
              <td>
                {user.features && (
                  <div className="flex flex-col gap-1">
                    {FEATURE_KEYS.map((key) => (
                      <label key={key} className="flex items-center gap-2">
                        <input type="checkbox" checked={user.features![key]} onChange={() => toggleFeature(user, key)} />
                        {t(FEATURE_LABEL_KEYS[key])}
                      </label>
                    ))}
                  </div>
                )}
              </td>
              <td>
                {!user.lastOwner && (
                  <button
                    type="button"
                    onClick={() => revoke(user)}
                    className="rounded-full border border-line px-3 py-1 text-xs text-danger hover:bg-surface"
                  >
                    {t('access.users.revoke')}
                  </button>
                )}
                {rowErrors[user.id] && (
                  <p role="alert" className="mt-1 max-w-[14rem] text-xs text-danger">
                    {rowErrors[user.id]}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {inviting ? (
        <InviteForm
          onCancel={() => setInviting(false)}
          onInvite={async (input) => {
            const res = await inviteAccountant(input);
            setAccessNote(res.accessNote ? `${input.email}: ${res.accessNote}` : null);
            setInviting(false);
            await load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="w-fit rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90"
        >
          {t('access.users.inviteAccountant')}
        </button>
      )}
    </div>
  );
}
