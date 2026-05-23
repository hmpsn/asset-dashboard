# Multi-Location Business Match — PR1: Server Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the multi-location business match problem at the server layer — `client_locations` table, updated match logic, backfill job, and API endpoints — so Swish Dental's own branch locations stop appearing as competitors in local visibility snapshots.

**Architecture:** New `client_locations` DB table (full future-shaped schema) + pure CRUD module. `evaluateLocalBusinessMatch` is refactored to accept a `ClientLocation[]` array and return the best match across all locations, with client-owned results scrubbed from `top_competitors`. A background backfill job re-evaluates all existing snapshots against the new location set. Four REST endpoints expose CRUD to the admin frontend (built in PR2). Zero breaking change for single-location workspaces — an empty locations array falls back to a synthetic location built from `workspace.businessProfile`.

**Tech Stack:** TypeScript strict, better-sqlite3 with `createStmtCache`, Zod validation, existing `createJob`/`updateJob`/`runLocalSeoRefreshJob` patterns, existing `broadcastToWorkspace` + `WS_EVENTS.LOCAL_SEO_UPDATED`.

**Spec:** `docs/superpowers/specs/2026-05-22-multi-location-business-match-design.md`

---

## Task 1: Shared types

**Files:**
- Modify: `shared/types/local-seo.ts`
- Modify: `shared/types/background-jobs.ts`
- Modify: `shared/types/intelligence.ts`

- [ ] **Step 1: Add `ClientLocation` interface to `shared/types/local-seo.ts`**

Open `shared/types/local-seo.ts`. Add this interface after the existing `LocalSeoMarket` interface:

```typescript
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
  /** Future: FK to local_seo_markets. Unused until per-location strategy sprint. */
  primaryMarketId?: string;
  /** Future: e.g. "/downtown-austin-dentist". Unused until per-location strategy sprint. */
  pageTargetPath?: string;
  /** Future: FK to page_keywords. Unused until per-location strategy sprint. */
  pageTargetKeywordId?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `matchedLocationId` and `matchedLocationName` to `LocalVisibilitySnapshot` in `shared/types/local-seo.ts`**

Find the `LocalVisibilitySnapshot` interface. Add two optional fields at the end of the interface body, before the closing `}`:

```typescript
  /** ID of the client_locations row that matched this result. Undefined for pre-backfill snapshots. */
  matchedLocationId?: string;
  /** Human-readable name of the matching location, e.g. "Swish Dental Downtown". */
  matchedLocationName?: string;
```

- [ ] **Step 3: Add `LOCAL_SEO_LOCATION_BACKFILL` job type to `shared/types/background-jobs.ts`**

Open `shared/types/background-jobs.ts`. In the `BACKGROUND_JOB_TYPES` const object, add after the `LOCAL_SEO_REFRESH` entry:

```typescript
  LOCAL_SEO_LOCATION_BACKFILL: 'local-seo-location-backfill',
```

In the `BACKGROUND_JOB_METADATA` object (or wherever the metadata map is defined), add the entry for the new type. The key is `BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL`. Read the existing pattern — each entry has `label`, `cancellable`, and `resultBehavior`. Add:

```typescript
  [BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL]: {
    label: 'Recalculating local match history',
    cancellable: false,
    resultBehavior: 'ephemeral' as const,
  },
```

- [ ] **Step 4: Add `locations` field to `LocalSeoSlice` in `shared/types/intelligence.ts`**

Open `shared/types/intelligence.ts`. Find the `LocalSeoSlice` interface (around line 326). Add `locations` as the first field:

```typescript
export interface LocalSeoSlice {
  /** Configured client locations for this workspace. Only 'confirmed' locations are included. */
  locations: ReadonlyArray<{
    id: string;
    name: string;
    isPrimary: boolean;
    city?: string;
    stateOrRegion?: string;
    pageTargetPath?: string;
  }>;
  /** Whether the local-seo-visibility feature flag is enabled. */
  enabled: boolean;
  // ... rest of existing fields unchanged
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. Fix any errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add shared/types/local-seo.ts shared/types/background-jobs.ts shared/types/intelligence.ts
git commit -m "feat(local-seo): shared types for multi-location match — ClientLocation, backfill job, LocalSeoSlice.locations"
```

---

## Task 2: DB Migration

**Files:**
- Create: `server/db/migrations/099-client-locations.sql`

- [ ] **Step 1: Write the migration**

```bash
# Create the file
touch server/db/migrations/099-client-locations.sql
```

Write the following content to `server/db/migrations/099-client-locations.sql`:

```sql
-- client_locations: multi-location business identity for workspace match detection.
-- Full future-shaped schema: future per-location strategy fields are nullable until
-- the per-location strategy sprint wires them up.
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
  status TEXT NOT NULL DEFAULT 'needs_review',
  gbp_place_id TEXT,
  -- Future per-location strategy fields (unused until per-location strategy sprint)
  primary_market_id TEXT,
  page_target_path TEXT,
  page_target_keyword_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_locations_workspace
  ON client_locations(workspace_id);

-- Add matched location columns to existing snapshots table.
-- Nullable: pre-backfill snapshots will have NULL here until the backfill job runs.
ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_id TEXT;

ALTER TABLE local_visibility_snapshots
  ADD COLUMN matched_location_name TEXT;
```

- [ ] **Step 2: Verify migration runs cleanly**

```bash
# The dev server auto-applies pending migrations on start — start it and check logs
npm run dev:server 2>&1 | head -40
```

Expected: server starts, migration 099 appears in logs with "applied" or similar. No errors. Stop the server with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/099-client-locations.sql
git commit -m "feat(local-seo): migration 099 — client_locations table + snapshot matched_location columns"
```

---

## Task 3: client-locations.ts CRUD module

**Files:**
- Create: `server/client-locations.ts`

This module is pure DB CRUD — no imports from `server/local-seo.ts` (to avoid circular deps). The backfill job lives in `server/local-seo.ts` which imports from here.

- [ ] **Step 1: Write the failing test for `getClientLocations` returns empty array when none configured**

Create `tests/unit/client-locations-crud.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  createClientLocation,
  deleteClientLocation,
  getClientLocationById,
  getClientLocations,
  countClientLocations,
  updateClientLocation,
} from '../../server/client-locations.js';

let workspaceId: string;

beforeEach(async () => {
  const ws = createWorkspace({ name: 'Test Workspace', gscPropertyUrl: 'https://test.com' });
  workspaceId = ws.id;
});

afterEach(() => {
  deleteWorkspace(workspaceId);
});

describe('getClientLocations', () => {
  it('returns empty array when no locations configured', () => {
    expect(getClientLocations(workspaceId)).toEqual([]);
  });
});

describe('createClientLocation', () => {
  it('creates a location with required fields', () => {
    const loc = createClientLocation(workspaceId, { name: 'Main Office' });
    expect(loc.id).toBeTruthy();
    expect(loc.name).toBe('Main Office');
    expect(loc.workspaceId).toBe(workspaceId);
    expect(loc.status).toBe('needs_review');
    expect(loc.isPrimary).toBe(false);
  });

  it('creates a confirmed primary location', () => {
    const loc = createClientLocation(workspaceId, {
      name: 'Downtown',
      domain: 'example.com',
      phone: '5125550100',
      streetAddress: '123 Main St',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      status: 'confirmed',
    });
    expect(loc.isPrimary).toBe(true);
    expect(loc.status).toBe('confirmed');
    expect(loc.domain).toBe('example.com');
    expect(loc.phone).toBe('5125550100');
  });
});

describe('updateClientLocation', () => {
  it('updates specified fields, leaves others unchanged', () => {
    const loc = createClientLocation(workspaceId, { name: 'Original' });
    const updated = updateClientLocation(loc.id, workspaceId, { name: 'Updated', status: 'confirmed' });
    expect(updated?.name).toBe('Updated');
    expect(updated?.status).toBe('confirmed');
    expect(updated?.isPrimary).toBe(false); // unchanged
  });

  it('returns null for unknown id', () => {
    expect(updateClientLocation('nonexistent', workspaceId, { name: 'X' })).toBeNull();
  });
});

describe('deleteClientLocation', () => {
  it('deletes an existing location', () => {
    const loc = createClientLocation(workspaceId, { name: 'Branch' });
    expect(deleteClientLocation(loc.id, workspaceId)).toBe(true);
    expect(getClientLocationById(loc.id, workspaceId)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    expect(deleteClientLocation('nonexistent', workspaceId)).toBe(false);
  });
});

describe('countClientLocations', () => {
  it('counts configured locations', () => {
    expect(countClientLocations(workspaceId)).toBe(0);
    createClientLocation(workspaceId, { name: 'A' });
    createClientLocation(workspaceId, { name: 'B' });
    expect(countClientLocations(workspaceId)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/client-locations-crud.test.ts
```

Expected: FAIL — "Cannot find module '../../server/client-locations.js'"

- [ ] **Step 3: Implement `server/client-locations.ts`**

Create `server/client-locations.ts`:

```typescript
import { randomUUID } from 'crypto';
import { db } from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import type { ClientLocation } from '../shared/types/local-seo.js';

const log = createLogger('client-locations');

interface LocationRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state_or_region: string | null;
  country: string | null;
  is_primary: number;
  status: string;
  gbp_place_id: string | null;
  primary_market_id: string | null;
  page_target_path: string | null;
  page_target_keyword_id: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  list: db.prepare(
    'SELECT * FROM client_locations WHERE workspace_id = ? ORDER BY is_primary DESC, created_at ASC'
  ),
  getById: db.prepare(
    'SELECT * FROM client_locations WHERE id = ? AND workspace_id = ?'
  ),
  insert: db.prepare(`
    INSERT INTO client_locations (
      id, workspace_id, name, domain, phone, street_address, city,
      state_or_region, country, is_primary, status, gbp_place_id,
      primary_market_id, page_target_path, page_target_keyword_id,
      created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @name, @domain, @phone, @street_address, @city,
      @state_or_region, @country, @is_primary, @status, @gbp_place_id,
      @primary_market_id, @page_target_path, @page_target_keyword_id,
      @created_at, @updated_at
    )
  `),
  update: db.prepare(`
    UPDATE client_locations
    SET name = @name, domain = @domain, phone = @phone,
        street_address = @street_address, city = @city,
        state_or_region = @state_or_region, country = @country,
        is_primary = @is_primary, status = @status, gbp_place_id = @gbp_place_id,
        primary_market_id = @primary_market_id, page_target_path = @page_target_path,
        page_target_keyword_id = @page_target_keyword_id, updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  deleteById: db.prepare(
    'DELETE FROM client_locations WHERE id = ? AND workspace_id = ?'
  ),
  count: db.prepare(
    'SELECT COUNT(*) as count FROM client_locations WHERE workspace_id = ?'
  ),
}));

function rowToLocation(row: LocationRow): ClientLocation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    domain: row.domain ?? undefined,
    phone: row.phone ?? undefined,
    streetAddress: row.street_address ?? undefined,
    city: row.city ?? undefined,
    stateOrRegion: row.state_or_region ?? undefined,
    country: row.country ?? undefined,
    isPrimary: row.is_primary === 1,
    status: row.status as ClientLocation['status'],
    gbpPlaceId: row.gbp_place_id ?? undefined,
    primaryMarketId: row.primary_market_id ?? undefined,
    pageTargetPath: row.page_target_path ?? undefined,
    pageTargetKeywordId: row.page_target_keyword_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getClientLocations(workspaceId: string): ClientLocation[] {
  const rows = stmts().list.all(workspaceId) as LocationRow[];
  return rows.map(rowToLocation);
}

export function getClientLocationById(
  id: string,
  workspaceId: string
): ClientLocation | undefined {
  const row = stmts().getById.get(id, workspaceId) as LocationRow | undefined;
  return row ? rowToLocation(row) : undefined;
}

export interface CreateClientLocationInput {
  name: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary?: boolean;
  status?: ClientLocation['status'];
  gbpPlaceId?: string;
}

export function createClientLocation(
  workspaceId: string,
  input: CreateClientLocationInput
): ClientLocation {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    name: input.name,
    domain: input.domain ?? null,
    phone: input.phone ?? null,
    street_address: input.streetAddress ?? null,
    city: input.city ?? null,
    state_or_region: input.stateOrRegion ?? null,
    country: input.country ?? null,
    is_primary: input.isPrimary ? 1 : 0,
    status: input.status ?? 'needs_review',
    gbp_place_id: input.gbpPlaceId ?? null,
    primary_market_id: null,
    page_target_path: null,
    page_target_keyword_id: null,
    created_at: now,
    updated_at: now,
  });
  return getClientLocationById(id, workspaceId)!;
}

export interface UpdateClientLocationInput {
  name?: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary?: boolean;
  status?: ClientLocation['status'];
  gbpPlaceId?: string;
}

export function updateClientLocation(
  id: string,
  workspaceId: string,
  input: UpdateClientLocationInput
): ClientLocation | null {
  const existing = getClientLocationById(id, workspaceId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const str = (v: string | undefined, fallback: string | undefined) =>
    v !== undefined ? (v || null) : (fallback ?? null);
  stmts().update.run({
    id,
    workspace_id: workspaceId,
    name: input.name ?? existing.name,
    domain: str(input.domain, existing.domain),
    phone: str(input.phone, existing.phone),
    street_address: str(input.streetAddress, existing.streetAddress),
    city: str(input.city, existing.city),
    state_or_region: str(input.stateOrRegion, existing.stateOrRegion),
    country: str(input.country, existing.country),
    is_primary:
      input.isPrimary !== undefined
        ? input.isPrimary ? 1 : 0
        : existing.isPrimary ? 1 : 0,
    status: input.status ?? existing.status,
    gbp_place_id: str(input.gbpPlaceId, existing.gbpPlaceId),
    primary_market_id: existing.primaryMarketId ?? null,
    page_target_path: existing.pageTargetPath ?? null,
    page_target_keyword_id: existing.pageTargetKeywordId ?? null,
    updated_at: now,
  });
  return getClientLocationById(id, workspaceId)!;
}

export function deleteClientLocation(id: string, workspaceId: string): boolean {
  const info = stmts().deleteById.run(id, workspaceId);
  return info.changes > 0;
}

export function countClientLocations(workspaceId: string): number {
  const row = stmts().count.get(workspaceId) as { count: number };
  return row.count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/client-locations-crud.test.ts
```

Expected: all 9 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add server/client-locations.ts tests/unit/client-locations-crud.test.ts
git commit -m "feat(local-seo): client-locations CRUD module + unit tests"
```

---

## Task 4: Update `evaluateLocalBusinessMatch` and snapshot machinery in `server/local-seo.ts`

**Files:**
- Modify: `server/local-seo.ts`

This task updates:
1. `evaluateLocalBusinessMatch` — new signature accepting `ClientLocation[]`, returns best match with `matchedLocationId`/`matchedLocationName`
2. Helper `getEffectiveLocations` — synthetic fallback for unconfigured workspaces
3. `snapshotFromProviderResult` — uses locations instead of workspace, scrubs owned locations from `top_competitors`
4. `stmts()` — adds `updateSnapshotMatch`, updates `insertSnapshot` to include new columns
5. `rowToSnapshot` — maps new columns

- [ ] **Step 1: Write failing unit tests for the updated match logic**

Create `tests/unit/local-seo-multi-location-match.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateLocalBusinessMatch } from '../../server/local-seo.js';
import type { ClientLocation } from '../../shared/types/local-seo.js';
import type { LocalVisibilityBusinessResult } from '../../shared/types/local-seo.js';

function makeLocation(overrides: Partial<ClientLocation> = {}): ClientLocation {
  return {
    id: 'loc-1',
    workspaceId: 'ws-1',
    name: 'Acme Dental',
    domain: 'acmedental.com',
    phone: '5125550100',
    streetAddress: '123 Main St',
    isPrimary: true,
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<LocalVisibilityBusinessResult> = {}): LocalVisibilityBusinessResult {
  return {
    rank: 1,
    title: 'Unknown Competitor',
    domain: 'competitor.com',
    url: 'https://competitor.com',
    address: '456 Other St',
    phone: '5125559999',
    ...overrides,
  };
}

describe('evaluateLocalBusinessMatch — multi-location', () => {
  it('returns NOT_FOUND for empty results', () => {
    const result = evaluateLocalBusinessMatch([makeLocation()], []);
    expect(result.found).toBe(false);
    expect(result.confidence).toBe('not_found');
  });

  it('returns NOT_FOUND when no location matches', () => {
    const result = evaluateLocalBusinessMatch(
      [makeLocation()],
      [makeResult({ domain: 'competitor.com', title: 'Competitor Dental' })]
    );
    expect(result.found).toBe(false);
  });

  it('VERIFIED: domain + name match sets matchedLocationId', () => {
    const loc = makeLocation({ id: 'loc-downtown', name: 'Acme Dental' });
    const result = evaluateLocalBusinessMatch(
      [loc],
      [makeResult({ domain: 'acmedental.com', title: 'Acme Dental', rank: 2 })]
    );
    expect(result.found).toBe(true);
    expect(result.confidence).toBe('verified');
    expect(result.rank).toBe(2);
    expect(result.matchedLocationId).toBe('loc-downtown');
    expect(result.matchedLocationName).toBe('Acme Dental');
  });

  it('matches second location when first does not match', () => {
    const loc1 = makeLocation({ id: 'loc-1', name: 'Acme Downtown', domain: 'downtown.acme.com' });
    const loc2 = makeLocation({ id: 'loc-2', name: 'Acme Midtown', domain: 'midtown.acme.com' });
    const result = evaluateLocalBusinessMatch(
      [loc1, loc2],
      [makeResult({ domain: 'midtown.acme.com', title: 'Acme Midtown', rank: 1 })]
    );
    expect(result.found).toBe(true);
    expect(result.matchedLocationId).toBe('loc-2');
    expect(result.matchedLocationName).toBe('Acme Midtown');
  });

  it('returns highest confidence match across locations', () => {
    const loc1 = makeLocation({ id: 'loc-1', name: 'Acme', domain: undefined });
    const loc2 = makeLocation({ id: 'loc-2', name: 'Acme Downtown', domain: 'acmedental.com' });
    const results = [
      makeResult({ domain: 'acmedental.com', title: 'Acme Downtown', rank: 1 }),
    ];
    const result = evaluateLocalBusinessMatch([loc1, loc2], results);
    // loc2 should produce VERIFIED (domain + name), loc1 might produce POSSIBLE_MATCH (name only)
    expect(result.confidence).toBe('verified');
    expect(result.matchedLocationId).toBe('loc-2');
  });

  it('fallback: empty locations array returns NOT_FOUND (caller must provide synthetic)', () => {
    const result = evaluateLocalBusinessMatch(
      [],
      [makeResult({ domain: 'acmedental.com', title: 'Acme Dental' })]
    );
    expect(result.found).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
npx vitest run tests/unit/local-seo-multi-location-match.test.ts
```

Expected: FAIL — type errors because `evaluateLocalBusinessMatch` still takes `Workspace` not `ClientLocation[]`.

- [ ] **Step 3: Add import for ClientLocation at top of `server/local-seo.ts`**

Open `server/local-seo.ts`. Find the existing imports. Add the following import (with existing imports at the top of the file — never mid-file):

```typescript
import { getClientLocations } from './client-locations.js';
import type { ClientLocation } from '../shared/types/local-seo.js';
```

Note: `ClientLocation` may already be imported from `shared/types/local-seo.ts` since that's where you added it. If `local-seo.ts` imports from `shared/types/local-seo.ts` already, just add `ClientLocation` to the existing named import.

- [ ] **Step 4: Add `confidencePriority` helper and `getEffectiveLocations` to `server/local-seo.ts`**

Find the `evaluateLocalBusinessMatch` function (around line 839). Add these two helpers **directly above** it:

```typescript
/** Maps confidence level to a numeric priority for comparing matches. Higher = better. */
function confidencePriority(c: LocalBusinessMatchConfidence): number {
  switch (c) {
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED: return 3;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH: return 2;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH: return 1;
    default: return 0;
  }
}

/**
 * Returns the configured client locations for a workspace.
 * Falls back to a single synthetic location built from workspace identity so
 * evaluateLocalBusinessMatch behaviour is unchanged for unconfigured workspaces.
 */
function getEffectiveLocations(workspace: Workspace): ClientLocation[] {
  const configured = getClientLocations(workspace.id);
  if (configured.length > 0) return configured;
  return [{
    id: `synthetic-${workspace.id}`,
    workspaceId: workspace.id,
    name: workspace.name,
    domain: workspace.liveDomain ?? workspace.gscPropertyUrl ?? undefined,
    phone: workspace.businessProfile?.phone ?? undefined,
    streetAddress: workspace.businessProfile?.address?.street ?? undefined,
    isPrimary: true,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];
}
```

- [ ] **Step 5: Replace `evaluateLocalBusinessMatch` with the multi-location version**

Replace the entire existing `evaluateLocalBusinessMatch` function body (lines ~839–871) with:

```typescript
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
} {
  if (results.length === 0 || locations.length === 0) {
    return { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND, found: false, reason: 'No local pack results returned' };
  }

  let best: {
    confidence: LocalBusinessMatchConfidence;
    found: boolean;
    rank?: number;
    reason?: string;
    matchedLocationId?: string;
    matchedLocationName?: string;
  } | null = null;

  outer: for (const location of locations) {
    const locDomain = cleanDomain(location.domain);
    const locName = normalizeText(location.name);
    const locPhone = normalizePhone(location.phone);
    const locStreet = normalizeText(location.streetAddress);

    for (const result of results) {
      const resultDomain = cleanDomain(result.domain ?? result.url);
      const title = normalizeText(result.title);
      const address = normalizeText(result.address);
      const phone = normalizePhone(result.phone);
      const domainMatch = Boolean(locDomain && resultDomain && resultDomain === locDomain);
      const phoneMatch = Boolean(locPhone && phone && locPhone === phone);
      const nameMatch = Boolean(locName && title && (title.includes(locName) || locName.includes(title)));
      const streetMatch = Boolean(locStreet && address.includes(locStreet));

      let candidate: typeof best = null;
      if (domainMatch && (nameMatch || phoneMatch || streetMatch)) {
        candidate = { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED, found: true, rank: result.rank, reason: 'Domain plus name, phone, address, or provider identity matched', matchedLocationId: location.id, matchedLocationName: location.name };
      } else if (domainMatch || (nameMatch && (phoneMatch || streetMatch))) {
        candidate = { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH, found: true, rank: result.rank, reason: 'Strong business identity match in local result', matchedLocationId: location.id, matchedLocationName: location.name };
      } else if (nameMatch || phoneMatch || streetMatch) {
        candidate = { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH, found: true, rank: result.rank, reason: 'Possible business match; review before treating as verified', matchedLocationId: location.id, matchedLocationName: location.name };
      }

      if (candidate && confidencePriority(candidate.confidence) > confidencePriority(best?.confidence ?? LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN)) {
        best = candidate;
        if (best.confidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED) break outer;
      }
    }
  }

  return best ?? { confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND, found: false, reason: 'No likely business match found in local results' };
}
```

- [ ] **Step 6: Add `updateSnapshotMatch` prepared statement and update `insertSnapshot` in `stmts()`**

In `server/local-seo.ts`, find the `stmts = createStmtCache(...)` block. 

Update the `insertSnapshot` statement to include the two new columns (add them to both the column list and the values list):

```typescript
insertSnapshot: db.prepare(`
  INSERT INTO local_visibility_snapshots (
    id, workspace_id, keyword, normalized_keyword, market_id, market_label, captured_at,
    local_pack_present, business_found, business_match_confidence, business_match_reason,
    local_rank, top_competitors, source_endpoint, provider, device, language_code,
    status, degraded_reason, matched_location_id, matched_location_name
  ) VALUES (
    @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label, @captured_at,
    @local_pack_present, @business_found, @business_match_confidence, @business_match_reason,
    @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code,
    @status, @degraded_reason, @matched_location_id, @matched_location_name
  )
`),
```

Add a new `updateSnapshotMatch` statement to the same stmts block:

```typescript
updateSnapshotMatch: db.prepare(`
  UPDATE local_visibility_snapshots
  SET business_found = @business_found,
      business_match_confidence = @business_match_confidence,
      business_match_reason = @business_match_reason,
      local_rank = @local_rank,
      matched_location_id = @matched_location_id,
      matched_location_name = @matched_location_name,
      top_competitors = @top_competitors
  WHERE id = @id
`),
listAllSnapshotsForWorkspace: db.prepare(
  'SELECT * FROM local_visibility_snapshots WHERE workspace_id = ? ORDER BY captured_at DESC'
),
```

- [ ] **Step 7: Update `rowToSnapshot` to map new columns**

Find `rowToSnapshot` in `server/local-seo.ts`. In the SnapshotRow interface (or equivalent), add:

```typescript
  matched_location_id: string | null;
  matched_location_name: string | null;
```

In the returned object from `rowToSnapshot`, add:

```typescript
    matchedLocationId: row.matched_location_id ?? undefined,
    matchedLocationName: row.matched_location_name ?? undefined,
```

- [ ] **Step 8: Update `snapshotFromProviderResult` to use locations**

Find `snapshotFromProviderResult` (around line 873). Change its signature from `workspace: Workspace` to `locations: ClientLocation[]`. Update the body:

```typescript
function snapshotFromProviderResult(
  locations: ClientLocation[],
  market: LocalSeoMarket,
  providerResult: LocalVisibilityProviderResult,
  device: LocalSeoDevice,
  languageCode: string,
): LocalVisibilitySnapshot {
  const match = evaluateLocalBusinessMatch(locations, providerResult.results);

  // Scrub all client-owned locations from top_competitors
  const ownedDomains = new Set(
    locations.map(l => cleanDomain(l.domain)).filter((d): d is string => Boolean(d))
  );
  const ownedNames = locations.map(l => normalizeText(l.name)).filter(Boolean);
  const topCompetitors = providerResult.results
    .filter(r => {
      const rd = cleanDomain(r.domain ?? r.url);
      if (rd && ownedDomains.has(rd)) return false;
      const title = normalizeText(r.title);
      if (title && ownedNames.some(n => title.includes(n) || n.includes(title))) return false;
      return true;
    })
    .slice(0, LOCAL_SEO_MAX_RESULTS);

  return {
    id: randomUUID(),
    workspaceId: /* need workspace id — pass it separately or read from market */
```

Wait — `snapshotFromProviderResult` currently reads `workspace.id` for the `workspaceId` field. Since we're removing the `workspace` param, we need to pass `workspaceId` separately. Update the signature to:

```typescript
function snapshotFromProviderResult(
  workspaceId: string,
  locations: ClientLocation[],
  market: LocalSeoMarket,
  providerResult: LocalVisibilityProviderResult,
  device: LocalSeoDevice,
  languageCode: string,
): LocalVisibilitySnapshot {
  const match = evaluateLocalBusinessMatch(locations, providerResult.results);

  const ownedDomains = new Set(
    locations.map(l => cleanDomain(l.domain)).filter((d): d is string => Boolean(d))
  );
  const ownedNames = locations.map(l => normalizeText(l.name)).filter(Boolean);
  const topCompetitors = providerResult.results
    .filter(r => {
      const rd = cleanDomain(r.domain ?? r.url);
      if (rd && ownedDomains.has(rd)) return false;
      const title = normalizeText(r.title);
      if (title && ownedNames.some(n => title.includes(n) || n.includes(title))) return false;
      return true;
    })
    .slice(0, LOCAL_SEO_MAX_RESULTS);

  return {
    id: randomUUID(),
    workspaceId,
    keyword: providerResult.keyword,
    normalizedKeyword: keywordComparisonKey(providerResult.keyword),
    marketId: market.id,
    marketLabel: market.label,
    capturedAt: providerResult.capturedAt,
    localPackPresent: providerResult.localPackPresent,
    businessFound: match.found,
    businessMatchConfidence: providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS ? match.confidence : LOCAL_BUSINESS_MATCH_CONFIDENCE.UNKNOWN,
    businessMatchReason: providerResult.status === LOCAL_VISIBILITY_STATUS.SUCCESS ? match.reason : providerResult.degradedReason,
    localRank: match.rank,
    topCompetitors,
    sourceEndpoint: providerResult.sourceEndpoint,
    provider: providerResult.provider,
    device,
    languageCode,
    status: providerResult.status,
    degradedReason: providerResult.degradedReason,
    matchedLocationId: match.matchedLocationId,
    matchedLocationName: match.matchedLocationName,
  };
}
```

- [ ] **Step 9: Update `insertSnapshot` call site to include new fields**

Find where `stmts().insertSnapshot.run(...)` is called (around line 905 in the original). Add the new fields to the run object:

```typescript
stmts().insertSnapshot.run({
  // ... all existing fields ...
  matched_location_id: snapshot.matchedLocationId ?? null,
  matched_location_name: snapshot.matchedLocationName ?? null,
});
```

- [ ] **Step 10: Update `runLocalSeoRefreshJob` call to `snapshotFromProviderResult`**

Find `runLocalSeoRefreshJob` (around line 1338). After `const workspace = getWorkspace(workspaceId)`, add:

```typescript
const locations = getEffectiveLocations(workspace);
```

Find the call to `snapshotFromProviderResult(workspace, ...)` inside the job and update it to:

```typescript
snapshotFromProviderResult(workspaceId, locations, market, providerResult, device, languageCode)
```

- [ ] **Step 11: Run the unit tests**

```bash
npx vitest run tests/unit/local-seo-multi-location-match.test.ts
```

Expected: all assertions PASS.

- [ ] **Step 12: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. Fix any before continuing.

- [ ] **Step 13: Commit**

```bash
git add server/local-seo.ts tests/unit/local-seo-multi-location-match.test.ts
git commit -m "feat(local-seo): multi-location evaluateLocalBusinessMatch + snapshot machinery"
```

---

## Task 5: Backfill job — `runLocationBackfillJob`

**Files:**
- Modify: `server/local-seo.ts`

- [ ] **Step 1: Add `runLocationBackfillJob` to `server/local-seo.ts`**

Add this export after `runLocalSeoRefreshJob`:

```typescript
/**
 * Background job that re-evaluates all existing snapshots for a workspace against
 * the current configured client_locations set. Fixes historical match data after
 * locations are added/updated/deleted.
 */
export async function runLocationBackfillJob(
  jobId: string,
  workspaceId: string
): Promise<void> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    updateJob(jobId, { status: 'error', message: 'Workspace not found', error: 'Workspace not found' });
    return;
  }

  const locations = getEffectiveLocations(workspace);
  const allRows = stmts().listAllSnapshotsForWorkspace.all(workspaceId) as SnapshotRow[];
  const total = allRows.length;

  if (total === 0) {
    updateJob(jobId, { status: 'done', progress: 100, total: 0, message: 'No snapshots to backfill', result: { workspaceId, updated: 0 } });
    return;
  }

  updateJob(jobId, { status: 'running', total, progress: 0, message: `Recalculating match data for ${total} snapshots...` });

  const BATCH = 100;
  let processed = 0;

  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);

    db.transaction(() => {
      for (const row of batch) {
        const snapshot = rowToSnapshot(row);
        // Re-evaluate match against stored top_competitors (no provider call)
        const match = evaluateLocalBusinessMatch(locations, snapshot.topCompetitors);

        // Scrub owned locations from competitors
        const ownedDomains = new Set(
          locations.map(l => cleanDomain(l.domain)).filter((d): d is string => Boolean(d))
        );
        const ownedNames = locations.map(l => normalizeText(l.name)).filter(Boolean);
        const scrubbedCompetitors = snapshot.topCompetitors.filter(r => {
          const rd = cleanDomain(r.domain ?? r.url);
          if (rd && ownedDomains.has(rd)) return false;
          const title = normalizeText(r.title);
          if (title && ownedNames.some(n => title.includes(n) || n.includes(title))) return false;
          return true;
        });

        stmts().updateSnapshotMatch.run({
          id: snapshot.id,
          business_found: match.found ? 1 : 0,
          business_match_confidence: match.confidence,
          business_match_reason: match.reason ?? null,
          local_rank: match.rank ?? null,
          matched_location_id: match.matchedLocationId ?? null,
          matched_location_name: match.matchedLocationName ?? null,
          top_competitors: JSON.stringify(scrubbedCompetitors),
        });
      }
    })();

    processed += batch.length;
    updateJob(jobId, {
      status: 'running',
      progress: Math.round((processed / total) * 100),
      total,
      message: `Recalculating match data... (${processed}/${total})`,
    });
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    action: 'backfill_completed',
    updated: total,
    updatedAt: new Date().toISOString(),
  });
  addActivity(workspaceId, 'local_seo_updated', 'Local match history recalculated',
    `${total} snapshots updated with multi-location match data`, { source: 'local_seo', updated: total });

  updateJob(jobId, {
    status: 'done',
    progress: 100,
    total,
    message: `Match history updated for ${total} snapshots`,
    result: { workspaceId, updated: total },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/local-seo.ts
git commit -m "feat(local-seo): runLocationBackfillJob re-evaluates existing snapshots against configured locations"
```

---

## Task 6: Update `LocalSeoSlice` assembler

**Files:**
- Modify: `server/intelligence/local-seo-slice.ts`

- [ ] **Step 1: Add `locations` to `assembleLocalSeo`**

Open `server/intelligence/local-seo-slice.ts`. Add the import at the top with existing imports:

```typescript
import { getClientLocations } from '../client-locations.js';
```

Find `assembleLocalSeo`. At the top of the try block, add:

```typescript
const rawLocations = getClientLocations(workspaceId).filter(l => l.status === 'confirmed');
const locations = rawLocations.map(l => ({
  id: l.id,
  name: l.name,
  isPrimary: l.isPrimary,
  city: l.city,
  stateOrRegion: l.stateOrRegion,
  pageTargetPath: l.pageTargetPath,
}));
```

In the returned slice object, add `locations` as the first field:

```typescript
return {
  locations,
  enabled: ...,
  markets: ...,
  // rest unchanged
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add server/intelligence/local-seo-slice.ts
git commit -m "feat(local-seo): add locations field to LocalSeoSlice assembler"
```

---

## Task 7: API routes — 4 location endpoints

**Files:**
- Modify: `server/routes/local-seo.ts`

- [ ] **Step 1: Add imports to `server/routes/local-seo.ts`**

Open `server/routes/local-seo.ts`. Add these imports with the existing imports at the top:

```typescript
import {
  createClientLocation,
  deleteClientLocation,
  getClientLocationById,
  getClientLocations,
  updateClientLocation,
  countClientLocations,
} from '../client-locations.js';
import { runLocationBackfillJob } from '../local-seo.js';
import { hasActiveJob, createJob } from '../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
```

Note: `createJob` and `hasActiveJob` may already be imported — if so, just add the missing ones to the existing import.

- [ ] **Step 2: Add Zod schemas for location endpoints**

After the existing schema definitions in `server/routes/local-seo.ts`, add:

```typescript
const createLocationSchema = z.object({
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

const updateLocationSchema = createLocationSchema.partial();
```

- [ ] **Step 3: Add the 4 location routes**

After the existing `router.post('/api/local-seo/:workspaceId/refresh', ...)` route, add:

```typescript
// ── Client Locations ─────────────────────────────────────────────────────────

router.get(
  '/api/local-seo/:workspaceId/locations',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    const locations = getClientLocations(workspaceId);
    res.json({ locations });
  }
);

router.post(
  '/api/local-seo/:workspaceId/locations',
  requireWorkspaceAccess('workspaceId'),
  validate(createLocationSchema),
  (req, res) => {
    const { workspaceId } = req.params;
    const location = createClientLocation(workspaceId, req.body);
    // Enqueue backfill job if not already running
    if (!hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, workspaceId)) {
      const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId, label: 'Recalculating local match history' });
      runLocationBackfillJob(job.id, workspaceId).catch(err =>
        log.error({ err, workspaceId }, 'runLocationBackfillJob failed')
      );
    }
    res.status(201).json({ location });
  }
);

router.put(
  '/api/local-seo/:workspaceId/locations/:locationId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateLocationSchema),
  (req, res) => {
    const { workspaceId, locationId } = req.params;
    const updated = updateClientLocation(locationId, workspaceId, req.body);
    if (!updated) return res.status(404).json({ error: 'Location not found' });
    if (!hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, workspaceId)) {
      const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId, label: 'Recalculating local match history' });
      runLocationBackfillJob(job.id, workspaceId).catch(err =>
        log.error({ err, workspaceId }, 'runLocationBackfillJob failed')
      );
    }
    res.json({ location: updated });
  }
);

router.delete(
  '/api/local-seo/:workspaceId/locations/:locationId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, locationId } = req.params;
    // Guard: block deletion of last location when snapshots exist
    const existing = getClientLocationById(locationId, workspaceId);
    if (!existing) return res.status(404).json({ error: 'Location not found' });
    const remaining = countClientLocations(workspaceId);
    if (remaining <= 1) {
      // Check if there are any snapshots — if so, block
      const { getLocalVisibilityReport } = await import('../local-seo.js');
      // Simpler: just count via a direct check — remaining === 1 means this is the last
      return res.status(409).json({ error: 'Cannot remove the only configured location. Add another location first, or remove all location data.' });
    }
    const deleted = deleteClientLocation(locationId, workspaceId);
    if (!deleted) return res.status(404).json({ error: 'Location not found' });
    if (!hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, workspaceId)) {
      const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId, label: 'Recalculating local match history' });
      runLocationBackfillJob(job.id, workspaceId).catch(err =>
        log.error({ err, workspaceId }, 'runLocationBackfillJob failed')
      );
    }
    res.json({ deleted: true });
  }
);
```

Note: The DELETE handler has a dynamic import that should be avoided. Replace the "guard block deletion" logic with a simple count check — no need to import getLocalVisibilityReport. Here is the corrected DELETE handler:

```typescript
router.delete(
  '/api/local-seo/:workspaceId/locations/:locationId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, locationId } = req.params;
    const existing = getClientLocationById(locationId, workspaceId);
    if (!existing) return res.status(404).json({ error: 'Location not found' });
    const totalCount = countClientLocations(workspaceId);
    if (totalCount <= 1) {
      return res.status(409).json({
        error: 'Cannot remove the only configured location. Add another location first.',
      });
    }
    const deleted = deleteClientLocation(locationId, workspaceId);
    if (!deleted) return res.status(404).json({ error: 'Location not found' });
    if (!hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, workspaceId)) {
      const job = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, { workspaceId, label: 'Recalculating local match history' });
      runLocationBackfillJob(job.id, workspaceId).catch(err =>
        log.error({ err, workspaceId }, 'runLocationBackfillJob failed')
      );
    }
    res.json({ deleted: true });
  }
);
```

- [ ] **Step 4: Check that `log` is available in this file**

`server/routes/local-seo.ts` must have a logger. Check the top of the file:

```bash
grep -n "createLogger\|const log" server/routes/local-seo.ts | head -5
```

If `log` is not defined, add at the top (with existing imports):

```typescript
import { createLogger } from '../logger.js';
const log = createLogger('routes/local-seo');
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. Fix any type errors (e.g. async handler — wrap DELETE in `async (req, res, next)` if needed; but since no async ops remain in the corrected version, it should be sync-safe).

- [ ] **Step 6: Commit**

```bash
git add server/routes/local-seo.ts
git commit -m "feat(local-seo): location CRUD API endpoints (GET/POST/PUT/DELETE) with backfill job trigger"
```

---

## Task 8: Integration tests

**Files:**
- Create: `tests/integration/client-locations.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/integration/client-locations.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addLocalSeoMarket, saveLocalSeoSettings } from '../../server/local-seo.js';
import { getClientLocations } from '../../server/client-locations.js';

const ctx = createTestContext(13362); // port-ok: next free after 13361

let workspaceId: string;

beforeAll(async () => {
  await ctx.start();
  const ws = createWorkspace({ name: 'Location Test Workspace', gscPropertyUrl: 'https://locationtest.com' });
  workspaceId = ws.id;
});

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stop();
});

describe('GET /api/local-seo/:workspaceId/locations', () => {
  it('returns empty array when no locations configured', async () => {
    const res = await ctx.get(`/api/local-seo/${workspaceId}/locations`);
    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([]);
  });
});

describe('POST /api/local-seo/:workspaceId/locations', () => {
  it('creates a location and returns it', async () => {
    const res = await ctx.post(`/api/local-seo/${workspaceId}/locations`, {
      name: 'Downtown Office',
      domain: 'locationtest.com',
      phone: '5125550100',
      streetAddress: '123 Congress Ave',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      status: 'confirmed',
    });
    expect(res.status).toBe(201);
    expect(res.body.location.name).toBe('Downtown Office');
    expect(res.body.location.isPrimary).toBe(true);
    expect(res.body.location.status).toBe('confirmed');
    expect(res.body.location.workspaceId).toBe(workspaceId);
  });

  it('returns 400 for missing name', async () => {
    const res = await ctx.post(`/api/local-seo/${workspaceId}/locations`, {});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/local-seo/:workspaceId/locations/:locationId', () => {
  it('updates the location', async () => {
    const createRes = await ctx.post(`/api/local-seo/${workspaceId}/locations`, {
      name: 'Branch A',
      status: 'needs_review',
    });
    const { id } = createRes.body.location;

    const updateRes = await ctx.put(`/api/local-seo/${workspaceId}/locations/${id}`, {
      name: 'Branch A Updated',
      status: 'confirmed',
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.location.name).toBe('Branch A Updated');
    expect(updateRes.body.location.status).toBe('confirmed');
  });

  it('returns 404 for unknown location', async () => {
    const res = await ctx.put(`/api/local-seo/${workspaceId}/locations/nonexistent`, { name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/local-seo/:workspaceId/locations/:locationId', () => {
  it('blocks deletion of the last configured location', async () => {
    // First ensure only one location exists for a fresh workspace
    const freshWs = createWorkspace({ name: 'Delete Test WS', gscPropertyUrl: 'https://delete-test.com' });
    try {
      const createRes = await ctx.post(`/api/local-seo/${freshWs.id}/locations`, { name: 'Only Location' });
      const { id } = createRes.body.location;
      const deleteRes = await ctx.delete(`/api/local-seo/${freshWs.id}/locations/${id}`);
      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error).toContain('only configured location');
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('deletes a location when others remain', async () => {
    const freshWs = createWorkspace({ name: 'Multi Delete WS', gscPropertyUrl: 'https://multi.com' });
    try {
      const res1 = await ctx.post(`/api/local-seo/${freshWs.id}/locations`, { name: 'Loc A' });
      const res2 = await ctx.post(`/api/local-seo/${freshWs.id}/locations`, { name: 'Loc B' });
      const deleteRes = await ctx.delete(`/api/local-seo/${freshWs.id}/locations/${res1.body.location.id}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
      expect(getClientLocations(freshWs.id)).toHaveLength(1);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});
```

- [ ] **Step 2: Run the integration tests**

```bash
npx vitest run tests/integration/client-locations.test.ts
```

Expected: all assertions PASS.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: no regressions. Fix any failures before continuing.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/client-locations.test.ts
git commit -m "test(local-seo): integration tests for location CRUD API"
```

---

## Task 9: PR1 close-out

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Add entry to `FEATURE_AUDIT.md`**

Open `FEATURE_AUDIT.md`. Add an entry for the new feature (follow the existing format — typically a line with feature name, status, and key files).

- [ ] **Step 2: Update `data/roadmap.json`**

Find the `intel-quality-multi-location-business-match` item. Change `"status": "pending"` to `"status": "done"` and add a `"notes"` field describing what was shipped in PR1.

Run the sort script:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 3: Final quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: all pass, zero errors.

- [ ] **Step 4: Commit close-out docs**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: PR1 close-out — multi-location business match server layer"
```

- [ ] **Step 5: Push and open PR**

```bash
git push origin HEAD
gh pr create \
  --title "feat(local-seo): multi-location business match reconciliation (server layer)" \
  --base staging \
  --body "$(cat <<'EOF'
## Summary

- Adds `client_locations` table (migration 099) for configuring multiple physical locations per workspace
- Updates `evaluateLocalBusinessMatch` to iterate all locations and return the best match with `matchedLocationId`/`matchedLocationName`
- Client-owned locations are scrubbed from `top_competitors` so they no longer appear as competitors
- Backfill job (`local-seo-location-backfill`) re-evaluates all existing snapshots when locations are saved
- 4 REST endpoints: GET/POST/PUT/DELETE `/api/local-seo/:workspaceId/locations`
- `LocalSeoSlice` gains a `locations` field for AdminChat/generation context
- Zero breaking change for single-location workspaces — empty array falls back to synthetic location from `workspace.businessProfile`

## Test plan
- [ ] Unit tests for `evaluateLocalBusinessMatch` multi-location logic pass
- [ ] Integration tests for location CRUD API pass
- [ ] Full test suite passes with no regressions
- [ ] Verify on staging: configure Swish Dental locations, check match rate improvement

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification on staging

After merging and deploying to staging:

1. Open Swish Dental workspace admin
2. Navigate to Local SEO → open the API directly: `GET /api/local-seo/ws_cf63dee3.../locations` — expect empty array
3. Add three locations via API or admin UI (when PR2 ships): Downtown, Midtown, East Austin — each with name, phone, address
4. Observe backfill job in TaskPanel ("Recalculating local match history")
5. After job completes, re-check the local visibility report — competitor list should no longer contain Swish's own locations
6. Verified match rate should jump from ~3% to 40%+
