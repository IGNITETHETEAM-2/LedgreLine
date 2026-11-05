# LedgerLine

LedgerLine is a public, shared income and expense ledger demo. It stores all entries in PostgreSQL.

> **Public data warning:** Anyone who can reach the deployed site can view, add, edit, or delete
> every entry. There is no sign-in or per-user data separation. Use fictional demo data only;
> never enter real financial or identifying information.

## Run locally

Requires Node.js 18 or newer and a PostgreSQL database. Set `DATABASE_URL` to a database
connection string in your environment before starting the server. Keep that value private and
never commit it.

In Windows PowerShell, if `npm` is blocked by execution policy, use `npm.cmd start` and
`npm.cmd test`. The app creates its tables on startup. Open the local address printed by the
command (by default, `http://127.0.0.1:4173`). Tests run with `npm test` and do not require a
database. Data saved by the earlier browser-local version is not automatically copied into the
shared database.

## What works

- Add, edit, and delete income and expense entries.
- See income, expenses, and balance totals; search and filter the transaction list.
- Choose a display currency (INR, USD, EUR, or GBP). This changes formatting only; it does not convert values.
- Persist shared entries and the display currency in PostgreSQL.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and apply `render.yaml`.
3. Render creates the web service and PostgreSQL database and wires `DATABASE_URL` internally.
4. Wait for the `/api/health` check and deployment to pass, then open the Render service URL.

The Blueprint uses Render's free plans. Render free web services can spin down when idle, and
free PostgreSQL databases expire after 30 days. Upgrade the database before expiry if you need
ongoing persistence. No account credentials or database URLs belong in the repository; local
`.env` files are ignored by Git.

## Limits

There is no sign-in, private ledger, bank connection, currency conversion, or per-user access
control. Since the app is intentionally shared, any visitor can change or delete all entries.
The deployment has not been created until the Blueprint is applied in a Render account.
