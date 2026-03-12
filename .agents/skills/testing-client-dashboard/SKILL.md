# Testing the Asset Dashboard Client Portal

## Dev Environment Setup

1. Start backend: `npm run dev:server` (runs on port 3001)
2. Start frontend: `npm run dev` (Vite on port 5173, proxies `/api` to backend)
3. Client dashboard URL: `http://localhost:5173/client/{workspaceId}`
4. Admin dashboard URL: `http://localhost:5173/` (only accessible when no `APP_PASSWORD` env var is set; otherwise requires auth)

## Workspace Configuration

- Workspace config lives in `~/toUpload/.workspaces.json`
- Must include `clientPortalEnabled: true` for client portal access
- If no `clientPassword` is set, the portal is open (no auth required)
- Backend must be restarted after changing workspace config (Vite HMR handles frontend changes)

## Sample Data Locations

| Data Type | Path | Notes |
|-----------|------|-------|
| Approvals | `~/.asset-dashboard/approvals/{workspaceId}.json` | Batch format with items array |
| Content Requests | `~/.asset-dashboard/content-requests/{workspaceId}.json` | Array of request objects |
| Activity Log | `~/toUpload/.activity-log.json` | Array with type, title, description, timestamp |
| Keyword Strategy | In workspace config under `keywordStrategy` | Contains pages, contentGaps, quickWins |
| Content Pricing | In workspace config under `contentPricing` | `brief` and `fullPost` prices |

## Feature Data Dependencies

Some features only render when specific data exists:

| Feature | Requires | How to Enable |
|---------|----------|---------------|
| Date range selector | `overview` or `ga4Overview` data | Need GSC or GA4 property connected |
| Performance TabBar (Search/Analytics toggle) | `hasSearch \|\| hasAnalytics` | Need `gscPropertyUrl` or `ga4PropertyId` in workspace |
| StatCards in AnalyticsTab | `ga4Overview` data | Need GA4 property connected |
| Skeleton loading states | Brief loading delay | Throttle network in DevTools to observe |
| Action items banner count | Pending approvals or content requests | Create sample approval/content data |

## Admin Dashboard Access

- When `APP_PASSWORD` is not set, admin auth is bypassed (`/api/auth/check` returns `{ required: false }`)
- However, if only one workspace exists, the admin dashboard at `/` may auto-redirect to the client view
- To test admin-specific features (like sidebar), you may need multiple workspaces or verify via code inspection

## Known Issues

- `react-window` v2.x changed its API: `VariableSizeList` no longer exists, replaced with `List`. If HealthTab fails to render, check the import in `src/components/client/HealthTab.tsx` line 2. This is a pre-existing issue on main.
- Some API endpoints return 400 errors when no audit data exists (e.g., `/api/public/aud_summary/`, `/api/public/aud_detail/`). These are expected when no site audit has been run.

## Testing Checklist

1. Overview tab: Action items banner, content opportunities sidebar, activity timeline
2. Performance tab: Empty state or Search/Analytics toggle (data-dependent)
3. Inbox tab: Approval batches, batch approve, content requests
4. SEO Strategy tab: Content gaps with CTAs, quick wins, keyword map
5. Plans tab: Pricing tiers render correctly
6. ROI tab: Traffic value cards and page breakdown
7. Site Health tab: Empty state or health score (data-dependent)
8. Feedback button: Bottom-left position, no overlap with chat
9. ARIA roles: Inspect DOM for role="tablist", role="tab", aria-selected on nav
10. Mobile: Use DevTools device emulation to test responsive layouts

## Devin Secrets Needed

None required for basic testing. The client portal is accessible without authentication when `clientPortalEnabled: true` and no `clientPassword` is set.

For admin dashboard testing with auth, `APP_PASSWORD` would be needed as an environment variable.
