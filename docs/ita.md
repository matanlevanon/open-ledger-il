# Tax Authority per business

Each business has its own Tax Authority connection, token and allocation queue.

- Connect it from the business: open it in the top-bar switcher, then **Tax Authority > Connect**.
  After **Add business** the Ledger offers "Connect the Tax Authority for this business".
- The sign-in state carries the business id. The callback stores the token for that business only.
- With a login broker (docs/deploy.md, Option 4), one broker client serves every business. The state picks the business.
- Only an owner of the business can connect it.

## A company

A company signs in with the user code of a person authorized for that company. Sign in as that
person, not with your own עוסק login. A token for one tax ID never allocates numbers for another.

The connection options are in `deploy.md`.
