import type { Env } from '../../env';

/**
 * R24 Phase 0: one way to read a document with a language model, from Anthropic or Gemini.
 * The expense reader, the import reader and the business document reader all call this, and
 * each keeps its own zod check of the answer.
 */
export const AI_PROVIDERS = ['anthropic', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const ANTHROPIC_VERSION = '2023-06-01';

export interface ReadDocumentRequest {
  bytes: ArrayBuffer;
  contentType: string;
  /** What to read. Sent as text next to the file. */
  prompt: string;
  /** Names the answer: the Anthropic tool name. */
  name: string;
  description: string;
  /** JSON Schema of the answer object. */
  schema: object;
}

/** Sends one file and a prompt, returns the answer object. The caller validates it. */
export interface DocumentReader {
  readonly provider: AiProvider;
  read(req: ReadDocumentRequest): Promise<unknown>;
}

type FetchFn = typeof fetch;

/**
 * Which provider reads documents. AI_PROVIDER wins when set. Empty: the provider whose key is
 * set, Anthropic first. Null: nothing is chosen, so documents are typed by hand.
 */
export function chooseProvider(env: Pick<Env, 'AI_PROVIDER' | 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY'>): AiProvider | null {
  const picked = env.AI_PROVIDER?.trim().toLowerCase();
  if (picked === 'anthropic' || picked === 'gemini') return picked;
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

/** What Settings shows: the provider and whether its key is set. Never the key. */
export function readerStatus(env: Env): { provider: AiProvider | null; keySet: boolean } {
  const provider = chooseProvider(env);
  return { provider, keySet: provider !== null && Boolean(keyFor(env, provider)) };
}

function keyFor(env: Env, provider: AiProvider): string | undefined {
  return provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
}

/** The reader for this Worker, or null when no provider has a key (manual entry). */
export function documentReaderFor(env: Env, fetchFn: FetchFn = (input, init) => fetch(input, init)): DocumentReader | null {
  const provider = chooseProvider(env);
  if (!provider) return null;
  const apiKey = keyFor(env, provider);
  if (!apiKey) return null;
  return provider === 'anthropic'
    ? new AnthropicReader(apiKey, env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL, fetchFn)
    : new GeminiReader(apiKey, env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, fetchFn);
}

/** Claude with vision, forced to answer through one tool call so the output matches the schema. */
export class AnthropicReader implements DocumentReader {
  readonly provider = 'anthropic' as const;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  async read(req: ReadDocumentRequest): Promise<unknown> {
    const data = arrayBufferToBase64(req.bytes);
    // R35: an email without an attachment is read from its text.
    const documentBlock =
      req.contentType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : req.contentType === 'text/plain'
          ? { type: 'document', source: { type: 'text', media_type: 'text/plain', data: new TextDecoder().decode(req.bytes) } }
          : { type: 'image', source: { type: 'base64', media_type: req.contentType, data } };

    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        tools: [{ name: req.name, description: req.description, input_schema: req.schema }],
        tool_choice: { type: 'tool', name: req.name },
        messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: req.prompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic extraction failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const toolUse = body.content?.find((block) => block.type === 'tool_use' && block.name === req.name);
    if (!toolUse) throw new Error(`Anthropic did not return the ${req.name} tool call.`);
    return toolUse.input;
  }
}

/** Gemini generateContent with the file as inline data and a JSON answer held to the schema. */
export class GeminiReader implements DocumentReader {
  readonly provider = 'gemini' as const;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  async read(req: ReadDocumentRequest): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: req.contentType, data: arrayBufferToBase64(req.bytes) } },
              { text: `${req.prompt}\n\n${req.description} Answer with one JSON object only.` },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: req.schema },
      }),
    });
    if (!res.ok) throw new Error(`Gemini extraction failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new Error('Gemini returned no answer.');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('Gemini returned an answer that is not JSON.');
    }
  }
}

export function arrayBufferToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
