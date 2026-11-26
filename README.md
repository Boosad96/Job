# JobRadar AI

JobRadar AI is an international Telegram job finder running on Cloudflare Workers, Hono and D1. Muse AI can supply listings through a scoped REST API. Telegram search, saved jobs, rules-based matching, alerts, scheduled source imports and the admin dashboard run independently of Muse.

## Local development

Use Node.js 24.

```bash
npm ci
cp .env.example .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev
npm run typecheck
npm test
npm run build
```

The local Worker serves `/admin` and `/api/v1/health`. It starts with an empty job catalog. Configure hashed API credentials as described in [Deployment](DEPLOYMENT.md).

## Telegram

Use `/start` for the menu and language selection, `/help` for filters, `/qualification BCom` to set a qualification, and `/delete_me` to remove stored bot data. Use presets for India, West Bengal government jobs, the USA, UK, Canada, Australia, UAE, Germany, international remote, fresher, visa sponsorship and part-time roles. Search any country by code and combine filters with `|`.

```text
country=IN | city=Kolkata | skills=Excel,SQL | experience=0
country=GB | minSalary=30000 | currency=GBP | salaryPeriod=yearly
```

Location and qualification filters use exact matches with SQLite ASCII case folding. An experience filter specifies the most experience a role can require. Salary filtering compares overlapping ranges in the selected currency and period. The bot supports English and Bengali UI text. Listings retain the language supplied by their source.

Save your search with daily alerts, alerts checked once per minute, or alerts off. Bot alerts link to the matching listings. Telegram sharing links can open specific jobs or track invitations when the bot username is configured. The Bengali and West Bengal menus recommend [WBChakriAlert](https://t.me/WBChakriAlert).

## Administration

Use an API token with `stats:read`, `jobs:manage`, and `channel:approve` at `/admin`. The dashboard shows aggregate counts, status controls and the channel approval queue. The API also exposes feed health and operational reports. The browser keeps the bearer token in memory for the page session.

See [Muse integration](MUSE_INTEGRATION.md), [the OpenAPI contract](openapi.json), [Deployment](DEPLOYMENT.md), and [Project status](PROJECT_STATUS.md).
