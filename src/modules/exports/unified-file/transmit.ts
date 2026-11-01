import { type ItaEnv, type ItaEnvironment, ITA_UNIFIED_FILE_URLS, relayedFetch } from '../../ita/config';
import { ItaReconnectError, ItaUnavailableError } from '../../ita/errors';
import type { ClockAndFetch } from '../../ita/tokens';

/**
 * Sends the unified file to the Tax Authority (תוספת 1 למסמך הוראות להפקת קובץ במבנה אחיד,
 * version 1.0, 3.2026). Required from 1.1.2027 for registered software (notice of 16.7.2026).
 *
 *   1. POST GetUrlsForUploadingFiles with the case number and the period. The answer has two
 *      files, INI and BKM, each with a signed Google Cloud Storage address and headers.
 *   2. For each file: POST the signed address with those headers and no body. 201, and the
 *      upload address is in Location.
 *   3. PUT the file to that address, in chunks above 32 MB. 308 after each chunk but the last.
 *
 * Steps 2 and 3 go to storage.googleapis.com, not a Tax Authority host, so the broker and the
 * relay pass them straight through (relayedFetch). Step 1 and the status check carry the ITA
 * access token. Nothing here logs a body or a token.
 */

export interface UploadTokens {
  readonly environment: ItaEnvironment;
  accessToken(): Promise<string>;
  refresh(): Promise<string>;
  markReconnect(reason: string): Promise<void>;
}

export interface UploadFile {
  kind: 'ini' | 'bkm';
  fileName: string;
  fileUniqueId: string;
  bytes: number;
}

export interface UploadResult {
  uniqueId: string;
  files: UploadFile[];
}

export interface FileStatus {
  fileUniqueId: string;
  found: boolean;
  status: string;
  description: string;
  error: string | null;
}

/** A refusal or failure the person can act on. `code` is the Tax Authority's, when it sent one. */
export class TransmitError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'TransmitError';
  }
}

interface LinkFile {
  fileName?: string;
  signUrl?: string;
  fileUniqueId?: string;
  fileUniqueld?: string;
  headers?: Record<string, string>;
}

const MB = 1024 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * The chunk size for a file, from the spec's table in section 3.2. Up to 32 MB the file goes in
 * one request. The sizes are exact multiples of 256 KiB, as Google's resumable upload requires.
 */
export function chunkSize(bytes: number): number {
  if (bytes <= 32 * MB) return bytes;
  if (bytes <= 250 * MB) return 33_554_432;
  if (bytes <= 1024 * MB) return 67_108_864;
  return 134_217_728;
}

/** The largest size the Tax Authority allows for this file, from x-goog-content-length-range. */
export function maxBytes(headers: Record<string, string> | undefined): number | null {
  const range = headers?.['x-goog-content-length-range'];
  const max = range ? Number(range.split(',')[1]) : NaN;
  return Number.isFinite(max) ? max : null;
}

/**
 * A one-page PDF of under 1 KB. The sandbox takes only a PDF of up to 1 MB (section 3.1), so a
 * sandbox send uploads this in place of INI.TXT and BKMVDATA.TXT. Production sends the real files.
 */
export function sandboxPdf(label: string): Uint8Array {
  const text = `Open Ledger IL unified file sandbox test: ${label.replace(/[()\\]/g, '')}`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 12 Tf 50 780 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 12 Tf 50 780 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function errorText(json: unknown): { message: string; code: number | null } {
  const e = (json as { error?: { errorCode?: number; message?: string } } | null)?.error;
  return { message: e?.message ?? '', code: typeof e?.errorCode === 'number' ? e.errorCode : null };
}

export class UnifiedFileUploader {
  constructor(
    private readonly env: ItaEnv,
    private readonly tokens: UploadTokens,
    private readonly io: ClockAndFetch,
  ) {}

  private get ita(): typeof fetch {
    return relayedFetch(this.env, this.io.fetch);
  }

  /** A JSON POST to a Tax Authority service with the access token, refreshed once on 401. */
  private async postItaJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const send = (token: string) =>
      this.ita(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res: Response;
    try {
      res = await send(await this.tokens.accessToken());
      if (res.status === 401) {
        res = await send(await this.tokens.refresh());
        if (res.status === 401) {
          await this.tokens.markReconnect('The ITA refused the access token for the unified file service after a refresh.');
          throw new ItaReconnectError('Reconnect to ITA to continue.');
        }
      }
    } catch (err) {
      if (err instanceof ItaReconnectError || err instanceof ItaUnavailableError) throw err;
      if (err instanceof Error && err.name === 'ConfigError') throw err;
      throw new ItaUnavailableError(err instanceof Error && err.name === 'TimeoutError' ? 'The ITA did not answer in time.' : 'The ITA could not be reached.');
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** Step 1: the two upload addresses for this case number and period. */
  async links(caseNumber: string, from: string, to: string, representor?: string): Promise<{ uniqueId: string; ini: LinkFile; bkm: LinkFile }> {
    const body: Record<string, unknown> = { caseNumber: Number(caseNumber), startPeriod: from, endPeriod: to };
    if (representor) body.representorCompanyId = Number(representor);
    const { status, json } = await this.postItaJson(ITA_UNIFIED_FILE_URLS[this.tokens.environment].links, body);
    const ok = json as { success?: boolean; data?: { uniqueId?: string; uniqueld?: string; files?: LinkFile[] } } | null;
    if (status === 403 || status === 404) {
      throw new TransmitError(`The ITA refused the unified file service (HTTP ${status}). Check that the ITA app is subscribed to UniStructFileUploadLinks_Product.`, status);
    }
    if (status !== 200 || !ok?.success || !ok.data) {
      const { message, code } = errorText(json);
      if (status === 406 || code === 406) throw new TransmitError('The ITA login has no permission for this file number.', 406);
      if (status >= 500 || code === 502) throw new ItaUnavailableError(message || `The ITA answered ${status}.`);
      throw new TransmitError(message || `The ITA refused the request (HTTP ${status}).`, code ?? status);
    }
    const files = ok.data.files ?? [];
    const ini = files.find((f) => /^INI/i.test(f.fileName ?? '')) ?? files[0];
    const bkm = files.find((f) => /BKM/i.test(f.fileName ?? '')) ?? files[1];
    const uniqueId = ok.data.uniqueId ?? ok.data.uniqueld ?? '';
    if (!ini?.signUrl || !bkm?.signUrl || ini === bkm) throw new TransmitError('The ITA answer has no upload address for both files.');
    return { uniqueId, ini, bkm };
  }

  /** Steps 2 and 3 for one file. */
  async upload(link: LinkFile, data: Uint8Array): Promise<void> {
    const max = maxBytes(link.headers);
    if (max !== null && data.length > max) {
      throw new TransmitError(
        `The file is ${data.length.toLocaleString('en')} bytes and the Tax Authority allows ${max.toLocaleString('en')} for this business. Write to APISUPPORT@taxes.gov.il.`,
      );
    }
    let start: Response;
    try {
      start = await this.io.fetch(link.signUrl!, { method: 'POST', headers: link.headers ?? {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new TransmitError('The upload could not start. Try again.');
    }
    const location = start.headers.get('Location');
    if (start.status !== 201 || !location) throw new TransmitError(`The upload could not start (HTTP ${start.status}).`);

    const size = chunkSize(data.length);
    for (let offset = 0; offset < data.length || offset === 0; offset += size) {
      const end = Math.min(offset + size, data.length);
      const part = data.subarray(offset, end);
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      if (size < data.length) headers['Content-Range'] = `bytes ${offset}-${end - 1}/${data.length}`;
      let res: Response;
      try {
        res = await this.io.fetch(location, { method: 'PUT', headers, body: part, signal: AbortSignal.timeout(TIMEOUT_MS * 5) });
      } catch {
        throw new TransmitError('The upload stopped before it finished. Try again.');
      }
      const last = end >= data.length;
      if (res.status === 400) throw new TransmitError('The Tax Authority refused the file size.', 400);
      if (last ? res.status !== 200 && res.status !== 201 : res.status !== 308) throw new TransmitError(`The upload failed (HTTP ${res.status}).`);
      if (last) break;
    }
  }

  /** The whole send: links, then INI, then BKM. */
  async send(input: { caseNumber: string; from: string; to: string; ini: Uint8Array; bkm: Uint8Array }): Promise<UploadResult> {
    const { uniqueId, ini, bkm } = await this.links(input.caseNumber, input.from, input.to);
    await this.upload(ini, input.ini);
    await this.upload(bkm, input.bkm);
    const id = (f: LinkFile) => f.fileUniqueId ?? f.fileUniqueld ?? '';
    return {
      uniqueId,
      files: [
        { kind: 'ini', fileName: ini.fileName ?? '', fileUniqueId: id(ini), bytes: input.ini.length },
        { kind: 'bkm', fileName: bkm.fileName ?? '', fileUniqueId: id(bkm), bytes: input.bkm.length },
      ],
    };
  }

  /** get-file-status for one or more file ids. Each item carries its own result. */
  async status(fileUniqueIds: string[]): Promise<FileStatus[]> {
    const { status, json } = await this.postItaJson(
      ITA_UNIFIED_FILE_URLS[this.tokens.environment].status,
      fileUniqueIds.map((fileName) => ({ fileName })),
    );
    if (status === 403 || status === 404) throw new TransmitError(`The ITA refused the status service (HTTP ${status}). Check that the ITA app is subscribed to FilesStatus_Product.`, status);
    if (status >= 500) throw new ItaUnavailableError(`The ITA answered ${status}.`);
    // The spec shows a list for several files and a single object for one. Some answers wrap it in data.
    const body = (json as { data?: unknown } | null)?.data ?? json;
    const items = Array.isArray(body) ? body : body && typeof body === 'object' && 'fileName' in body ? [body] : null;
    if (status !== 200 || !items) {
      const { message } = errorText(json);
      throw new TransmitError(message || `The ITA refused the status request (HTTP ${status}).`, status);
    }
    return (items as Array<Record<string, unknown>>).map((r) => ({
      fileUniqueId: String(r.fileName ?? ''),
      found: r.isFound === true,
      status: String(r.status ?? ''),
      description: String(r.description ?? ''),
      error: r.errorCode == null ? null : String(r.errorMessage ?? r.errorCode),
    }));
  }
}
