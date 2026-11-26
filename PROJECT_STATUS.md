# Project status

Updated 2026-11-26. This is the handover baseline. Update the current state, check results and next steps whenever work resumes.

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
- Cloudflare deployment, remote D1, Telegram webhook, WBChakriAlert permissions, real channel delivery, Muse calls and live feed imports are pending. The workspace supplied no deployment credentials.

## Open work

- Premium entitlements, billing and payments are future work. The current flag is reserved for future use.
- Alerts process up to 30 saved searches per minute and up to 10 jobs per message. Daily searches with more than 10 matches carry the backlog into later digests. A lost Telegram response can cause an alert to repeat. Channel publishing instead retains the claim for operator reconciliation.
- Feed input is opt-in and bounded to the first 100 entries per refresh. Existing URLs are not overwritten by recurring imports. Listings without a deadline require verified closure via PATCH.
- Job deduplication uses the canonical official URL. Separate authoritative URLs for the same vacancy need editorial reconciliation. Matching uses exact qualification labels and SQLite ASCII case folding.

## Resume here

1. Check the GitHub Actions CI result for the published commit on Boosad96/Job main.
2. Follow DEPLOYMENT.md to provision D1, store secrets and dispatch the deployment workflow.
3. Complete the live acceptance checks in DEPLOYMENT.md, including Telegram delivery, a Muse submission, a staging channel post, and any permitted feed enabled for production.
4. Record the tested revision, Worker URL, successful live checks and remaining limits in this file. Keep secret values out of Git and logs.
