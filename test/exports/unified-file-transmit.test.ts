import { describe, expect, it } from 'vitest';
import type { ItaEnv } from '../../src/modules/ita/config';
import { ItaReconnectError } from '../../src/modules/ita/errors';
import { TransmitError, UnifiedFileUploader, chunkSize, maxBytes, sandboxPdf } from '../../src/modules/exports/unified-file/transmit';

/** R47: unified file transmission (תוספת 1, 3.2026). A fake Tax Authority and a fake storage. */

const LINKS = 'https://ita-api.taxes.gov.il/shaam/tsandbox/UniStructFileUploadLinksApi/v1/UploadingFile/GetUrlsForUploadingFiles';
const STATUS = 'https://ita-api.taxes.gov.il/shaam/tsandbox/FilesStatusApi/v1/Files/get-file-status';
const env = { ITA_ENV: 'sandbox' } as ItaEnv;

function tokens(opts: { refused?: boolean } = {}) {
  const calls = { refresh: 0, reconnect: [] as string[] };
  return {
    calls,
    store: {
      environment: 'sandbox' as const,
      accessToken: async () => (opts.refused ? 'stale' : 'good'),
      refresh: async () => {
        calls.refresh += 1;
        return opts.refused ? 'still-bad' : 'good';
      },
      markReconnect: async (reason: string) => {
        calls.reconnect.push(reason);
      },
    },
  };
}

function fakeIta(answer: { linksStatus?: number; linksBody?: unknown; statusBody?: unknown } = {}) {
  const seen: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const method = init?.method ?? 'GET';
    seen.push({ method, url, headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    if (url === LINKS) {
      if (headers.authorization !== 'Bearer good') return new Response('{}', { status: 401 });
      return Response.json(
        answer.linksBody ?? {
          success: true,
          data: {
            uniqueId: 'U1',
            files: [
              { fileName: 'INI_N20270105.txt', signUrl: 'https://storage.googleapis.com/ini?sig', fileUniqueId: 'ini-1.txt', headers: { 'x-goog-content-length-range': '0,1048576', 'x-goog-resumable': 'start' } },
              { fileName: 'FROMBKM_W2027_BKMVDATA.txt', signUrl: 'https://storage.googleapis.com/bkm?sig', fileUniqueId: 'bkm-1.txt', headers: { 'x-goog-content-length-range': '0,53609120', 'x-goog-resumable': 'start' } },
            ],
          },
          error: null,
        },
        { status: answer.linksStatus ?? 200 },
      );
    }
    if (url === STATUS) {
      return Response.json(
        answer.statusBody ?? [
          { fileName: 'ini-1.txt', status: 'Approved', description: '', isFound: true, errorCode: null, errorMessage: null },
          { fileName: 'bkm-1.txt', status: 'Rejected', description: 'Bad record count', isFound: true, errorCode: null, errorMessage: null },
        ],
      );
    }
    if (url.startsWith('https://storage.googleapis.com/') && method === 'POST') {
      return new Response(null, { status: 201, headers: { Location: `${url.split('?')[0]}/session` } });
    }
    if (url.endsWith('/session') && method === 'PUT') return new Response(null, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const now = () => new Date('2027-01-05T10:00:00Z');

describe('unified file transmission', () => {
  it('asks for links with the case number and period, then uploads INI and BKM', async () => {
    const ita = fakeIta();
    const t = tokens();
    const uploader = new UnifiedFileUploader(env, t.store, { fetch: ita.fetch, now });
    const ini = new TextEncoder().encode('A000 ini');
    const bkm = new TextEncoder().encode('C100 bkm');
    const result = await uploader.send({ caseNumber: '777777715', from: '2026-01-01', to: '2026-12-31', ini, bkm });

    expect(result).toEqual({
      uniqueId: 'U1',
      files: [
        { kind: 'ini', fileName: 'INI_N20270105.txt', fileUniqueId: 'ini-1.txt', bytes: ini.length },
        { kind: 'bkm', fileName: 'FROMBKM_W2027_BKMVDATA.txt', fileUniqueId: 'bkm-1.txt', bytes: bkm.length },
      ],
    });
    const links = ita.seen.find((s) => s.url === LINKS)!;
    expect(links.body).toEqual({ caseNumber: 777777715, startPeriod: '2026-01-01', endPeriod: '2026-12-31' });
    const starts = ita.seen.filter((s) => s.method === 'POST' && s.url.startsWith('https://storage.googleapis.com/'));
    expect(starts.map((s) => s.headers['x-goog-resumable'])).toEqual(['start', 'start']);
    const puts = ita.seen.filter((s) => s.method === 'PUT');
    expect(puts.map((s) => s.url)).toEqual(['https://storage.googleapis.com/ini/session', 'https://storage.googleapis.com/bkm/session']);
    // Neither upload call carries the Tax Authority token.
    expect([...starts, ...puts].every((s) => !s.headers.authorization)).toBe(true);
  });

  it('refreshes once on 401 and asks for a new login when refused again', async () => {
    const ita = fakeIta();
    const t = tokens({ refused: true });
    const uploader = new UnifiedFileUploader(env, t.store, { fetch: ita.fetch, now });
    await expect(uploader.links('777777715', '2026-01-01', '2026-12-31')).rejects.toBeInstanceOf(ItaReconnectError);
    expect(t.calls.refresh).toBe(1);
    expect(t.calls.reconnect).toHaveLength(1);
  });

  it('passes on the Tax Authority refusal, for example a case with no unified file requirement', async () => {
    const ita = fakeIta({
      linksStatus: 400,
      linksBody: { success: false, data: null, error: { errorCode: 400, message: 'There is no requirement for a uniform structure file for this case number' } },
    });
    const uploader = new UnifiedFileUploader(env, tokens().store, { fetch: ita.fetch, now });
    const err = await uploader.links('777777715', '2022-01-04', '2022-12-31').catch((e) => e);
    expect(err).toBeInstanceOf(TransmitError);
    expect(err.message).toContain('no requirement');
  });

  it('refuses a file above the size the Tax Authority allows, before uploading', async () => {
    const ita = fakeIta();
    const uploader = new UnifiedFileUploader(env, tokens().store, { fetch: ita.fetch, now });
    const link = { signUrl: 'https://storage.googleapis.com/ini?sig', headers: { 'x-goog-content-length-range': '0,4' } };
    await expect(uploader.upload(link, new Uint8Array(10))).rejects.toThrow(/allows 4/);
    expect(ita.seen).toHaveLength(0);
  });

  it('reads the status of both files', async () => {
    const ita = fakeIta();
    const uploader = new UnifiedFileUploader(env, tokens().store, { fetch: ita.fetch, now });
    const items = await uploader.status(['ini-1.txt', 'bkm-1.txt']);
    expect(items.map((i) => [i.fileUniqueId, i.status, i.description])).toEqual([
      ['ini-1.txt', 'Approved', ''],
      ['bkm-1.txt', 'Rejected', 'Bad record count'],
    ]);
    expect(ita.seen.find((s) => s.url === STATUS)!.body).toEqual([{ fileName: 'ini-1.txt' }, { fileName: 'bkm-1.txt' }]);
  });
});

describe('upload helpers', () => {
  it('sends up to 32 MB in one part, larger files in the chunk sizes of section 3.2', () => {
    expect(chunkSize(1000)).toBe(1000);
    expect(chunkSize(32 * 1024 * 1024)).toBe(32 * 1024 * 1024);
    expect(chunkSize(100 * 1024 * 1024)).toBe(33_554_432);
    expect(chunkSize(500 * 1024 * 1024)).toBe(67_108_864);
    expect(chunkSize(2048 * 1024 * 1024)).toBe(134_217_728);
  });

  it('reads the size limit header', () => {
    expect(maxBytes({ 'x-goog-content-length-range': '0,1048576' })).toBe(1048576);
    expect(maxBytes({})).toBeNull();
  });

  it('builds a small PDF for the sandbox', () => {
    const pdf = new TextDecoder().decode(sandboxPdf('INI 2026-01-01 2026-12-31'));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.length).toBeLessThan(1024 * 1024);
  });
});
