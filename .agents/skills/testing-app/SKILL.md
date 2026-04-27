# Testing asset-dashboard Locally

## Dev Server Setup

1. Install dependencies: `npm install`
2. Start the server: `npm run dev:server` (Express on port 3001)
3. Start the frontend: `npx vite --host 0.0.0.0` (Vite on port 5173)
4. Or use `npm run dev:all` to start both concurrently

The server creates a SQLite database and data directory at `~/.asset-dashboard/` on first run. Migrations run automatically.

## Authentication Mechanisms

### Admin Auth
- Controlled by `APP_PASSWORD` env var
- If `APP_PASSWORD` is NOT set, admin auth is bypassed entirely (`POST /api/auth/login` returns `{ok: true}` with no token)
- If `APP_PASSWORD` IS set, login returns a JWT token in both the response body and an `auth_token` httpOnly cookie

### User-based JWT Auth
- Create the first owner user via `POST /api/auth/setup` with `{email, password, name}`
- This returns a JWT token that can be used for WebSocket authentication and API calls
- Subsequent users are invited via admin workspace routes

### Client Portal Auth
- Client portal users authenticate via httpOnly cookies (`client_session_<wsId>` and `client_user_token_<wsId>`)
- They do NOT have `auth_token` in localStorage
- Shared password login: `POST /api/public/auth/<wsId>` with `{password}`
- Client user login: `POST /api/public/client-login/<wsId>` with `{email, password}`

## Creating Test Data

```bash
# Create a workspace
curl -X POST http://localhost:3001/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Workspace"}'

# Create a client user (use workspace ID from above)
curl -X POST http://localhost:3001/api/workspaces/<wsId>/client-users \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test User","role":"client_owner"}'

# Set client password on workspace
curl -X PATCH http://localhost:3001/api/workspaces/<wsId> \
  -H 'Content-Type: application/json' \
  -d '{"clientPassword":"portal123"}'

# Create owner user (for JWT token)
curl -X POST http://localhost:3001/api/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","password":"adminpass123","name":"Admin User"}'
```

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
- Tests: `npx vitest run` (616+ tests across 56 files)
- TypeScript check: `npm run typecheck` (uses `tsc -b --noEmit`, NOT plain `npx tsc --noEmit`)
- PR check: `npx tsx scripts/pr-check.ts`

## Known Limitations

- **No Webflow API**: Without `WEBFLOW_API_TOKEN`, site audits, page listing, and SEO features that depend on Webflow data won't work. SeoAudit tab will show empty state.
- **No OpenAI API**: Knowledge base generation, brand voice generation, and AI-powered features require `OPENAI_API_KEY`.
- **No Stripe**: Payment features require `STRIPE_SECRET_KEY`.
- **Browser focus issues**: The `computer` tool's `console` action requires Chrome to be in the foreground. Use `wmctrl -a Chrome` to bring it forward, or prefer Playwright CDP scripts for programmatic checks.
- **Rate limiting**: The `publicApiLimiter` uses per-path mode. The `globalPublicLimiter` is IP-based at 200 req/min. Avoid changing `publicApiLimiter` to global mode as it shares the same bucket key format with `globalPublicLimiter`, causing double-counting.

## Devin Secrets Needed

No secrets are required for basic local testing. Optional secrets for extended testing:
- `WEBFLOW_API_TOKEN` — for testing Webflow-dependent features
- `OPENAI_API_KEY` — for testing AI features
- `STRIPE_SECRET_KEY` — for testing payment flows
