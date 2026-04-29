# Testing asset-dashboard Locally

## Dev Server Setup

1. Install dependencies: `npm install`
2. Start the server: `npm run dev:server` (Express on port 3001)
3. Start the frontend: `npx vite --host 0.0.0.0` (Vite on port 5173)
4. Or use `npm run dev:all` to start both concurrently

The server creates a SQLite database and data directory at `~/.asset-dashboard/` on first run. Migrations run automatically.

## Authentication Mechanisms

### Admin Auth (HMAC token)
- Controlled by `APP_PASSWORD` env var
- If `APP_PASSWORD` is NOT set, admin auth is bypassed entirely (`POST /api/auth/login` returns `{ok: true}` with no token)
- If `APP_PASSWORD` IS set, login returns an **HMAC admin token** (not a JWT) — `HMAC-SHA256('admin', SESSION_SECRET)` where `SESSION_SECRET` defaults to `APP_PASSWORD`
- The token is stored in `localStorage` as `auth_token` and sent via `x-auth-token` header on all `/api/` requests (see `src/main.tsx` fetch patch)
- The global gate in `server/app.ts` accepts either a valid HMAC admin token OR a valid JWT user token

### Admin-Only Endpoints (requireAdminAuth)
Some system-level endpoints use `requireAdminAuth` middleware which accepts **ONLY HMAC admin tokens** and rejects JWT user tokens:
- `GET /api/admin/feature-flags` — list all flags with metadata
- `PUT /api/admin/feature-flags/:key` — toggle a flag override
- `GET /api/stripe/config` — view Stripe config (masked)
- `POST /api/stripe/config/keys` — save Stripe API keys
- `POST /api/stripe/config/products` — save product price mappings
- `DELETE /api/stripe/config` — clear Stripe config

To test these endpoints with curl when `APP_PASSWORD` is set:
```bash
# Compute the HMAC admin token
HMAC_TOKEN=$(echo -n "admin" | openssl dgst -sha256 -hmac "$APP_PASSWORD" | awk '{print $2}')

# Use it in requests
curl -H "x-auth-token: $HMAC_TOKEN" http://localhost:3001/api/admin/feature-flags
curl -H "x-auth-token: $HMAC_TOKEN" http://localhost:3001/api/stripe/config
```

### User-based JWT Auth
- Create the first owner user via `POST /api/auth/setup` with `{email, password, name}` (requires HMAC token in `x-auth-token` header when `APP_PASSWORD` is set)
- This returns a JWT token that can be used for WebSocket authentication and API calls
- Subsequent users are invited via admin workspace routes
- JWT tokens pass the global gate but are **rejected** by `requireAdminAuth` endpoints

### Client Portal Auth
- Client portal users authenticate via httpOnly cookies (`client_session_<wsId>` and `client_user_token_<wsId>`)
- They do NOT have `auth_token` in localStorage
- Shared password login: `POST /api/public/auth/<wsId>` with `{password}`
- Client user login: `POST /api/public/client-login/<wsId>` with `{email, password}`

## Creating Test Data

```bash
# When APP_PASSWORD is set, include the HMAC token in all admin API calls:
HMAC_TOKEN=$(echo -n "admin" | openssl dgst -sha256 -hmac "$APP_PASSWORD" | awk '{print $2}')

# Create a workspace
curl -X POST http://localhost:3001/api/workspaces \
  -H 'Content-Type: application/json' \
  -H "x-auth-token: $HMAC_TOKEN" \
  -d '{"name":"Test Workspace"}'

# Create a client user (use workspace ID from above)
curl -X POST http://localhost:3001/api/workspaces/<wsId>/client-users \
  -H 'Content-Type: application/json' \
  -H "x-auth-token: $HMAC_TOKEN" \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test User","role":"client_owner"}'

# Set client password on workspace
curl -X PATCH http://localhost:3001/api/workspaces/<wsId> \
  -H 'Content-Type: application/json' \
  -H "x-auth-token: $HMAC_TOKEN" \
  -d '{"clientPassword":"portal123"}'

# Create owner user (for JWT token)
curl -X POST http://localhost:3001/api/auth/setup \
  -H 'Content-Type: application/json' \
  -H "x-auth-token: $HMAC_TOKEN" \
  -d '{"email":"admin@test.com","password":"adminpass123","name":"Admin User"}'
```

## UI Navigation to Admin Panels

- **Settings Panel**: Click the gear icon in the bottom-left toolbar (or navigate to `/settings`)
- **Feature Flags**: Scroll down within the Settings panel — the Feature Flags section is near the bottom
- **Stripe/Payments**: Below the Feature Flags section at the very bottom of Settings
- **Note**: Toggling a feature flag may cause the Settings page to briefly go blank before re-rendering (pre-existing behavior)

### Seeding Recommendations Data

InsightsEngine on the client Health tab requires both audit snapshot data AND recommendations to render fully. You can seed recommendations directly via better-sqlite3:

```bash
cd /home/ubuntu/repos/asset-dashboard && node --input-type=commonjs -e "
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.env.HOME, '.asset-dashboard', 'dashboard.db'));
const recs = [
  { id: 'rec-1', title: 'Fix missing alt text', priority: 'fix_now', impact: 'high', effort: 'low', status: 'pending', category: 'accessibility', trafficAtRisk: 500, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];
const summary = { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 500 };
db.prepare('INSERT OR REPLACE INTO recommendation_sets (workspace_id, generated_at, recommendations, summary) VALUES (?, ?, ?, ?)').run('<wsId>', new Date().toISOString(), JSON.stringify(recs), JSON.stringify(summary));
db.close();
"
```

**Note:** InsightsEngine also requires `auditDetail` (from `/api/public/audit-detail/<wsId>`), which needs the workspace to have a `webflowSiteId` AND at least one audit snapshot in the `snapshots` table. Without audit data, the InsightsEngine renders only the empty state (Shield icon).

## DOM Inspection via CDP

The `computer` tool's console feature may intermittently fail to detect Chrome as the foreground window. For reliable DOM inspection, use Chrome DevTools Protocol (CDP) directly via WebSocket:

```bash
# 1. Find the page's WebSocket URL
curl -s http://localhost:29229/json | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if 'your-url-fragment' in p.get('url',''):
        print(p['webSocketDebuggerUrl'])
"

# 2. Evaluate JavaScript in the page via CDP
cd /home/ubuntu/repos/asset-dashboard && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('<webSocketDebuggerUrl>');
ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          const el = document.querySelector('your-selector');
          const cs = window.getComputedStyle(el);
          return JSON.stringify({ display: cs.display, width: cs.width });
        })()
      \`,
      returnByValue: true
    }
  }));
});
ws.on('message', (data) => {
  const resp = JSON.parse(data);
  if (resp.id === 1) { console.log(resp.result?.result?.value); ws.close(); }
});
setTimeout(() => { ws.close(); process.exit(1); }, 5000);
"
```

This approach is more reliable than Playwright `connectOverCDP()` which may timeout, and more reliable than the `computer` console tool which requires Chrome to be detected as the foreground window.

## Admin Page Navigation Paths

| Page | URL Pattern | Notes |
|------|-------------|-------|
| Dashboard Home | `/ws/<wsId>` | Shows Command Center |
| Workspace Settings | `/ws/<wsId>/workspace-settings` | Has tabs: Connections, Features, Publishing, etc. |
| Content Pipeline | `/ws/<wsId>/content-pipeline` | Has sub-tabs: Planner, Calendar, Briefs, Posts, Subscriptions |
| Content Manager | Content Pipeline → Posts tab | Renders within ContentPipeline, not a separate route |
| Features | `/features` | Global page (not workspace-scoped) |
| Site Audit | `/ws/<wsId>/seo-audit` | Requires webflowSiteId |
| Asset Audit | `/ws/<wsId>/media` | Under SITE HEALTH |
| Client Portal | `/client/<wsId>/<tab>` | Tabs: overview, performance, search, health, strategy, analytics, inbox, approvals, requests, content, plans, roi, brand |

## CSS Token Testing Notes

- **Border-radius normalization**: CSS normalizes `6px 12px 6px 12px` to `6px 12px` in computed styles (shorthand when opposite corners match). So `var(--radius-signature)` resolving to `6px 12px` in computed styles is correct.
- **Inline-flex blockification**: When an `inline-flex` element is a direct child of a flex container, the browser "blockifies" it to `flex` per CSS spec. This is expected — check the element's className for `inline-flex` rather than relying solely on computed `display`.
- **Token resolution check**: Verify CSS custom properties resolve by reading `getComputedStyle(document.documentElement).getPropertyValue('--token-name')`.
## Design System / CSS Token Testing

When testing design system changes (token migrations, `.t-*` class updates, `@layer` cascade changes):

### Use Playwright CDP for Computed Style Verification

The browser's CDP endpoint at `http://localhost:29229` is reliable for programmatic style checks. This avoids fighting with DevTools element picker focus issues.

```javascript
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP('http://localhost:29229');
const contexts = browser.contexts();
const page = contexts[0].pages().find(p => p.url().includes('your-page'));

// Check computed styles on specific elements
const styles = await page.$eval('.your-selector', el => {
  const cs = getComputedStyle(el);
  return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color };
});
console.log(styles);
await browser.close();
```

**Important**: Install Playwright browsers first: `npx playwright install chromium`

### Key Things to Verify for Token Migrations

1. **`@layer components` cascade**: When `.t-*` classes are in `@layer components`, Tailwind utility classes (like `font-semibold`, `leading-*`) should override them. Verify by checking that a `font-semibold` element using `t-body` has `font-weight: 600` (not `t-body`'s default 400).

2. **`!important` overrides**: Temporary `!important` rules in `src/index.css` boost `text-sm` → 15.5px, `text-xs` → 13.5px, `text-[11px]` → 13.5px. These protect ~195 unconverted files. Verify unconverted elements still render at boosted sizes.

3. **Token resolution**: CSS custom properties like `--brand-border`, `--surface-2`, `--radius-lg` should resolve to their `src/tokens.css` values. Check with `getComputedStyle(el).borderTopColor`, `.backgroundColor`, `.borderRadius`.

4. **Unlayered CSS conflicts**: Rules outside `@layer` (like `.font-bold { font-family: DIN Pro }` at line 37 of `src/index.css`) beat `@layer components` rules. This can cause font-family regressions. Check elements that combine `.t-*` + `.font-bold`.

### Styleguide Page

The styleguide at `/styleguide.html` uses `public/styleguide.css` (which imports `public/tokens.css`), NOT `src/index.css`. So `.t-*` class sizes on the styleguide may differ from the app if `src/index.css` has temporary `!important` overrides. This is expected during migration phases.

### Triggering UI Primitives

- **ConfirmDialog**: Only used in `ApprovalsTab.tsx` (client portal). Requires approval data in the workspace. If no approvals exist, ConfirmDialog cannot be triggered visually.
- **TierGate**: Requires a free-tier workspace with strategy data to show gated sections.
- **AIContextIndicator**: Requires a linked Webflow site for the KeywordStrategy page to render it.
- **Modal**: Can be triggered via Settings → various actions, or any page with overlay flows.

## WebSocket Testing

The WebSocket endpoint is at `ws://localhost:3001/ws`. Use the `ws` npm package (already in node_modules) for programmatic testing:

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws');

// Admin auth flow:
ws.on('open', () => {
  ws.send(JSON.stringify({ action: 'authenticate', token: '<jwt_token>' }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.action === 'authenticated' && msg.ok) {
    ws.send(JSON.stringify({ action: 'subscribe', workspaceId: '<wsId>' }));
  }
});

// Client portal flow (no auth needed):
ws.on('open', () => {
  ws.send(JSON.stringify({ action: 'subscribe', workspaceId: '<wsId>' }));
});
```

## Testing JWT_SECRET Production Check

```bash
NODE_ENV=production npx tsx server/index.ts
# Should crash with: "JWT_SECRET environment variable must be set in production"
```

## Build & Test Commands

- Build: `npx vite build`
- Tests: `npx vitest run` (005062+ tests across +339 test files)
- TypeScript check: `npm run typecheck` (uses `m run typecheck` (uses `tsc -b -b --noEmit` with project references; do NOT use plain `npx tsc --noEmit` against root tsconfig as it checks zero files)
- PR check: `npx tsx scripts/pr-c`; do NOT use plain `npx tsc --noEmit` as it checks zero files due to project references)
- PR check: `npx tsx scripts/pr-check.ts.ts`

## Known Limitations

- **No Webflow API**: Without `WEBFLOW_API_TOKEN`, site audits, page listing, and SEO features that depend on Webflow data won't work. SeoAudit tab will show empty state.
- **No OpenAI API**: Knowledge base generation, brand voice generation, and AI-powered features require `OPENAI_API_KEY`.
- **No Stripe**: Payment features require `STRIPE_SECRET_KEY`.
- **CDP port 29229**: Chrome DevTools Protocol is available at `http://localhost:29229`. Playwright `connectOverCDP` may timeout; prefer raw WebSocket CDP approach (see DOM Inspection section above).
- **Browser focus issues**: The `computer` tool's `console` action requires Chrome to be in the foreground. Use `wmctrl -a Chrome` to bring it forward, or prefer Playwright CDP scripts for programmatic checks.
- **Rate limiting**: The `publicApiLimiter` uses per-path mode. The `globalPublicLimiter` is IP-based at 200 req/min. Avoid changing `publicApiLimiter` to global mode as it shares the same bucket key format with `globalPublicLimiter`, causing double-counting.
- **Port conflicts**: If port 3001 is in use from a prior run, kill stale processes: `fuser -k 3001/tcp` (note: `lsof` may not be installed).

## Devin Secrets Needed

No secrets are required for basic local testing. Optional secrets for extended testing:
- `WEBFLOW_API_TOKEN` — for testing Webflow-dependent features
- `OPENAI_API_KEY` — for testing AI features
- `STRIPE_SECRET_KEY` — for testing payment flows
- `APP_PASSWORD` — for testing auth-gated flows (admin login, requireAdminAuth endpoints)
