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

## Sending the unified file

From 1.1.2027 the Tax Authority takes the unified file (INI and BKMVDATA) through its upload API.

1. In the Tax Authority developer portal, subscribe the app to **UniStructFileUploadLinks_Product**
   and **FilesStatus_Product**, in the sandbox and in production.
2. Connect the Tax Authority for the business (above).
3. Open **Reports > Unified file**, pick the period and press **Send to the Tax Authority**.
4. Press **Check status** later. Each file shows Uploaded, then Approved or Rejected.

The sandbox accepts only a PDF of up to 1MB, so on `ITA_ENV=sandbox` the Ledger uploads a one-page
test PDF in place of each file. That checks the sign-in, the links and the upload, not the file.
Files over 32MB go up in chunks, as the spec asks. Demo businesses and manual-allocation mode can't send.
