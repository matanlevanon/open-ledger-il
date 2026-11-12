import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_MODE } from '../../api/client';
import { useT } from '../../i18n';
import { type SigningStatus, fetchSigning } from '../settings/DigitalSignatureCard';

/**
 * R48 task 3: firm edition. A client business with no signing key of its own cannot send
 * documents, so its dashboard says so. Owners only: anyone else gets 403 and sees nothing.
 */
export function NoSigningKeyBanner({ load = fetchSigning }: { load?: () => Promise<SigningStatus> }) {
  const t = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (MOCK_MODE && load === fetchSigning) return;
    load()
      .then((s) => setShow(s.edition === 'firm' && s.mode === 'none'))
      .catch(() => setShow(false));
  }, [load]);
  if (!show) return null;
  return (
    <p role="status" data-testid="no-signing-key" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
      <Link to="/settings?tab=signature" className="hover:underline">
        {t('dashboard.noSigningKey')}
      </Link>
    </p>
  );
}
