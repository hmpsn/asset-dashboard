# Multi-Location Business Match Reconciliation — Design Spec

**Date:** 2026-05-22  
**Status:** Approved for implementation  
**Roadmap item:** `intel-quality-multi-location-business-match`

---

## Problem

`evaluateLocalBusinessMatch` identifies a workspace against local pack results using a single identity: the primary domain, name, phone, and street address from `workspace.businessProfile`. For multi-location businesses (e.g. Swish Dental with Downtown, Midtown, and East Austin branches), only the primary location can ever match. The other locations appear as third-party competitors.

**Observed impact on Swish:** "Swish Dental Downtown" flagged as competitor in 31 snapshots, "Swish Dental — Midtown" in 15. Verified match rate drops to 3–4% across 200 snapshots when the real rate should be 50%+. This is the single biggest credibility gap in local SEO reporting.

---

## Goals

1. Allow admins to register all physical locations for a workspace
2. Match against any configured location — `businessFound = true` if ANY location matches
3. Scrub client-owned locations from `top_competitors` in all snapshots
4. Correct existing historical snapshot data via a background job
5. Design the location model to eventually support per-location markets, keywords, and page targets

---

## Non-Goals (this spec)

- Per-location keyword strategy or market assignment (deferred)
- GBP OAuth integration or profile health (separate roadmap item)
- Client-facing location UI
- Automatic location discovery from provider data

---

## Mental Model

A workspace represents one **brand** with multiple **physical locations**. Each location is a branch of the same business — same strategy, but eventually its own service landing pages and local targeting. The `client_locations` table is the foundation for that future, not just a matching utility.

---

## Delivery: Two PRs

### PR1 — Server layer (no UI)
Full data model, match logic, backfill job, API endpoints, `LocalSeoSlice` update. Verify data quality on staging with Swish before investing in UI.

### PR2 — UI layer
Settings "Locations" tab (canonical) + Local SEO drawer shortcut. Builds on the stable PR1 API.

---

## PR1: Data Model

### New table: `client_locations`

Migration file: `server/db/migrations/099-client-locations.sql`

```sql
CREATE TABLE IF NOT EXISTS client_locations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  phone TEXT,
  street_address TEXT,
  city TEXT,
  state_or_region TEXT,
  country TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_review',  -- 'needs_review' | 'confirmed'
  gbp_place_id TEXT,

  -- Future per-location strategy fields (nullable until those features land)
  primary_market_id TEXT,       -- FK to local_seo_markets
  page_target_path TEXT,        -- e.g. "/downtown-austin-dentist"
  page_target_keyword_id TEXT,  -- FK to page_keywords

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_locations_workspace
  ON client_locations(workspace_id);
```

### Snapshot schema addition

```sql
ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_id TEXT;

ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_name TEXT;
```

These record which specific location matched in each snapshot for display in the UI ("Matched: Swish Dental Downtown — rank 2").

### TypeScript type

```typescript
// shared/types/local-seo.ts
export interface ClientLocation {
  id: string;
  workspaceId: string;
  name: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary: boolean;
  status: 'needs_review' | 'confirmed';
  gbpPlaceId?: string;
  // Future fields
  primaryMarketId?: string;
  pageTargetPath?: string;
  pageTargetKeywordId?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## PR1: Match Logic

### Updated signature

```typescript
// server/local-seo.ts
export function evaluateLocalBusinessMatch(
  locations: ClientLocation[],
  results: LocalVisibilityBusinessResult[]
): {
  confidence: LocalBusinessMatchConfidence;
  found: boolean;
  rank?: number;
  reason?: string;
  matchedLocationId?: string;
  matchedLocationName?: string;
}
```

### Behaviour changes

1. **Iterate all locations** — run existing domain/name/phone/street matching logic for each `ClientLocation`. Return the highest-confidence match found across any location.

2. **`top_competitors` scrubbing** — after evaluating matches, filter `providerResult.results` to exclude any result that matched ANY configured location before storing in `topCompetitors`. Client-owned locations never appear as competitors.

3. **Fallback for unconfigured workspaces** — if `locations` array is empty, construct a single synthetic `ClientLocation` from `workspace.businessProfile` + `workspace.liveDomain`. Behaviour is identical to the current implementation for all existing workspaces with no configured locations.

### Caller change

`snapshotFromProviderResult` currently passes `workspace` directly. It will accept `locations: ClientLocation[]` loaded once per refresh job run (not per snapshot). The synthetic fallback ensures zero breaking change for single-location workspaces.

---

## PR1: Backfill Job

**Job type:** `local-seo-location-backfill`

Add to `BACKGROUND_JOB_TYPES` in `shared/types/background-jobs.ts`:
```typescript
'local-seo-location-backfill': {
  label: 'Recalculating local match history',
  cancellable: false,
  resultBehavior: 'ephemeral',
}
```

### Execution

1. Load all `client_locations` for the workspace
2. Load all `local_visibility_snapshots` in batches of 100
3. For each snapshot, re-run `evaluateLocalBusinessMatch` against the stored `top_competitors` JSON (no provider calls — re-interpreting stored raw results with better identity knowledge)
4. Update: `business_found`, `business_match_confidence`, `business_match_reason`, `local_rank`, `matched_location_id`, `matched_location_name`, `top_competitors` (scrubbed)
5. Write each batch in a single `db.transaction()`
6. Emit progress every 100 snapshots for `TaskPanel`
7. Broadcast `LOCAL_SEO_UPDATED` on completion

### Trigger

Enqueued by every mutating locations endpoint (POST, PUT, DELETE). If a backfill job is already running for the workspace, cancel it and restart with the latest location set.

---

## PR1: API Endpoints

All under `/api/local-seo/:workspaceId/locations`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all configured locations. Returns empty array if none configured — UI handles auto-seed client-side. |
| `POST` | `/` | Create a location. Triggers backfill job. |
| `PUT` | `/:locationId` | Update a location. Triggers backfill job. |
| `DELETE` | `/:locationId` | Delete a location. Blocks if it's the last location and snapshots exist (return 409 with explanation). Triggers backfill job. |

All endpoints use `requireWorkspaceAccess` middleware (admin-only). Zod validation on request bodies. Standard `{ error: string }` error shape.

### Request body schema (POST/PUT)

```typescript
const clientLocationSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  streetAddress: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  stateOrRegion: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  isPrimary: z.boolean().optional().default(false),
  status: z.enum(['needs_review', 'confirmed']).optional().default('needs_review'),
  gbpPlaceId: z.string().optional().or(z.literal('')),
});
```

---

## PR1: LocalSeoSlice Update

Add `locations: ClientLocation[]` to `LocalSeoSlice` in `shared/types/intelligence.ts`. `assembleLocalSeo()` reads `client_locations` where `workspace_id = ? AND status = 'confirmed'`. AdminChat and generation builders gain location names, addresses, and page target context.

---

## PR2: Settings — Locations Tab

**Location:** Workspace Settings, new "Locations" tab alongside Business Profile and Intelligence Profile.

**Auto-seed behaviour:** On first load with an empty list, the UI synthesises a pre-filled form from `workspace.businessProfile` (name, phone, address) and `workspace.liveDomain`. Shows amber banner: *"We've pre-filled your primary location from your business profile — confirm the details before adding branches."* Admin clicks "Confirm" → `POST /locations` with `{ status: 'confirmed', isPrimary: true, ...prefilled }`.

**Location row states:**
- `needs_review` — amber border, "Confirm" + "Edit" actions
- `confirmed` — neutral border, "Edit" + "Remove" actions

**Add button:** "Add another location" dashed button at bottom of list.

**Edit form:** Inline or slide-over (consistent with existing settings patterns) with fields: Name, Domain, Phone, Street address, City, State/Region, Country, GBP Place ID (optional, labelled "For future Google Business Profile integration").

---

## PR2: Local SEO Drawer Shortcut

In `LocalSeoMarketSetupDrawer`, add a "Business locations" row above the markets list:

- **Configured state:** "N locations configured — used for local match detection" with "Manage in Settings ↗" link
- **Needs-review state:** Amber variant — "1 location needs review — confirm to improve match accuracy" with "Review ↗" link
- **Empty state:** "No locations configured — your primary domain is used for matching" with "Add locations ↗" link

Deep-links to `/ws/:workspaceId/settings?tab=locations`.

---

## Testing

**PR1:**
- Unit: `evaluateLocalBusinessMatch` with multi-location array — highest confidence wins, correct location ID returned, client locations scrubbed from competitors
- Unit: Fallback to synthetic location when array is empty — identical behaviour to current
- Integration: `POST /locations` → backfill job enqueued → snapshots updated correctly
- Integration: `DELETE /locations` last-location guard returns 409

**PR2:**
- Component: auto-seed banner appears on empty list, confirm CTA calls POST with correct payload
- Component: deep-link `?tab=locations` in settings wires correctly (tab deep-link contract)

---

## Migration Notes

- No existing snapshot data is broken — new columns are nullable, backfill only runs when locations are configured
- `evaluateLocalBusinessMatch` fallback ensures all existing callers work without change until they opt into locations
- `client_locations` future fields (`primary_market_id`, `page_target_path`, `page_target_keyword_id`) are nullable and ignored by all current readers — safe to add now, wire up in per-location strategy sprint
