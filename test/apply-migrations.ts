import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before each test file. applyD1Migrations skips migrations already applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// A filled-in business profile, as after first-run setup, so tests can create documents.
// Invented data: the tax id is a synthetic number that passes the check digit.
await env.DB.prepare(
  `UPDATE business_profile SET name_en = 'Sample Business Ltd', name_he = 'עסק לדוגמה בע"מ', tax_id = '123456782',
     address_en = '1 Example Street, Tel Aviv' WHERE id = 1 AND name_en = ''`,
).run();
