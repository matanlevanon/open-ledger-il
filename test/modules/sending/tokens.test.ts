import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { signSendToken, verifySendToken } from '../../../src/modules/sending/tokens';

describe('sending consent and share tokens', () => {
  it('signs and verifies a payload round trip', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'consent', clientId: 42, exp });
    const payload = await verifySendToken(env, token);
    expect(payload).toEqual({ kind: 'consent', clientId: 42, exp });
  });

  it('rejects a tampered token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken(env, { kind: 'share', documentId: 7, variant: 'client', exp });
    const [body, signature] = token.split('.');
    const tamperedBody = `${body!.slice(0, -1)}${body!.endsWith('a') ? 'b' : 'a'}`;
    await expect(verifySendToken(env, `${tamperedBody}.${signature}`)).rejects.toThrow(/not valid/);
  });

  it('rejects a token signed with a different key', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSendToken({ SEND_LINK_KEY: 'a-different-key' }, { kind: 'consent', clientId: 1, exp });
    await expect(verifySendToken(env, token)).rejects.toThrow(/not valid/);
  });

  it('rejects an expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const token = await signSendToken(env, { kind: 'consent', clientId: 1, exp });
    await expect(verifySendToken(env, token)).rejects.toThrow(/expired/);
  });

  it('rejects a malformed token', async () => {
    await expect(verifySendToken(env, 'not-a-token')).rejects.toThrow(/not valid/);
  });
});
