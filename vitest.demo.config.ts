import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/** Runs demo/*.demo.ts only (scripts/demo-unified-file.mjs). Never part of npm test. */
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
            ACCESS_TEAM_DOMAIN: 'https://mtn-test.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            DEMO_VAT: process.env.DEMO_VAT ?? '',
            DEMO_NAME_HE: process.env.DEMO_NAME_HE ?? '',
            SOFTWARE_REGISTRATION_NUMBER: process.env.DEMO_REGISTRATION_NUMBER ?? '',
          },
          d1Databases: { SCRATCH_DB: 'mtn-ledger-scratch-demo' },
        },
      }),
    ],
    test: {
      include: ['demo/**/*.demo.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
      testTimeout: 600_000,
      hookTimeout: 120_000,
    },
  };
});
