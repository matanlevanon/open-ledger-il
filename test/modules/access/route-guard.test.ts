import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireFeature, requireRole } from '../../../src/core/auth';
import type { ModuleDef } from '../../../src/core/module';
import type { AppEnv } from '../../../src/env';
import { declareManualAuth, findUndeclaredRoutes } from '../../../src/modules/access/route-guard';
import { modules } from '../../../src/modules';

describe('access: route declarations (runs/R09-accountant.md Build)', () => {
  it('finds no undeclared route in the real module registry', () => {
    expect(findUndeclaredRoutes(modules)).toEqual([]);
  });

  it('flags a route with no feature, role, or manual-auth declaration', () => {
    const probe = new Hono<AppEnv>();
    probe.get('/oops', (c) => c.json({ ok: true }));
    const probeModule: ModuleDef = { name: 'probe', basePath: '/probe', routes: probe };
    expect(findUndeclaredRoutes([probeModule])).toEqual([{ module: 'probe', method: 'GET', path: '/oops' }]);
  });

  it('accepts a module-wide requireFeature for the routes registered after it, not before', () => {
    const probe = new Hono<AppEnv>();
    probe.get('/before', (c) => c.json({ ok: true }));
    probe.use('*', requireFeature('settings'));
    probe.get('/after', (c) => c.json({ ok: true }));
    const probeModule: ModuleDef = { name: 'probe', basePath: '/probe', routes: probe };
    expect(findUndeclaredRoutes([probeModule])).toEqual([{ module: 'probe', method: 'GET', path: '/before' }]);
  });

  it('accepts requireFeature, requireRole, and an explicit manual-auth marker', () => {
    const probe = new Hono<AppEnv>();
    probe.get('/a', requireFeature('reports'), (c) => c.json({ ok: true }));
    probe.get('/b', requireRole('owner'), (c) => c.json({ ok: true }));
    probe.get('/c', declareManualAuth('checked inline'), (c) => c.json({ ok: true }));
    const probeModule: ModuleDef = { name: 'probe', basePath: '/probe', routes: probe };
    expect(findUndeclaredRoutes([probeModule])).toEqual([]);
  });
});
