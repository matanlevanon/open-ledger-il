import type { Env } from '../../env';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/** Ingest source. The Anthropic and email inboxes stay out of scope; Drive and direct upload only. */
export interface DriveSource {
  /** Files directly inside the given folder id, newest first. */
  listFiles(folderId: string): Promise<DriveFile[]>;
  downloadFile(fileId: string): Promise<ArrayBuffer>;
  /** The subfolder id for "<root>/YYYY-MM" under the configured root, or null if absent. */
  findMonthFolder(rootFolderId: string, yearMonth: string): Promise<string | null>;
  /** The id of the Google Sheet with the given title directly in the root folder, or null. */
  findIndexSheet(rootFolderId: string, yearMonth: string, title: string): Promise<string | null>;
  /** Every cell of the sheet's first tab as displayed, row by row. */
  readSheet(spreadsheetId: string): Promise<string[][]>;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Default title pattern of the monthly index sheet. `YYYY-MM` is replaced by the month. A setting overrides it. */
export const DEFAULT_INDEX_TITLE_PATTERN = 'Expense index YYYY-MM';

/** Title of the monthly index sheet in the root folder, from the saved pattern. */
export function indexSheetTitle(yearMonth: string, pattern: string = DEFAULT_INDEX_TITLE_PATTERN): string {
  const month = monthFolderName(yearMonth);
  return pattern.includes('YYYY-MM') ? pattern.replace('YYYY-MM', month) : `${pattern} ${month}`;
}

/** "<root>/2026-11" -> "2026-11". Pure so it can be tested without the network. */
export function monthFolderName(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new RangeError(`Expected YYYY-MM, got "${yearMonth}"`);
  return yearMonth;
}

/** Escapes a string literal embedded in a Drive API `q` query (single quote and backslash, per the Drive query syntax). */
export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Drive to list and download, Sheets to read the monthly index. Both read only. */
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://www.googleapis.com/drive/v3';
const SHEETS_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets';
/** Lets a list see a folder that sits in a shared drive, not only in My Drive. */
const SHARED_DRIVES = '&supportsAllDrives=true&includeItemsFromAllDrives=true';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function base64url(bytes: ArrayBuffer | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Signs a Google service-account JWT and exchanges it for an access token. */
export async function serviceAccountAccessToken(json: string, scope = GOOGLE_SCOPES): Promise<string> {
  const key = JSON.parse(json) as ServiceAccountKey;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const cryptoKey = await importPrivateKey(key.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Reads the configured root folder and its `YYYY-MM` subfolders with a service-account token (docs/secrets.md GOOGLE_SERVICE_ACCOUNT_JSON). */
export class GoogleDriveSource implements DriveSource {
  /** One token per import run, not one per call. Google tokens last an hour. */
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(private readonly env: Env) {}

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    const json = this.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set.');
    const token = await serviceAccountAccessToken(json);
    this.cached = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
    return token;
  }

  /**
   * One Google API call. Google answers 500, 502, 503 and 429 now and then for no reason on the
   * caller's side and asks clients to retry with backoff, so a call gets three tries.
   */
  private async api<T>(path: string, root = API_ROOT): Promise<T> {
    const token = await this.token();
    const url = `${root}${path}`;
    for (let attempt = 1; ; attempt += 1) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res.json() as Promise<T>;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 3) throw new Error(`Google API error: ${res.status} ${await res.text()}`);
      await res.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  async findIndexSheet(rootFolderId: string, _yearMonth: string, title: string): Promise<string | null> {
    const q = encodeURIComponent(
      `'${escapeDriveQueryLiteral(rootFolderId)}' in parents and name = '${escapeDriveQueryLiteral(title)}' and mimeType = '${SHEET_MIME}' and trashed = false`,
    );
    // Newest first, sorted here: Drive has answered 500 to this query with orderBy set.
    const body = await this.api<{ files: { id: string; modifiedTime: string }[] }>(`/files?q=${q}&fields=files(id,modifiedTime)${SHARED_DRIVES}`);
    return [...body.files].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0]?.id ?? null;
  }

  async readSheet(spreadsheetId: string): Promise<string[][]> {
    // A range without a tab name reads the first tab. FORMATTED_VALUE returns every cell as the
    // text the owner sees, so amounts stay decimal strings and never pass through a float.
    const body = await this.api<{ values?: unknown[][] }>(
      `/${encodeURIComponent(spreadsheetId)}/values/A1:Z1000?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
      SHEETS_ROOT,
    );
    return (body.values ?? []).map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
  }

  async findMonthFolder(rootFolderId: string, yearMonth: string): Promise<string | null> {
    const name = monthFolderName(yearMonth);
    const q = encodeURIComponent(
      `'${escapeDriveQueryLiteral(rootFolderId)}' in parents and name = '${escapeDriveQueryLiteral(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    );
    const body = await this.api<{ files: { id: string }[] }>(`/files?q=${q}&fields=files(id)${SHARED_DRIVES}`);
    return body.files[0]?.id ?? null;
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    const q = encodeURIComponent(`'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`);
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const body = await this.api<{ files: DriveFile[]; nextPageToken?: string }>(
        `/files?q=${q}&orderBy=modifiedTime desc&pageSize=200&fields=nextPageToken,files(id,name,mimeType,modifiedTime)${SHARED_DRIVES}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      );
      files.push(...body.files);
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return files;
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const token = await this.token();
    const res = await fetch(`${API_ROOT}/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Drive download failed: ${res.status} ${await res.text()}`);
    return res.arrayBuffer();
  }
}
