# Contributing

Thanks for helping. Read `CLAUDE.md` first. Its rules protect legal records, and a PR that weakens one gets closed.

## Before you open a PR

```
npm ci
npm run typecheck
npm test
npm run build
node scripts/leak-check.mjs
```

All five must pass. CI runs the same checks plus gitleaks on every push and PR.

## Rules for changes

- **Legal records.** Never edit, delete or renumber a final document in code or SQL. Fixes go through Cancel or Credit.
- **Config, not code.** VAT rates, thresholds, ceilings and legal-mode dates live in dated config tables. Add a row, never a constant.
- **Migrations.** Add a new numbered file under `migrations/`. Never change the SQL of a released migration. Keep `.sql` files LF.
- **Tests.** Every legal rule has a test named after the rule. New behavior ships with a test.
- **No real data.** Fixtures use invented names ("Sample Business Ltd", "Acme Ltd", "Example Client") and synthetic ids. Never paste a real client, invoice, tax id, bank account or email into the repo, an issue or a PR.
- **External services.** ITA, Bank of Israel, Google Drive, Anthropic, email and Slack sit behind an interface with a fake for tests. No test calls the internet.
- **Copy.** Short active sentences in UI text and docs. No em dashes, no semicolons. English and Hebrew strings together.

## Commits

Conventional commits: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`. The message says what changed.

## License

By contributing, you agree your contribution ships under the GNU Affero General Public License v3.0.
