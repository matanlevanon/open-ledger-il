import defaultLogoSvg from '../../../web/src/brand/default-logo.svg';

/**
 * The logo at the top right of every document (R17 task 6). The logo uploaded in Settings >
 * Business when there is one, passed in as a data URI, so the PDF needs no network to render
 * it. Otherwise the neutral default wordmark (web/src/brand/default-logo.svg), bundled as inline
 * markup by the wrangler "Text" rule.
 */
export function logoMarkup(uploadedDataUri?: string | null): string {
  if (uploadedDataUri) return `<img class="logo-image" src="${uploadedDataUri.replace(/"/g, '&quot;')}" alt="" />`;
  return defaultLogoSvg;
}
