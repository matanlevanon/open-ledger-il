import { describe, expect, it } from 'vitest';
import { BoiFxProvider } from '../../src/modules/fx/provider';
import { ResendMailer } from '../../src/modules/sending/mailer';
import { AnthropicReader, GeminiReader } from '../../src/modules/ai';
import { AiExtractor } from '../../src/modules/expenses/extractor';
import type { Env } from '../../src/env';

/**
 * CLAUDE.md's fixed production bug: storing the global `fetch` on an object and calling it as
 * `this.fetchImpl()` throws "Illegal invocation" on Workers, because the call loses `this` (the
 * global object) that `fetch` needs. The fix wraps it as `(input, init) => fetch(input, init)`.
 * Every provider that reaches the network defaults its fetch parameter to that wrapper, never to
 * the bare `fetch` reference; R16 task 9 re-audits the whole of `src` for the same bug (found and
 * fixed five more call sites passing bare `fetch` into `slackNotifier`) and this test locks the
 * two hand-written providers in place so the bug cannot come back unnoticed.
 */
describe('providers default their fetch parameter to a wrapper, never the bare global fetch', () => {
  it('BoiFxProvider', () => {
    const provider = new BoiFxProvider();
    const impl = (provider as unknown as { fetchImpl: typeof fetch }).fetchImpl;
    expect(typeof impl).toBe('function');
    expect(impl).not.toBe(fetch);
  });

  it('ResendMailer', () => {
    const mailer = new ResendMailer('test-api-key');
    const impl = (mailer as unknown as { fetcher: typeof fetch }).fetcher;
    expect(typeof impl).toBe('function');
    expect(impl).not.toBe(fetch);
  });

  /** The forwarded-receipt bug of 17 Oct 2026: every inbox read failed with Illegal invocation. */
  it.each([
    ['AnthropicReader', () => new AnthropicReader('test-key', 'test-model')],
    ['GeminiReader', () => new GeminiReader('test-key', 'test-model')],
    ['AiExtractor', () => new AiExtractor({} as Env)],
  ])('%s', (_name, make) => {
    const impl = (make() as unknown as { fetchFn: typeof fetch }).fetchFn;
    expect(typeof impl).toBe('function');
    expect(impl).not.toBe(fetch);
  });
});
