import { useEffect, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { ApiError, fetchUsers, inviteAccountant, revokeAccountant, updateAccountant, type AccessUser } from './api';
import { FEATURE_KEYS, FEATURE_LABEL_KEYS } from './features';
import { InviteForm } from './InviteForm';

const ROLE_LABEL_KEYS: Record<AccessUser['role'], MessageKey> = {
  owner: 'access.role.owner',
  accountant: 'access.role.accountant',
};

function statusLabelKey(user: AccessUser): MessageKey {
  if (user.role === 'owner') return 'access.status.owner';
  if (!user.active) return 'access.status.disabled';
  if (user.accessEndsOn && user.accessEndsOn < new Date().toISOString().slice(0, 10)) return 'access.status.expired';
  return 'access.status.active';
}

export function UsersTab() {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (forbidden) {
    return <p className="text-sm text-muted">{t('access.ownerOnly')}</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!users) {
    return <p className="text-sm text-muted">{t('access.loading')}</p>;
  }

  const toggleFeature = async (user: AccessUser, feature: keyof NonNullable<AccessUser['features']>) => {
    if (!user.features) return;
    await updateAccountant(user.id, { features: { [feature]: !user.features[feature] } });
    await load();
  };

  const revoke = async (user: AccessUser) => {
    if (!window.confirm(t('access.users.revokeConfirm', { email: user.email }))) return;
    await revokeAccountant(user.id);
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
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
              <td>{t(ROLE_LABEL_KEYS[user.role])}</td>
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
                {user.role === 'accountant' && (
                  <button
                    type="button"
                    onClick={() => revoke(user)}
                    className="rounded-full border border-line px-3 py-1 text-xs text-danger hover:bg-surface"
                  >
                    {t('access.users.revoke')}
                  </button>
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
            await inviteAccountant(input);
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
