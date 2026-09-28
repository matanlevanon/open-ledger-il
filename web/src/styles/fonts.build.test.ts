// @vitest-environment node
// esbuild (used by the Vite build below) needs a real TextEncoder/Uint8Array, which jsdom's
// environment breaks; run this one file under plain Node instead of the suite's jsdom default.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * R17 task 1: Hebrew dropped its bundled web font (Heebo) for the platform's own Hebrew-capable
 * sans (see tokens.css --font-hebrew). This builds the real web app once with Vite and inspects
 * the emitted CSS, so a re-added Heebo import (or a stray reference in a copied font stack)
 * fails the test instead of only being caught by manual review.
 */
describe('built web CSS', () => {
  it('contains no Heebo reference', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'open-ledger-il-fonts-build-'));
    try {
      await build({
        root: webRoot,
        configFile: join(webRoot, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true, write: true },
      });
      const assetsDir = join(outDir, 'assets');
      const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
      expect(cssFiles.length).toBeGreaterThan(0);
      const css = cssFiles.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n');
      expect(css).not.toMatch(/Heebo/i);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
