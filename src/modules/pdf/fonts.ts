import hankenGroteskBold from './assets/fonts/HankenGrotesk-Bold.woff2';
import hankenGroteskRegular from './assets/fonts/HankenGrotesk-Regular.woff2';
import notoSansHebrewBold from './assets/fonts/NotoSansHebrew-Bold.woff2';
import notoSansHebrewRegular from './assets/fonts/NotoSansHebrew-Regular.woff2';

/**
 * Hanken Grotesk (Latin, matching the web app's own body font) and Noto Sans Hebrew, both OFL
 * licensed (see assets/fonts/OFL.txt), bundled as raw bytes by the wrangler "Data" rule and
 * embedded as base64 data URIs (R17 task 6). Cloudflare Browser Rendering then needs no network
 * to lay out the page, and Hebrew never falls back to a system font the render server may not
 * have installed (R17 task 1's reasoning for dropping Heebo from the web app applies in reverse
 * here: a server has no guaranteed Hebrew font, so the PDF embeds its own).
 */

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);
  return btoa(binary);
}

function fontFace(family: string, weight: number, data: ArrayBuffer): string {
  return `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${toBase64(data)}) format('woff2'); }`;
}

let cached: string | null = null;

/** The full set of @font-face rules, built once per isolate and cached. */
export function fontFaceCss(): string {
  if (cached) return cached;
  cached = [
    fontFace('Hanken Grotesk', 400, hankenGroteskRegular),
    fontFace('Hanken Grotesk', 700, hankenGroteskBold),
    fontFace('Noto Sans Hebrew', 400, notoSansHebrewRegular),
    fontFace('Noto Sans Hebrew', 700, notoSansHebrewBold),
  ].join('\n');
  return cached;
}

export const FONT_STACK = "'Hanken Grotesk', 'Noto Sans Hebrew', sans-serif";
