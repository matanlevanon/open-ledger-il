import type { Env } from '../../env';

/** SHA-256 hex digest, used for the file-hash duplicate check. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** R2 key: content-addressed, so re-uploading the same bytes never creates a second object. */
export function r2KeyFor(sha256: string, filename: string): string {
  const ext = /\.[a-z0-9]+$/i.exec(filename)?.[0] ?? '';
  return `expenses/${sha256}${ext.toLowerCase()}`;
}

export async function storeFile(env: Env, key: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  // Same key means same bytes. Keep the stored copy: the files bucket refuses overwrites.
  if (await env.FILES.head(key)) return;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
}

export async function readFile(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.FILES.get(key);
}

/** R35: the text of an email body, for the reader. R39: Read again uses it on a stored body too. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
