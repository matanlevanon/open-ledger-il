/**
 * Shrinks a phone photo before upload. A camera photo runs 3 to 8 MB and up to 4000px wide,
 * past what the expense reader accepts. The longest side is cut to MAX_SIDE and the image is
 * re-encoded as JPEG. A PDF, a small image or a file the browser cannot decode goes up as is.
 */
export const MAX_SIDE = 2000;
const QUALITY = 0.85;
const SKIP_BELOW_BYTES = 600_000;

export async function shrinkForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size < SKIP_BELOW_BYTES && file.type === 'image/jpeg') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'receipt';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Camera captures arrive as "image.jpg" on most phones. A dated name keeps R2 and the list readable. */
export function receiptName(file: File, now = new Date()): File {
  if (!/^image\.\w+$/i.test(file.name) && file.name !== '') return file;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = (file.name.match(/\.(\w+)$/)?.[1] ?? 'jpg').toLowerCase();
  return new File([file], `receipt-${stamp}.${ext}`, { type: file.type, lastModified: file.lastModified });
}
