import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import wranglerToml from '../wrangler.toml?raw';
import type { ModuleDef } from '../src/core/module';
import { modules } from '../src/modules';
import { declaredCrons, dispatchScheduled } from '../src/scheduled';

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController;
}

/** Active (uncommented) entries of wrangler.toml's `[triggers] crons`. */
function wranglerCrons(): string[] {
  const block = /\[triggers\]\s*crons\s*=\s*\[([\s\S]*?)\n\]/.exec(wranglerToml);
  if (!block) throw new Error('wrangler.toml has no [triggers] crons block');
  return block[1]!
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .map((line) => /^"([^"]+)"/.exec(line)![1]!)
    .sort();
}

describe('one scheduled handler for every cron', () => {
  it('wrangler.toml has exactly one [triggers] block', () => {
    expect(wranglerToml.match(/^\[triggers\]/gm)).toHaveLength(1);
  });

  it('lists in wrangler.toml exactly the crons the registered modules declare', () => {
    expect(wranglerCrons()).toEqual(declaredCrons(modules));
    expect(declaredCrons(modules)).toEqual([
      '*/15 * * * *',
      '0 2 * * *',
      '0 3 1 1,4,7,10 *',
      '0 6 * * *',
      '0 7 * * *',
      '0 7 5 * *',
      '0 8 * * *',
      '0 9 * * *',
      '30 5 * * *',
    ]);
  });

  it('every module with a scheduled handler declares its crons, and every declared cron has a handler', () => {
    for (const m of modules) expect(Boolean(m.scheduled)).toBe(Boolean(m.crons?.length));
  });

  it('dispatches a cron only to the modules that declare it, and one failure does not stop the others', async () => {
    const calls: string[] = [];
    const job = (name: string, crons: string[], fail = false): ModuleDef => ({
      name,
      basePath: `/${name}`,
      routes: undefined as unknown as ModuleDef['routes'],
      crons,
      async scheduled(c) {
        calls.push(`${name}:${c.cron}`);
        if (fail) throw new Error('boom');
      },
    });
    const probes = [job('a', ['0 6 * * *']), job('b', ['0 6 * * *'], true), job('c', ['0 8 * * *'])];
    const results = await dispatchScheduled(controller('0 6 * * *'), env, {} as ExecutionContext, probes);
    expect(calls.sort()).toEqual(['a:0 6 * * *', 'b:0 6 * * *']);
    expect(results).toEqual([
      { module: 'a', ok: true },
      { module: 'b', ok: false, error: 'Error: boom' },
    ]);
  });

  it('runs nothing for a cron no module declares', async () => {
    expect(await dispatchScheduled(controller('1 1 1 1 *'), env, {} as ExecutionContext, modules)).toEqual([]);
  });
});
