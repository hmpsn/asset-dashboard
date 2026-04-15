# Config

## Environment Variables

- `ADMIN_URL` **required** — server/email.ts
- `ALLOW_DB_IMPORT` **required** — server/routes/health.ts
- `ALLOWED_ORIGINS` (has default) — .env.example
- `ANTHROPIC_API_KEY` (has default) — .env.example
- `APP_PASSWORD` (has default) — .env.example
- `APP_URL` (has default) — .env.example
- `AWS_ACCESS_KEY_ID` (has default) — .env.example
- `AWS_SECRET_ACCESS_KEY` **required** — .env.example
- `BACKUP_DIR` (has default) — .env.example
- `BACKUP_RETENTION_DAYS` (has default) — .env.example
- `BACKUP_S3_BUCKET` (has default) — .env.example
- `BACKUP_S3_PREFIX` (has default) — .env.example
- `BACKUP_S3_REGION` (has default) — .env.example
- `CI` **required** — playwright.config.ts
- `DATA_DIR` (has default) — .env.example
- `DATAFORSEO_LOGIN` **required** — server/providers/dataforseo-provider.ts
- `DATAFORSEO_PASSWORD` **required** — server/providers/dataforseo-provider.ts
- `DISABLE_DEBUG_ENDPOINTS` **required** — server/routes/debug.ts
- `EMAIL_DIGEST_HOUR` **required** — server/email-throttle.ts
- `EMAIL_DIGEST_TZ` **required** — server/email-throttle.ts
- `FEATURE_OUTCOME_TRACKING` **required** — tests/integration/outcome-pipeline.test.ts
- `GITHUB_BASE_REF` **required** — scripts/pr-check.ts
- `GOOGLE_API_KEY` **required** — server/pagespeed.ts
- `GOOGLE_CLIENT_ID` (has default) — .env.example
- `GOOGLE_CLIENT_SECRET` (has default) — .env.example
- `GOOGLE_PSI_KEY` (has default) — .env.example
- `GOOGLE_REDIRECT_URI` (has default) — .env.example
- `HOME` **required** — server/backup.ts
- `JWT_SECRET` (has default) — .env.example
- `LOG_LEVEL` **required** — server/logger.ts
- `MODE` **required** — src/main.tsx
- `NODE_ENV` **required** — server/app.ts
- `NOTIFICATION_EMAIL` (has default) — .env.example
- `OPENAI_API_KEY` (has default) — .env.example
- `PORT` (has default) — .env.example
- `PROD` **required** — src/main.tsx
- `PROD_URL` **required** — scripts/sync-staging-db.ts
- `SEMRUSH_API_KEY` (has default) — .env.example
- `SENTRY_AUTH_TOKEN` (has default) — .env.example
- `SENTRY_DSN` (has default) — .env.example
- `SENTRY_ORG` (has default) — .env.example
- `SENTRY_PROJECT` (has default) — .env.example
- `SESSION_SECRET` (has default) — .env.example
- `SMTP_FROM` (has default) — .env.example
- `SMTP_FROM_NAME` (has default) — .env.example
- `SMTP_HOST` (has default) — .env.example
- `SMTP_PASS` (has default) — .env.example
- `SMTP_PORT` (has default) — .env.example
- `SMTP_USER` (has default) — .env.example
- `STAGING_URL` **required** — scripts/sync-staging-db.ts
- `STRIPE_CONFIG_KEY` **required** — server/stripe-config.ts
- `STRIPE_PRICE_BRIEF` (has default) — .env.example
- `STRIPE_PRICE_POST_DRAFT` (has default) — .env.example
- `STRIPE_PRICE_POST_POLISHED` (has default) — .env.example
- `STRIPE_PRICE_POST_PREMIUM` (has default) — .env.example
- `STRIPE_PRICE_SCHEMA_PAGE` (has default) — .env.example
- `STRIPE_PRICE_SCHEMA_SITE` (has default) — .env.example
- `STRIPE_PRICE_STRATEGY` (has default) — .env.example
- `STRIPE_PRICE_STRATEGY_REFRESH` (has default) — .env.example
- `STRIPE_PRICE_TEST` **required** — tests/unit/stripe-config.test.ts
- `STRIPE_PUBLISHABLE_KEY` (has default) — .env.example
- `STRIPE_SECRET_KEY` (has default) — .env.example
- `STRIPE_WEBHOOK_SECRET` (has default) — .env.example
- `TURNSTILE_SECRET_KEY` (has default) — .env.example
- `VITE_SENTRY_DSN` (has default) — .env.example
- `VITE_TURNSTILE_SITE_KEY` (has default) — .env.example
- `WEBFLOW_API_TOKEN` (has default) — .env.example

## Config Files

- `.env.example`
- `render.yaml`
- `tsconfig.json`
- `vite.config.ts`

## Key Dependencies

- @anthropic-ai/sdk: ^0.78.0
- better-sqlite3: ^12.6.2
- express: ^4.22.1
- openai: ^6.25.0
- react: ^19.2.0
- stripe: ^20.4.1
- tailwindcss: ^4.2.1
- zod: ^3.23.0
