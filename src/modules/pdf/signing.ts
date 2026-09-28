import { ConfigError } from '../../core/errors';
import { signatureMode } from '../documents/settings';
import type { SigningIdentity } from '../signing';
import type { Env } from '../../env';

/**
 * Resolves the PAdES signing identity for `renderAndStore` (CLAUDE.md: every PDF that can leave
 * the system carries a secured signature, instruction 18ב). Reads R03's `signature_mode` setting
 * (`src/modules/documents/settings.ts`, 'secured' by default).
 *
 * - mode 'none': no signing, always.
 * - mode 'secured' (default) with both secrets set: sign.
 * - mode 'secured' with a secret missing: `require: true` (the sending path, where the legal
 *   requirement is live) throws `ConfigError`. `require: false` (internal preview/render, so a
 *   deploy that has not set the secrets yet keeps working) renders unsigned.
 */
export async function resolveSigningIdentity(
  db: D1Database,
  env: Pick<Env, 'SIGNING_KEY_PEM' | 'SIGNING_CERT_PEM'>,
  options: { require?: boolean } = {},
): Promise<SigningIdentity | null> {
  const mode = await signatureMode(db);
  if (mode === 'none') return null;
  const { SIGNING_KEY_PEM, SIGNING_CERT_PEM } = env;
  if (!SIGNING_KEY_PEM || !SIGNING_CERT_PEM) {
    if (options.require) {
      throw new ConfigError('Secured signing is required but SIGNING_KEY_PEM and SIGNING_CERT_PEM are not set.');
    }
    return null;
  }
  return { keyPem: SIGNING_KEY_PEM, certPem: SIGNING_CERT_PEM };
}
