import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before each test file. applyD1Migrations skips migrations already applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// R24 Phase B, test only: a user row inserted straight into `users` gets the access it had before
// businesses existed, its role on business 1. Production code writes user_businesses itself.
// A test that needs exact grants uses an email starting with "noauto-".
await env.DB.prepare(
  `CREATE TRIGGER IF NOT EXISTS test_users_default_grant AFTER INSERT ON users
   WHEN NEW.email NOT LIKE 'noauto-%'
   BEGIN
     INSERT OR IGNORE INTO user_businesses (user_id, business_id, role, ends_at) VALUES (NEW.id, 1, NEW.role, NEW.access_ends_on);
   END`,
).run();

// A filled-in business profile, as after first-run setup, so tests can create documents.
// Invented data: the tax id is a synthetic number that passes the check digit.
await env.DB.prepare(
  `UPDATE business_profile SET name_en = 'Sample Business Ltd', name_he = 'עסק לדוגמה בע"מ', tax_id = '123456782',
     address_en = '1 Example Street, Tel Aviv' WHERE id = 1 AND name_en = ''`,
).run();
