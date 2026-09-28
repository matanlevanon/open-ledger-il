# Architecture

One Cloudflare Worker serves the API under `/api` and the web app from Workers Static Assets. D1 holds the data. R2 holds files. Cloudflare Access signs people in. Stack fixed by R00, see `runs/_common.md`.

## Request flow

1. Cloudflare Access checks the person at the edge and adds the `Cf-Access-Jwt-Assertion` header.
2. Static Assets serves the web app for every path except `/api/*` and `/mcp*`, which reach the Worker first (`run_worker_first` in `wrangler.toml`). Unknown app paths fall back to `index.html`.
3. `src/index.ts` answers `/api/health` without sign-in. Every other `/api` route passes `authenticate` from `src/core/auth.ts`: JWT check against the team JWKS, email to `users` row, role and feature list on `c.get('user')`.
4. The module router runs. Each route declares `requireFeature(feature)` or `requireRole(role)`.
5. Writes that must stay consistent go through `transaction()` in `src/core/db.ts`, which is `db.batch`. Audit rows join the same batch through `auditStatement()`.
6. Errors leave as `{error:{code,message}}`. D1 trigger codes map to typed errors in `src/core/errors.ts`.
7. After the handler, accountant requests are written to `audit_log` with path, method, status and IP.

Cron triggers call `scheduled()` in `src/index.ts`, which hands the event to every module that exports `scheduled`.

## Core (`src/core/`, owned by R00)

| File | What it does |
|---|---|
| `money.ts` | Minor-unit integers, 6-decimal rate strings, `convert()` rounding half away from zero, VAT by basis points, currency list |
| `db.ts` | Typed `first`, `all`, `run`, `transaction` (D1 batch), date helpers |
| `auth.ts` | Access JWT check, dev bypass, owner bootstrap, `requireRole`, `requireFeature`, feature list |
| `audit.ts` | `audit(ctx, action, entity, entityId, details)`, `auditStatement` for batches, secret redaction |
| `numbering.ts` | `nextNumber`, `setStartNumber`, `closeSeries`, `finalizeDocument` |
| `hashchain.ts` | Canonical JSON, SHA-256 chain, `verifyChain` |
| `config.ts` | Effective-dated legal mode, VAT rate, thresholds, ceilings |
| `errors.ts` | Typed domain errors and the trigger code map |
| `module.ts` | `ModuleDef`, the shape every module exports |

## Finalize, numbering and the hash chain

D1 has no interactive transactions, so finalize is optimistic. `finalizeDocument` reads the draft, the series' next number and the chain head. It hashes the frozen record, then commits one batch: `INSERT INTO finalizations`, `UPDATE documents`, extra statements, audit row. Triggers on `finalizations` refuse the insert when the number is no longer next, the chain head moved or the draft changed since it was read (`documents.version`). The batch rolls back and finalize retries. Result: no gaps and no reuse, even under concurrent finalize.

Only this path sets a document to `final`. A trigger refuses the status change unless a matching `finalizations` row exists.

Final and cancelled documents are frozen by triggers in `migrations/0002_integrity.sql`. Allowed after final: `final` to `cancelled` with a reason, and appending to the `pdf_hashes` JSON array. Lines, payments and links of final documents never change. `audit_log` and `finalizations` are append-only.

A run that adds a column to `documents`, `document_lines` or `payments` must recreate the matching frozen trigger with the new column. When the column is content, it also goes into the hashed field list in `hashchain.ts`. `test/core/immutability.test.ts` walks every column and fails if one is left out.

## Module map

Each run owns its folders, one slot line in `src/modules/index.ts` and one in `web/src/features/index.ts`. Replace your own slot line and keep the blank lines around it.

| Run | Worker module | Web feature | Migrations | Scope |
|---|---|---|---|---|
| R00 | `src/core/` | shell in `web/src/layout/` | 0001-0099 | Foundation |
| R01 | `clients`, `documents` | `documents` | 0100-0199 | Clients, client book, פטור documents, payments, links, credits |
| R02 | `pdf` | none | 0200-0299 | Bilingual and English PDF rendering |
| R03 | `signing` | none | 0300-0399 | PAdES signing |
| R04 | `fx` | none | 0400-0499 | Bank of Israel rates |
| R05 | `dashboard` | `dashboard`, shared components, `web/src/api/` | 0500-0599 | Wave-style shell and dashboard |
| R06 | `sending` | `sending` | 0600-0699 | Sending, consent, reminders |
| R07 | `expenses` | `expenses` | 0700-0799 | Drive ingest, Claude extraction, review |
| R08 | `reports`, `ceiling` | `reports` | 0800-0899 | Reports, ceiling meter and guard, accountant pack |
| R09 | `access` | `access` | 0900-0999 | Accountant access, users, access log |
| R10 | `import` | `import` | 1000-1099 | Import from SUMIT and Wave |
| R11 | `legal-mode` | `legal-mode` | 1100-1199 | עוסק מורשה mode and the switch |
| R12 | `ita` | `ita` | 1200-1299 | ITA Israel Invoices client and mock |
| R13 | `exports` | `exports` | 1300-1399 | Unified file and PCN874 exports |
| R14 | `ops`, `mcp` | `settings` | 1400-1499 | Gap check, backup, settings, MCP |
| R15 | tests and fixes | none | 1500-1599 | End-to-end tests, security, compliance checklist, deploy guide |

## Tests

- Worker: Vitest with `@cloudflare/vitest-pool-workers`. `test/apply-migrations.ts` applies every migration before each test file. Storage is isolated per test file.
- Web: Vitest with jsdom, config in `web/vitest.config.ts`.
- `npm test` runs both. No test calls the internet.
