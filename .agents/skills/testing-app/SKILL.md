# Testing asset-dashboard

## Dev Server

```bash
cd ~/repos/asset-dashboard
npm run dev:all  # Starts Vite frontend + tsx backend concurrently
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5173/api/* (proxied through Vite)
- WebSocket: ws://localhost:5173/ws
- Health endpoint: http://localhost:5173/api/health

## Running Tests

```bash
npx vitest run           # Unit + integration tests
npx tsc --noEmit --skipLibCheck  # Type check
npx vite build           # Production build verification
```

## Testing Public API Features

### Rate Limit Headers
All `/api/public/*` endpoints return rate limit headers. Verify with:
```bash
curl -sI http://localhost:5173/api/public/auth-mode/<workspaceId> | grep -i ratelimit
```
Expect: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`

### Credential Stuffing Protection
The `clientLoginLimiter` (5/min per IP) fires before the per-email credential stuffing check (5 failures → 15-min lockout). When testing locally, both layers share the same localhost IP, so the IP rate limiter will fire first after ~5 requests in a 1-minute window.

To test credential stuffing specifically, you may need to wait 60s between batches for the IP rate limiter to reset.

```bash
curl -s -X POST http://localhost:5173/api/public/client-login/<workspaceId> \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"wrong"}'
```

### Turnstile CAPTCHA
Turnstile only activates when `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` env vars are set. Without them, the widget doesn't render and server-side verification is skipped. To test the full Turnstile flow, you need real Cloudflare Turnstile credentials.

### Structured Logging
Server logs use pino-pretty in development. Look for structured fields:
- `module` — which server module handled the request
- `requestId` — unique per-request UUID
- `method`, `path`, `status`, `duration` — HTTP request metadata
- `fingerprint` — SHA-256 hash (only on endpoints with fingerprinting middleware)

## Client Dashboard Testing

URL: `http://localhost:5173/client/<workspaceId>`

To create a test workspace and client user:
```bash
# Create workspace (if none exists)
curl -s -X POST http://localhost:5173/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Workspace"}'

# Create client user
curl -s -X POST http://localhost:5173/api/workspaces/<workspaceId>/client-users \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"TestPass123!","name":"Test User","role":"client_member"}'
```

The client dashboard auto-authenticates from session storage. To reset and see the login form, clear session storage and cookies in the browser.

## Common Gotchas

- **Browser session persists**: The client dashboard stores auth in `sessionStorage`. Clearing via DevTools console is needed to get back to the login form. The `browser_console` tool may report "Chrome is not in the foreground" — try clicking directly on the Chrome tab first.
- **Rate limiter state is in-memory**: Restarting the server resets all rate limit counters and credential stuffing lockouts.
- **No external API keys in dev**: Most features (GA4, GSC, Webflow, Stripe, OpenAI, Sentry) return errors/empty data without credentials. This is expected — the 400 errors in the console from `/api/public/aud-*` endpoints are normal.
- **Vite HMR picks up frontend changes automatically**: No need to restart the dev server for frontend code changes. Backend changes are picked up by tsx watch mode.

## Devin Secrets Needed

No secrets are required for basic local testing. Optional secrets for full integration testing:
- `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` — for Turnstile CAPTCHA testing
- `OPENAI_API_KEY` — for AI chat and content generation
- `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` — for payment flow testing
