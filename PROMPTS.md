# AI prompt and correction log

This log records the prompts and corrections for this project as work is done.

## 2026-11-05

- **Prompt:** Re-check the work after the steps are working and make it fully working.
- **Initial uncertainty:** The provided workspace was empty and had no Git repository. The app requirements were not initially specified, so I did not claim to have repaired or tested an existing project.
- **Correction/decision:** After the user left the choice to me, I proposed and proceeded with a self-contained LedgerLine personal ledger: add/edit/delete transactions, totals, search/filter, local browser storage, currency display preference, and a local run/test setup.
- **AI implementation error:** The first draft forgot to bind the amount input in the app's element map. I caught this while reviewing the form flow, added the binding, and then exercised add/edit/delete in the browser.
- **AI verification mistake:** The first browser smoke script was run while the dialog was already open from page inspection, and a retry used a label shared by the form and filter. I restarted from a clean page and used the form's specific control IDs; the end-to-end check then passed with no browser errors.
- **Verification:** `npm test` passes all 7 tests; `node --check` passes for the app, ledger, and server. A browser smoke test passed create, search, edit, reload persistence, delete, currency formatting/persistence, and mobile-width overflow checks.

## 2026-11-05 — PostgreSQL and Render request

- **Prompt:** Connect the app to a database, use `.gitignore`, push to `IGNITETHETEAM-2/LedgreLine`, and deploy on Render.
- **Initial design correction:** The requested no-login shared ledger exposes every transaction to every visitor. After the exposure was explained, the user explicitly chose to make the app and data public. I kept an always-visible warning in the UI and limited the app to fictional demo data.
- **Implementation:** Replaced browser-only storage with a PostgreSQL API, added parameterized queries and server-side validation, limited public static files, added a Render Blueprint, and ignored local secrets/dependency folders.
- **Render limit:** The Blueprint uses free plans. Render's free Postgres expires 30 days after creation, so the deployment is not suitable for persistent real financial data.
- **Verification:** All 11 unit/API tests pass. JavaScript syntax checks pass. Browser checks against a temporary in-memory API verified add/edit/delete, totals, search, persistence across reloads, currency formatting, and mobile layout. A real PostgreSQL connection and Render deployment still require a configured Render account/database.
- **Delivery attempt:** Created real local commit `f1acb90`. The GitHub push could not authenticate non-interactively, and the repository remains empty. Render redirected to its sign-in page, so no database or hosted deployment has been created. No credentials were requested or stored.
- **Follow-up:** Retried the Git push when continuing. Git Credential Manager also cannot prompt in this terminal, so authentication remains blocked. Render is now signed in and the Blueprint wizard recognizes the repository, but it reports that `render.yaml` is not present on `main`; no resources have been created.
- **2026-11-05 retry:** Retried `git push -u origin main`; Git Credential Manager again failed because this terminal cannot prompt. Confirmed the GitHub remote still has no branches or commits. Render can open the Blueprint wizard, but there is no remote `render.yaml` to deploy. No hosted database, service URL, or GitHub About link exists yet.
