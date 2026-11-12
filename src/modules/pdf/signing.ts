import { ConfigError, ConflictError } from '../../core/errors';
import { signatureMode } from '../documents/settings';
import type { SigningIdentity } from '../signing';
import type { Env } from '../../env';
import { FIRST_BUSINESS } from '../../core/business';
import { ledgerEdition } from '../../core/edition';
import { decryptActiveKey } from '../signing/keys';

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
/**
 * Instruction 18ב: a document sent by computer must be a מסמך ממוחשב, signed with a secured or
 * certified signature. In signature mode 'none' the PDF carries no signature, so the email and
 * WhatsApp paths refuse to send. Viewing and downloading for print stay open.
 */
export async function assertSigningForSend(db: D1Database, businessId: number): Promise<void> {
  if ((await signatureMode(db, businessId)) === 'none') {
    throw new ConflictError(
      'signature_required_to_send',
      'Signature mode is None, so this document has no digital signature. Instruction 18ב requires one for documents sent by email or WhatsApp. Switch Settings > Signature to Secured signature, or download the PDF and print it.',
    );
  }
}

/**
 * R48 task 3: whose key signs a business's PDFs.
 * - The business's own active key (business_signing_keys), when it has one.
 * - Else, single edition: the env secrets, for every business, exactly as before.
 * - Else, firm edition: the env secrets for business 1 only. Another business with no key of its
 *   own signs nothing, and `require: true` throws a ConfigError naming Settings > Digital signature.
 */
export async function resolveSigningIdentity(
  db: D1Database,
  env: Pick<Env, 'SIGNING_KEY_PEM' | 'SIGNING_CERT_PEM'> & Partial<Pick<Env, 'ITA_TOKEN_KEY' | 'LEDGER_EDITION'>>,
  businessId: number,
  options: { require?: boolean } = {},
): Promise<SigningIdentity | null> {
  const mode = await signatureMode(db, businessId);
  if (mode === 'none') return null;
  const own = await decryptActiveKey(db, env, businessId);
  if (own) return own;
  if (ledgerEdition(env) === 'firm' && businessId !== FIRST_BUSINESS) {
    if (options.require) {
      throw new ConfigError('This business has no signing key yet. Create one in Settings > Digital signature.');
    }
    return null;
  }
  const { SIGNING_KEY_PEM, SIGNING_CERT_PEM } = env;
  if (!SIGNING_KEY_PEM || !SIGNING_CERT_PEM) {
    if (options.require) {
      throw new ConfigError('Secured signing is required but SIGNING_KEY_PEM and SIGNING_CERT_PEM are not set.');
    }
    return null;
  }
  return { keyPem: SIGNING_KEY_PEM, certPem: SIGNING_CERT_PEM };
}
