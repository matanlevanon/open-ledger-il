/**
 * The uploaded logo and signature images (Settings > Business and Settings > Signature), read
 * from R2 and embedded as data URIs, the same pattern `fonts.ts` uses for the embedded fonts:
 * Browser Rendering then needs no network to lay out the page (R16 task 8). Nothing is bundled.
 * A document without an uploaded signature prints no signature image.
 */

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!);
  return btoa(binary);
}

/** Only raster and SVG images reach a document. Anything else reads as no image. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** data:<type>;base64,... for an R2 object, or null when the key is empty, missing or not an image. */
export async function imageDataUri(files: R2Bucket | null | undefined, key: string | null | undefined): Promise<string | null> {
  if (!files || !key) return null;
  const object = await files.get(key);
  if (!object) return null;
  const type = object.httpMetadata?.contentType ?? '';
  if (!IMAGE_TYPES.includes(type)) return null;
  return `data:${type};base64,${toBase64(await object.arrayBuffer())}`;
}
