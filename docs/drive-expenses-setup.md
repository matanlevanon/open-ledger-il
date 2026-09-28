# Drive expenses setup

The ledger reads your expenses root folder in Google Drive and the monthly index sheets in it. It reads only. It never changes, moves or deletes a file.

It signs in as a Google service account: a robot user with its own email address. You share the folder with that email, and the ledger sees what you shared and nothing else.

Do this once. It takes about 10 minutes.

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com and sign in with the Google account that owns your expenses folder.
2. At the top, click the project picker, then **New project**.
3. Name it `open-ledger-il`. Leave the organization as it is. Click **Create**.
4. When it is ready, pick `open-ledger-il` in the project picker.

## 2. Turn on the Drive API and the Sheets API

1. Open the menu, then **APIs & Services**, then **Library**.
2. Search for **Google Drive API**. Open it and click **Enable**.
3. Back in **Library**, search for **Google Sheets API**. Open it and click **Enable**.

## 3. Create the service account

1. Open **APIs & Services**, then **Credentials**.
2. Click **Create credentials**, then **Service account**.
3. Name it `open-ledger-il-drive`. Click **Create and continue**.
4. Skip the optional role and user steps. Click **Done**.
5. Copy the service account's email from the list. It looks like `open-ledger-il-drive@open-ledger-il.iam.gserviceaccount.com`.

## 4. Create a JSON key

1. In **Credentials**, click the service account you just made.
2. Open the **Keys** tab. Click **Add key**, then **Create new key**.
3. Pick **JSON** and click **Create**. A `.json` file downloads.
4. Keep this file private. It is a password. Do not put it in the repo, in email or in chat.

If Google says key creation is disabled by an organization policy, you are signed in to a workspace with that policy. Use a personal Google account for the project instead.

## 5. Share the folder with the service account

1. Open Google Drive and find your expenses root folder.
2. Right click it, then **Share**.
3. Paste the service account's email. Set the role to **Viewer**.
4. Clear **Notify people**. Click **Share**.

The month folders and the index sheets inside inherit the share. There is nothing to share one by one.

## 6. Give the key to the ledger

Run this on your PC, in your clone of this repository:

```
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

When it asks for the value, paste the whole content of the JSON file, from the first `{` to the last `}`, and press Enter. Then delete the downloaded file.

## 7. Check it works

1. In the ledger, open **Settings**, then **Expenses**. Paste the root folder id (the part of the folder URL after `/folders/`) and click **Save folder**. The field starts empty. There is no default folder.
2. Open **Expenses**, pick a month that has an index sheet, and click **Import month**.
3. The result line shows how many rows it saw and created. Run it again. The second run creates nothing and lists every row as already in the ledger.
4. To import every morning, turn on **Daily sync** in **Settings**, **Expenses**. It is off until you turn it on.

## What the import does

- With the month's index sheet (titled `Expense index YYYY-MM` in the root folder by default, change the pattern in **Settings** > **Expenses**), it creates an expense for each row marked Expense (or הוצאה) and attaches the PDF from the row's Drive link. Other statuses are counted, not created.
- Without an index sheet, it reads every file in the month folder with AI and adds each one as a new expense for review. It skips documents your own business issued, matched by the business name and tax id in Settings > Business.
- It never reads the `_to_be_deleted` folder.
- It skips anything already in the ledger, uploads included: the same Drive file, the same file content, or the same supplier and document number. A row with the same supplier, date and total in shekels is flagged and not created.
- It never changes or deletes an expense that is already there.

## If something fails

- **"GOOGLE_SERVICE_ACCOUNT_JSON is not set"**: step 6 did not run, or ran in another folder.
- **403 or 404 from Google**: the folder is not shared with the service account's email (step 5), or one of the two APIs is off (step 2).
- The run log in **Settings**, **Expenses** shows each run with its errors.
