import type { Env } from '../../env';
import { escapeDriveQueryLiteral, serviceAccountAccessToken } from '../expenses/drive';

/**
 * Off-site copy of the quarterly backup (R16 task 12): the same export and manifest R2 already
 * holds, also uploaded to Google Drive under "<root>/Backups/YYYY-Qn", the same root
 * folder the expenses module ingests from (`expenses.drive_root_folder_id`, set by the owner in
 * Settings). Read-write, unlike `expenses/drive.ts`'s `drive.readonly` scope: this creates the
 * Backups and quarter subfolders on first use.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const API_ROOT = 'https://www.googleapis.com/drive/v3';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** "2026-10-05..." -> "2026-Q4". Pure, so it is testable without the network. */
export function quarterLabel(dateIso: string): string {
  const year = dateIso.slice(0, 4);
  const month = Number(dateIso.slice(5, 7));
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

export interface DriveBackupUploader {
  /** Uploads one file under `rootFolderId`/`path[0]`/`path[1]`/.../`filename`, creating folders as needed. */
  upload(rootFolderId: string, path: string[], filename: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export class GoogleDriveBackupUploader implements DriveBackupUploader {
  constructor(private readonly env: Env) {}

  private async token(): Promise<string> {
    const json = this.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set.');
    return serviceAccountAccessToken(json, DRIVE_SCOPE);
  }

  private async findOrCreateFolder(token: string, parentId: string, name: string): Promise<string> {
    const q = encodeURIComponent(
      `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${escapeDriveQueryLiteral(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    const found = await fetch(`${API_ROOT}/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
    if (!found.ok) throw new Error(`Google Drive folder lookup failed: ${found.status} ${await found.text()}`);
    const existing = (await found.json()) as { files: { id: string }[] };
    if (existing.files[0]) return existing.files[0].id;

    const created = await fetch(`${API_ROOT}/files?fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!created.ok) throw new Error(`Google Drive folder create failed: ${created.status} ${await created.text()}`);
    return ((await created.json()) as { id: string }).id;
  }

  async upload(rootFolderId: string, path: string[], filename: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const token = await this.token();
    let parent = rootFolderId;
    for (const segment of path) parent = await this.findOrCreateFolder(token, parent, segment);

    const boundary = `openledger-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: filename, parents: [parent] });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Uint8Array(new TextEncoder().encode(head).length + bytes.length + new TextEncoder().encode(tail).length);
    body.set(new TextEncoder().encode(head), 0);
    body.set(bytes, new TextEncoder().encode(head).length);
    body.set(new TextEncoder().encode(tail), new TextEncoder().encode(head).length + bytes.length);

    const res = await fetch(`${UPLOAD_ROOT}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Google Drive upload failed: ${res.status} ${await res.text()}`);
  }
}
