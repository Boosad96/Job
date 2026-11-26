# Deployment

## Cloudflare setup

1. Install Node.js 24, run `npm ci`, and authenticate Wrangler.
2. Run `npx wrangler d1 create jobradar-ai`. For a manual deployment, replace the placeholder `database_id` in your local Wrangler config with the returned ID. In GitHub Actions, set the production environment variable `D1_DATABASE_ID`.
3. Configure production secrets using the commands below. For GitHub Actions, also set `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` with Workers deployment and D1 migration access in the production environment.
4. Dispatch **Deploy JobRadar AI** from `main`. For manual deployment, run `npx wrangler d1 migrations apply DB --remote`, then `npm run deploy`.

Generate one independent, high-entropy token per principal. The Worker secret uses SHA-256 hashes. Give each raw token only to its intended client over a secure channel.

```bash
openssl rand -hex 32
read -rs JOBRADAR_TOKEN
printf '%s' "$JOBRADAR_TOKEN" | openssl dgst -sha256
unset JOBRADAR_TOKEN
npx wrangler secret put API_CREDENTIALS
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BOT_USERNAME
```

Set `API_CREDENTIALS` as JSON. Replace the digest placeholders with lowercase hexadecimal SHA-256 strings.

```json
[
  {"id":"muse","sha256":"MUSE_DIGEST","scopes":["jobs:write","jobs:manage","channel:request"]},
  {"id":"admin","sha256":"ADMIN_DIGEST","scopes":["jobs:manage","stats:read","channel:approve"]}
]
```

Use a webhook secret of 1–256 characters drawn from `A-Z a-z 0-9 _ -`. Set the username without the leading @. Existing authentication can be rotated by updating the credential array. Keep principal IDs stable during rotation to preserve their idempotency history.

## Telegram webhook and channel

Generate the bot token through BotFather. After deployment, set `JOBRADAR_WORKER_URL`, `JOBRADAR_TELEGRAM_TOKEN`, and `JOBRADAR_WEBHOOK_SECRET` in a trusted shell session.

```bash
jq -nc --arg url "$JOBRADAR_WORKER_URL/telegram/webhook" --arg secret "$JOBRADAR_WEBHOOK_SECRET" \
  '{url:$url,secret_token:$secret,allowed_updates:["message","callback_query"]}' |
  curl -fsS -H 'Content-Type: application/json' -d @- \
    "https://api.telegram.org/bot${JOBRADAR_TELEGRAM_TOKEN}/setWebhook"
curl -fsS "https://api.telegram.org/bot${JOBRADAR_TELEGRAM_TOKEN}/getWebhookInfo"
curl -fsS "$JOBRADAR_WORKER_URL/api/v1/health"
```

For publication to WBChakriAlert, obtain channel owner authorization and grant the bot permission to post. Set `CHANNEL_CHAT_ID` via `npx wrangler secret put CHANNEL_CHAT_ID` to `@WBChakriAlert` or its Telegram chat ID. Test in a channel you control before using the production channel. Keep `CHANNEL_AUTO_PUBLISH=false` for per-post approval. Change the Wrangler variable to `true` only when all holders of the channel request scope are authorized for unattended publication.

Check `sending` rows in the dashboard against the actual Telegram channel. A lost response may have delivered a post. After confirming the outcome, an authorized D1 operator can mark the row `published` with its Telegram message ID or return it to `pending` if delivery definitively failed. Normal API calls cannot reset a sending claim.

## Permitted feeds and scheduled work

Feeds are opt-in. Edit `FEEDS_JSON` in Wrangler and redeploy. Configure up to seven entries. Confirm the source allows the intended use and schedule before enabling it.

| Kind | Configuration |
| --- | --- |
| `greenhouse` | `board` slug. Reads the public board and its job list. |
| `lever` | `board` slug and the employer's known `company` display name. Use `eu:true` for the EU endpoint. |
| `usajobs` | `keyword`, plus `USAJOBS_API_KEY` and registered `USAJOBS_USER_AGENT` Worker secrets. |
| `remotive` | Public remote jobs feed. Check attribution and redistribution terms before enabling. |
| `authorized-json` | `name` and HTTPS `url` of an authorized official government or partner endpoint returning an array of Job-shaped objects. |

Feed refresh runs every six hours, reads up to 100 entries per configured source and records the outcome. Connectors import through the same validation and deduplication as Muse. Existing jobs with the same canonical source URL are retained. Use PATCH for verified corrections or closure. Missing deadlines stay null. Preserve official links and attribution. Maintenance expires known deadlines, prunes old receipt and webhook records, and stores a daily report snapshot in D1. The one-minute cron processes due searches and approved channel publications. Cron and worker quotas determine throughput.

## Live acceptance

Verify real Cloudflare health and migrations, send `/start` in Telegram, switch language, search and save an authorized listing, verify a matching alert, run deletion, sign into the dashboard, and test an approved post in the authorized test channel. For each configured source, confirm its health row and sample the original URLs and facts. No startup script creates test listings in production.
