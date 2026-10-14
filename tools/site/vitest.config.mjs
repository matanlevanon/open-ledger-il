// The site Worker's tests, on the Workers pool with the real site/ folder as its assets.
// Run from the repository root: npm run test:site
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [cloudflareTest({ main: './src/index.js', wrangler: { configPath: './wrangler.toml' } })],
  test: { include: ['test/**/*.test.js'] },
});
