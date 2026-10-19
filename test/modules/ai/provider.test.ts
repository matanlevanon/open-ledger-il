import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/env';
import { SYSTEM_ACTOR } from '../../../src/core/audit';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  chooseProvider,
  documentReaderFor,
  geminiThinkingConfig,
  readerStatus,
} from '../../../src/modules/ai';
import { AiExtractor } from '../../../src/modules/expenses/extractor';
import { AiExternalDocExtractor } from '../../../src/modules/import/upload-extractor';
import { uploadExternalDocument } from '../../../src/modules/import/upload-service';
import { EMPTY_EXTRACTION } from '../../../src/modules/import/upload-types';

const base = env as unknown as Env;
const withKeys = (over: Partial<Env>): Env => ({ ...base, AI_PROVIDER: '', ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: undefined, ...over });

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/** A fetch that records the request and answers with `reply`. No test calls the internet. */
function fakeFetch(reply: unknown, status = 200) {
  const sent: Sent[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, sent };
}

const pdf = () => new TextEncoder().encode('%PDF-1.4 test').buffer as ArrayBuffer;
const expense = { supplierName: 'Cloudflare', currency: 'USD', amount: '20.00', vatAmount: null, date: '2026-10-01' };
const geminiReply = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

describe('provider choice rules', () => {
  it('AI_PROVIDER wins when set', () => {
    expect(chooseProvider({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('gemini');
    expect(chooseProvider({ AI_PROVIDER: 'Anthropic', GEMINI_API_KEY: 'AIza' })).toBe('anthropic');
  });

  it('empty AI_PROVIDER takes whichever key is set, Anthropic first', () => {
    expect(chooseProvider({ ANTHROPIC_API_KEY: 'sk-ant-x', GEMINI_API_KEY: 'AIza' })).toBe('anthropic');
    expect(chooseProvider({ AI_PROVIDER: '', GEMINI_API_KEY: 'AIza' })).toBe('gemini');
  });

  it('no key means no provider and no reader', () => {
    expect(chooseProvider({})).toBeNull();
    expect(documentReaderFor(withKeys({}))).toBeNull();
    expect(readerStatus(withKeys({}))).toEqual({ provider: null, keySet: false });
  });

  it('a chosen provider without its key reads nothing, and Settings says the key is missing', () => {
    const e = withKeys({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(documentReaderFor(e)).toBeNull();
    expect(readerStatus(e)).toEqual({ provider: 'gemini', keySet: false });
  });

  it('readerStatus never carries the key', () => {
    expect(JSON.stringify(readerStatus(withKeys({ GEMINI_API_KEY: 'AIzaSECRET' })))).not.toContain('AIzaSECRET');
  });
});

describe('request shapes', () => {
  it('Anthropic: messages API, tool call forced, default model', async () => {
    const { fn, sent } = fakeFetch({ content: [{ type: 'tool_use', name: 'record_expense', input: expense }] });
    const got = await new AiExtractor(withKeys({ ANTHROPIC_API_KEY: 'sk-ant-x' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(got.supplierName).toBe('Cloudflare');
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]!.headers['x-api-key']).toBe('sk-ant-x');
    expect(sent[0]!.body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(sent[0]!.body.tool_choice).toEqual({ type: 'tool', name: 'record_expense' });
    expect(sent[0]!.body.messages[0].content[0].type).toBe('document');
  });

  it('Gemini: generateContent, file as inline data, JSON answer held to the schema', async () => {
    const { fn, sent } = fakeFetch(geminiReply(expense));
    const got = await new AiExtractor(withKeys({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIzaX' }), fn).extract({ bytes: pdf(), contentType: 'image/png', filename: 'a.png' });
    expect(got.amount).toBe('20.00');
    expect(sent[0]!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(sent[0]!.headers['x-goog-api-key']).toBe('AIzaX');
    expect(sent[0]!.body.contents[0].parts[0].inlineData.mimeType).toBe('image/png');
    expect(sent[0]!.body.generationConfig.responseMimeType).toBe('application/json');
    expect(sent[0]!.body.generationConfig.responseJsonSchema.required).toContain('supplierName');
  });

  it('model names come from the Worker variables when set', async () => {
    const { fn, sent } = fakeFetch(geminiReply(expense));
    await new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX', GEMINI_MODEL: 'gemini-next' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(sent[0]!.url).toContain('/models/gemini-next:generateContent');
  });
});

describe('Anthropic workspaces, Gemini thinking, slow providers', () => {
  it('sends anthropic-workspace-id when ANTHROPIC_WORKSPACE_ID is set, and not otherwise', async () => {
    const reply = { content: [{ type: 'tool_use', name: 'record_expense', input: expense }] };
    const a = fakeFetch(reply);
    await new AiExtractor(withKeys({ ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_WORKSPACE_ID: 'wrkspc_01Test' }), a.fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(a.sent[0]!.headers['anthropic-workspace-id']).toBe('wrkspc_01Test');
    const b = fakeFetch(reply);
    await new AiExtractor(withKeys({ ANTHROPIC_API_KEY: 'sk-ant-x' }), b.fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(b.sent[0]!.headers['anthropic-workspace-id']).toBeUndefined();
  });

  it('a key that needs a workspace gets a note that says what to do', async () => {
    const { fn } = fakeFetch(
      { type: 'error', error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.' } },
      400,
    );
    await expect(
      new AiExtractor(withKeys({ ANTHROPIC_API_KEY: 'sk-ant-x' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' }),
    ).rejects.toThrow(/ANTHROPIC_WORKSPACE_ID/);
  });

  it('Gemini 3 and later read with a low thinking level, older models keep their defaults', async () => {
    expect(geminiThinkingConfig('gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
    expect(geminiThinkingConfig('gemini-2.5-flash')).toBeNull();
    const { fn, sent } = fakeFetch(geminiReply(expense));
    await new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(sent[0]!.body.generationConfig.thinkingConfig).toEqual(geminiThinkingConfig(DEFAULT_GEMINI_MODEL));
  });

  it('a model that refuses the thinking setting is asked again without it', async () => {
    const sent: Record<string, any>[] = [];
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      if (body.generationConfig.thinkingConfig) {
        return new Response(JSON.stringify({ error: { message: 'Thinking level is not supported for this model.' } }), { status: 400 });
      }
      return new Response(JSON.stringify(geminiReply(expense)), { status: 200 });
    }) as typeof fetch;
    const got = await new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX', GEMINI_MODEL: 'gemini-3-flash' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(got.supplierName).toBe('Cloudflare');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('a busy provider is tried once more, and a timeout becomes a clear note', async () => {
    let calls = 0;
    const busyThenOk = (async () => {
      calls += 1;
      return calls === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify(geminiReply(expense)), { status: 200 });
    }) as typeof fetch;
    const got = await new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX' }), busyThenOk).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(got.amount).toBe('20.00');
    expect(calls).toBe(2);

    const timesOut = (async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }) as typeof fetch;
    await expect(
      new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX' }), timesOut).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' }),
    ).rejects.toThrow(/did not answer within/);
  });
});

describe('manual entry', () => {
  it('no key: an uploaded document gets empty fields to type by hand', async () => {
    const { fn, sent } = fakeFetch({});
    const got = await new AiExternalDocExtractor(withKeys({}), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' });
    expect(got).toEqual(EMPTY_EXTRACTION);
    expect(sent).toHaveLength(0);
  });

  it('a malformed answer becomes empty fields and a note, never a crash', async () => {
    const { fn } = fakeFetch(geminiReply({ source: 'nonsense', total: 12 }));
    const e = withKeys({ GEMINI_API_KEY: 'AIzaX' });
    const result = await uploadExternalDocument(e.DB, e.FILES, new AiExternalDocExtractor(e, fn), SYSTEM_ACTOR, {
      bytes: new TextEncoder().encode(`%PDF-1.4 malformed ${Date.now()}`).buffer as ArrayBuffer,
      contentType: 'application/pdf',
      filename: 'bad.pdf',
    });
    expect(result.extraction).toEqual(EMPTY_EXTRACTION);
    expect(result.extractionError).toMatch(/gemini answer does not fit/);
  });

  it('a Gemini answer that is not JSON is refused with a clear message', async () => {
    const { fn } = fakeFetch({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
    await expect(
      new AiExtractor(withKeys({ GEMINI_API_KEY: 'AIzaX' }), fn).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' }),
    ).rejects.toThrow(/not JSON/);
  });

  it('no key: an expense file waits for manual entry, as before', async () => {
    await expect(new AiExtractor(withKeys({})).extract({ bytes: pdf(), contentType: 'application/pdf', filename: 'a.pdf' })).rejects.toThrow(
      /No document reading key/,
    );
  });
});
