# Project status

Updated 2026-11-26. This is the handover baseline. Update the current state, check results and next steps whenever work resumes.

## Public website handover

- The same Worker now serves the home page, search, job details, legal and contact pages, crawler files and the public stylesheet. The listings, search results and sitemap use active D1 records with open deadlines.
- A job still marked active can show “Applications closed” on its detail page after the deadline. Once maintenance changes the record's status to expired, its detail URL returns 404.
- The public pages use server-rendered HTML and a same-origin stylesheet. JobPosting JSON-LD is an inert data block. Telegram job cards link to the full listing using the configured public URL or the incoming webhook request origin.
- Verified on Node 24.22.3 with `npm ci` (85 packages, npm advisory warnings), `npm run typecheck` (passed), `npm test` (16 passed) and `npm run build` (Wrangler dry-run passed).
- Wrangler local HTTP checks passed against a disposable D1 copy of the live Cooch Behar listing and isolated draft and past-deadline fixtures. Verified home, search, job details and 404s, informational pages, stylesheet, sitemap, robots.txt, the unset ads.txt 404, admin HTML and assets, API health, and the webhook's unauthorized response.
- Production rollout and post-deployment checks are pending. Configure `PUBLIC_SITE_URL` and `PUBLIC_CONTACT_EMAIL` as optional plain Worker variables. Set `ADS_TXT` only when the approved publisher text is available.

## Verification — independent re-check 26 Nov 2026 ~14:50 IST (bundle checkout)

- The user uploaded the repo as a git bundle (`jobradar-ai_13_hu4x.bundle`, one commit `f94a15e`). Cloned with `git clone -b main` (plain clone fails: HEAD refers to a nonexistent ref). Working tree clean, no GitHub remote — `origin` is the local bundle file.
- **Reconciliation with the user's two uploaded docs: zero conflicts.** `DEPLOYMENT__1__14_otpt.md` is byte-identical to the repo's `DEPLOYMENT.md`, and `MUSE_INTEGRATION__1__15_1kmw.md` is byte-identical to the repo's `MUSE_INTEGRATION.md`. Both adopted as-is; no file changed, no contract changed.
- Gates re-run from this checkout (Node 24.22.1): `npm ci` — 88 packages, clean. `npm run typecheck` — clean. `npm test` — **10/10 pass** (6 integration + 4 model). `npm run build` (wrangler dry-run) — clean, 899.56 KiB / 154.76 KiB gzip, all bindings listed. `npx wrangler d1 migrations apply DB --local` — **19 commands, 0001_initial.sql ✅**.
- Local live smoke test (`wrangler dev --local`, port 8787): GET `/api/v1/health` → 200 `{"data":{"status":"ok"}}`; GET `/api/v1/jobs` → 200 `{"data":[]}` (empty catalog — no fake listings seeded); GET `/admin` → 200; POST `/telegram/webhook` without the secret header → 401. Telegram delivery, Muse ingestion, feed imports and remote D1 remain untested live (no bot token or Cloudflare credentials in this workspace).
- This re-check changed no source code; only this file was updated, committed as the verification commit on top of `f94a15e`.

## Implemented

- Hono Worker, D1 migration, public search with pagination and filters, scoped Muse ingestion and management API, transactional idempotency, canonical URL deduplication and audit.
- English and Bengali Telegram menus, job cards, qualification filters, saved jobs and searches, daily and minute-scheduled alerts, sharing, referral attribution and user data deletion.
- West Bengal channel recommendations, Bengali publication requests, approval controls, revision checks and a durable duplicate-prevention claim.
- Responsive administrator dashboard, aggregate statistics, source health, maintenance reports and job status management.
- Opt-in Greenhouse, Lever, USAJOBS, Remotive and authorized JSON adapters. Premium schema and disabled feature flag.
- CI and manually dispatched GitHub deployment workflow, OpenAPI and Muse operations guide.

## Verification

- Node.js 24 unit and Miniflare D1 integration suites passed all 10 tests. Telegram and authorized feed HTTP calls were mocked. The tests exercised concurrent ingestion, duplicate publication protection, scheduled alerts and user deletion.
- TypeScript and Wrangler dry-run bundle checks passed. Wrangler applied all 19 migration commands to a disposable local D1 database.
- Cloudflare deployment, remote D1, Telegram webhook, WBChakriAlert permissions, real channel delivery, Muse calls and live feed imports are pending. The workspace supplied no deployment credentials. GitHub rejected creation of private Boosad96/job with “Resource not accessible by integration” and the browser reached GitHub sign-in. The implementation is committed locally.

## Open work

- Premium entitlements, billing and payments are future work. The current flag is reserved for future use.
- Alerts process up to 30 saved searches per minute and up to 10 jobs per message. Daily searches with more than 10 matches carry the backlog into later digests. A lost Telegram response can cause an alert to repeat. Channel publishing instead retains the claim for operator reconciliation.
- Feed input is opt-in and bounded to the first 100 entries per refresh. Existing URLs are not overwritten by recurring imports. Listings without a deadline require verified closure via PATCH.
- Job deduplication uses the canonical official URL. Separate authoritative URLs for the same vacancy need editorial reconciliation. Matching uses exact qualification labels and SQLite ASCII case folding.

## Resume here

1. Create the private Boosad96/job repository with a GitHub identity authorized to create personal repositories, grant the GitHub integration access, then push the local main branch and confirm CI.
2. Follow DEPLOYMENT.md to provision D1, store secrets and dispatch the deployment workflow.
3. Complete the live acceptance checks in DEPLOYMENT.md, including Telegram delivery, a Muse submission, a staging channel post, and any permitted feed enabled for production.
4. Record the tested revision, Worker URL, successful live checks and remaining limits in this file. Keep secret values out of Git and logs.
