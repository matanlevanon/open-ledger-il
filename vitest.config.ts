import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            DEV_AUTH_EMAIL: 'owner@example.com',
            OWNER_EMAIL: 'owner@example.com',
            ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            DOWNLOAD_SIGN_KEY: 'test-download-signing-key-not-a-secret',
            SEND_LINK_KEY: 'test-send-link-key-not-a-secret',
          },
          // Test-only scratch D1, declared here rather than wrangler.toml so it never ships to
          // production (that binding was removed there; the quarterly restore check now runs
          // entirely in memory, src/modules/ops/backup.ts). Its id must differ from DB's own
          // (wrangler.toml, "00000000-...") since local D1 keys storage by this id, and a shared
          // id would alias the two bindings to the same database.
          d1Databases: { SCRATCH_DB: 'open-ledger-il-scratch-test' },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
      // Signing-key generation and PDF building are CPU heavy. On a busy machine the defaults
      // (5 s per test, 10 s per hook) time out on work that is correct, so both get more room.
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  };
});
