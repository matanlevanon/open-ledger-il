/**
 * Path prefixes under /api that `authenticate()` (src/index.ts) never gates: the consent-accept
 * page and the WhatsApp PDF share link are opened by the client, who has no Cloudflare Access
 * session. Authorization for these lives in the signed token itself (tokens.ts), checked inside
 * each route. A future run adding its own public, client-facing link extends this array.
 */
export const PUBLIC_API_PREFIXES = ['/sending/public/'] as const;

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(`/api${p}`));
}
