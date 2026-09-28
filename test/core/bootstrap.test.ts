import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first } from '../../src/core/db';
import { createApp } from '../../src/index';

describe('owner bootstrap on an empty users table', () => {
  it('creates the owner from OWNER_EMAIL and logs it', async () => {
    // Storage is isolated per test file, so this file starts with no users.
    expect(await first(env.DB, `SELECT 1 FROM users WHERE role = 'owner'`)).toBeNull();
    const app = createApp({ modules: [] });
    const res = await app.request('/api/me', {}, { ...env, ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'first@example.com', OWNER_EMAIL: 'First@Example.com' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { role: string } }).user.role).toBe('owner');
    const log = await first<{ action: string }>(env.DB, `SELECT action FROM audit_log WHERE action = 'user.bootstrap_owner'`);
    expect(log?.action).toBe('user.bootstrap_owner');

    // A second email named as OWNER_EMAIL later gets nothing: the owner exists.
    const second = await app.request('/api/me', {}, { ...env, ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'second@example.com', OWNER_EMAIL: 'second@example.com' });
    expect(second.status).toBe(403);
  });
});
