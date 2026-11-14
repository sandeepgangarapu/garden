# Gangarapu Garden

A mobile garden planner for Sandeep in Sammamish (Zone 8b). Pick plants by year (planned or skipped), check seasonal jobs, and dictate garden notes saved by year. Plant names in notes, jobs and care text link to that plant’s page. Plain HTML/CSS/ES2020 modules; no build step or dependencies. Install from Safari’s Share → Add to Home Screen for offline use.

## Run and test

From the repo root: `python3 -m http.server 8787`, then visit `http://localhost:8787/`. Localhost works without an API or sign-in. Open `/tests/` for logic, client sync, Worker validation, SQL, and locally signed RSA JWT tests. Or run:

```sh
~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --headless --virtual-time-budget=8000 --dump-dom http://localhost:8787/tests/
```

Check all four tabs, plant/picker sheets, quick notes, account status, keyboard use, offline behavior, at 320–430 px. The app is light mode only (no dark theme), even when the phone is in dark mode. No Python dependencies; use `uv` if adding any.

## Sign-in and sync

Cloudflare Access email one-time PIN protects the entire `garden.sandeepgangarapu.com` hostname, including static assets, manifest and `/api/*`. Its team domain is `https://empty-math-1944.cloudflareaccess.com`. Set the application's AUD at deployment. The app has one login, managed by Access; sign-out navigates to `/cdn-cgi/access/logout` and retains the device's garden.

A plain ES module Worker on `garden.sandeepgangarapu.com/api/*` verifies the Access JWT (RS256, cached JWKS, issuer, audience, time bounds, email). An optional `ALLOWED_EMAILS` allowlist adds an email restriction. A D1 binding named `DB` stores five tables partitioned by an owner key: `GARDEN_OWNER` when set (one shared household garden for everyone the Access policy allows), otherwise the verified email. The browser uses only same-origin `/api/me` and `/api/sync`, with manual redirects and same-origin credentials. No backend keys or login credentials belong in the client.

All rows use normalized ISO `updated_at`, `deleted: 0|1`, and server-assigned `synced_at`. Updates use strict timestamp last-write-wins SQL; all deletions are soft deletes. Dirty keys persist with local rows. Sync posts batches of at most 40 changes (Cloudflare D1's free plan allows 50 queries per request; each sync also runs 5 SELECTs), bounded below 1 MB,, merges newer remote rows, retains edits made in flight, and advances an incremental server cursor. Sync runs at load, one second after edits, on reconnection, and when the app becomes visible. Accurate device clocks are needed; the API rejects timestamps over one day ahead.

First-run defaults (all library plants in 2026; perennials and overwinter crops in 2027) have epoch timestamps and are never dirty. Only real edits upload. Existing v1 device data is migrated locally, preserving real edits and tombstones; no remote data migration is performed. Export backups from the menu. Blocked/full localStorage falls back to memory with an export reminder. Expired Access sessions show a sign-in banner without clearing data. A missing API reports local-only storage.

## Deploy

Pushing to `main` publishes the repo root with GitHub Pages at `https://garden.sandeepgangarapu.com`, proxied by Cloudflare. `CNAME` and `.nojekyll` are included. No build command is needed. Keep `classic/` untouched.

Create the D1 database and Access application separately. Use a narrowly scoped Cloudflare token from a local file or `CLOUDFLARE_API_TOKEN`. The stdlib-only deployment script applies the idempotent schema statement by statement, then uploads multipart modules and bindings:

```sh
python3 scripts/deploy_worker.py --account-id ACCOUNT_ID --name garden-api --entry index --d1-id PRODUCTION_D1_ID --team-domain https://empty-math-1944.cloudflareaccess.com --aud ACCESS_APPLICATION_AUD --allowed-emails EMAIL1,EMAIL2 --garden-owner gangarapu-garden --token-file /secure/path/cloudflare-token --apply-schema
```

Attach the production script to `garden.sandeepgangarapu.com/api/*` after deployment. Ensure Access covers that route as well as the static hostname. The script does not create routes, D1 databases or Access applications.

For temporary end-to-end testing, deploy **only** the test entry to a separate workers.dev script and throwaway database:

```sh
python3 scripts/deploy_worker.py --account-id ACCOUNT_ID --name garden-api-test --entry test --d1-id THROWAWAY_D1_ID --team-domain https://empty-math-1944.cloudflareaccess.com --aud TEST_AUD --allowed-emails '' --token-file /secure/path/cloudflare-token --apply-schema
```

The test entry trusts `X-Test-Email` and is never imported by production. Never attach it to the garden hostname or production data; delete the temporary script/database after tests. Add `--dry-run` to either command to inspect metadata and module parts without reading a token or making network calls.

The service worker is network-first, so deploys show up without bumping `CACHE` in `sw.js` (bump it only to drop old cached files). It installs its own shell cache, activates immediately, and uses a four-second network-first timeout. It caches only successful basic responses for this app's assets, preserves Access redirects, and never intercepts `/api/` or `/cdn-cgi/`.

## Edit the library

`data/plants.json` and `data/guides.json` are authoritative. Add a plant with a unique stable slug, neighboring fields, and exactly 12 timeline codes (January first, empty string for no activity). Jobs have permanent IDs, zero-based `month`, `type`, plant IDs or `area:front`, `area:back`, `area:vegetables`, `area:ornamental`, and plain-text `lead` and `text`. Never rename shipped plant/job IDs: notes and checkmarks refer to them. Add guide sentences to `items`.

`scripts/build_library.py` is a **one-time migration** from `_reference/`, not a build step. Running it again overwrites hand edits. Prototype notes are never imported.
