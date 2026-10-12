import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import pkgRaw from '../../../package.json?raw';
import { createApp } from '../../../src/index';
import { createUpdatesModule } from '../../../src/modules/updates';
import { NOTIFIED_KEY, checkForUpdate, compareVersions, parseVersion, updatesScheduled } from '../../../src/modules/updates/service';
import { APP_VERSION } from '../../../src/version';

function github(status: number, body?: unknown): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetcher, calls };
}

const release = (tag: string) => ({ tag_name: tag, html_url: `https://github.com/acme/ledger/releases/tag/${tag}`, name: tag, published_at: '2026-11-01T00:00:00Z' });
const withRepo = { ...env, UPDATE_REPO: 'acme/ledger' };

describe('update check: versions', () => {
  it('APP_VERSION comes from package.json', () => {
    expect(APP_VERSION).toBe((JSON.parse(pkgRaw) as { version: string }).version);
  });

  it('parses v-prefixed and plain tags, refuses pre-releases', () => {
    expect(parseVersion('v1.4.0')).toEqual([1, 4, 0]);
    expect(parseVersion('1.10.2')).toEqual([1, 10, 2]);
    expect(parseVersion('1.4.0-beta')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0);
    expect(compareVersions('1.2.9', '1.3.0')).toBeLessThan(0);
  });
});

describe('update check: GitHub answers', () => {
  it('is off without UPDATE_REPO and calls nobody', async () => {
    const gh = github(200, release('v9.0.0'));
    const r = await checkForUpdate({ ...env, UPDATE_REPO: '' }, gh.fetcher, '1.3.0');
    expect(r.status).toBe('off');
    expect(gh.calls).toEqual([]);
  });

  it('reports a newer release with its link', async () => {
    const gh = github(200, release('v1.4.0'));
    const r = await checkForUpdate(withRepo, gh.fetcher, '1.3.0');
    expect(gh.calls).toEqual(['https://api.github.com/repos/acme/ledger/releases/latest']);
    expect(r).toMatchObject({ status: 'update_available', latest: '1.4.0', current: '1.3.0' });
    expect(r.releaseUrl).toContain('/releases/tag/v1.4.0');
  });

  it('says up to date for the same or an older release', async () => {
    expect((await checkForUpdate(withRepo, github(200, release('v1.3.0')).fetcher, '1.3.0')).status).toBe('up_to_date');
    expect((await checkForUpdate(withRepo, github(200, release('v1.2.0')).fetcher, '1.3.0')).status).toBe('up_to_date');
  });

  it('turns 404 into no releases and other failures into an error, never a throw', async () => {
    expect((await checkForUpdate(withRepo, github(404).fetcher, '1.3.0')).status).toBe('no_releases');
    expect((await checkForUpdate(withRepo, github(503).fetcher, '1.3.0')).status).toBe('error');
    const broken = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect((await checkForUpdate(withRepo, broken, '1.3.0')).status).toBe('error');
  });
});

describe('update check: routes and monthly cron', () => {
  it('Check for updates saves the result, and GET returns it', async () => {
    const app = createApp({ modules: [createUpdatesModule(github(200, release('v99.0.0')).fetcher)] });
    const e = { ...withRepo, DEV_AUTH_EMAIL: 'owner@example.com' };
    const post = await app.request('/api/updates/check', { method: 'POST' }, e);
    expect(post.status).toBe(200);
    const get = await app.request('/api/updates', {}, e);
    const body = (await get.json()) as { current: string; last: { status: string; latest: string } };
    expect(body.current).toBe(APP_VERSION);
    expect(body.last).toMatchObject({ status: 'update_available', latest: '99.0.0' });
  });

  it('runs only on the 1st and posts to Slack once per version', async () => {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(NOTIFIED_KEY).run();
    const sent: string[] = [];
    const notifier = { send: async (text: string) => (sent.push(text), true) };
    const controller = { cron: '0 7 * * *', scheduledTime: Date.now(), noRetry() {} } as ScheduledController;
    const gh = github(200, release('v98.0.0'));

    await updatesScheduled(controller, withRepo, { fetcher: gh.fetcher, notifier, today: '2026-11-02' });
    expect(gh.calls).toEqual([]);

    await updatesScheduled(controller, withRepo, { fetcher: gh.fetcher, notifier, today: '2026-11-01' });
    await updatesScheduled(controller, withRepo, { fetcher: gh.fetcher, notifier, today: '2026-12-01' });
    expect(gh.calls).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('98.0.0');
  });
});
