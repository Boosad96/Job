# JobRadar AI contributor instructions

- Read PROJECT_STATUS.md before changing deployment or continuing handover work.
- Keep Muse endpoints and openapi.json in sync. Document breaking changes before changing the versioned contract.
- Preserve null for unknown facts and use approved sources only. Test data belongs under tests.
- Use D1 migrations for schema changes and parameterized SQL for values.
- Keep credentials in secrets or ignored local files. Never log tokens, Telegram update payloads, or user identifiers.
- Run npm run typecheck, npm test, and npm run build before committing. Update PROJECT_STATUS.md with the results and any live checks still pending.
