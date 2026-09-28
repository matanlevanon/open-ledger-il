# CLAUDE.md for MTN - Open Ledger IL

Read `README.md`, `docs/architecture.md` and the relevant file in `docs/` before any change.

## Non-negotiable rules

1. A final document never changes and never disappears. Fix with Cancel or Credit only. D1 triggers enforce this. Never drop or weaken them.
2. Document numbers come from one place: the finalize transaction. No gaps, no reuse, one series per type.
3. No PDF of a qualifying tax invoice leaves the system before an allocation number or a recorded refusal decision.
4. Tax rules, VAT rates, thresholds and legal-mode dates live in config tables with effective dates. Never hard-code 18%, ₪5,000 or a switch year.
5. The ITA client secret, the signing key, the encryption key and the owner ID used as the ITA user id live in Worker secrets. Never in the repo, never in logs.
6. Every accountant request passes the role and feature check, and writes to `audit_log`.
7. Sandbox and production ITA credentials never mix. A Worker variable chooses the environment.
8. All v2 ITA field names in lowercase.
9. Personal data lives in settings, secrets and uploaded assets, never in code. The business name, tax id, address, logo and signature come from Settings. Fixtures use invented data only: "Sample Business Ltd", "Acme Ltd", "Example Client". `node scripts/leak-check.mjs` must pass.

## Workflow

- Conventional commits: feat, fix, chore, docs, test, refactor. Messages describe the actual change.
- Before a PR: `npm run typecheck`, `npm test`, `npm run build` and `node scripts/leak-check.mjs` pass.
- Migrations are append-only. Never edit the SQL of a migration already released. Add a new file.
- Writing style for UI copy and docs: short active sentences, no em dashes, no semicolons.
