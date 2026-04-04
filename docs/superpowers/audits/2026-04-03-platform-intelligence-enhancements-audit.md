# Platform Intelligence Enhancements — Pre-Plan Audit

**Date:** 2026-04-03
**Spec:** `docs/superpowers/specs/2026-04-03-platform-intelligence-enhancements-design.md`
**Audit method:** 5 parallel Explore agents scanning origin/main + live file verification of all 18 specific claims
**Total findings:** 38 discrete change sites across 27 files
**Next DB migrations:** 046 (client_signals), 047 (businessPriorities)

---

## Accuracy Review — Corrections from Live Verification

The following claims were verified against `git show origin/main:<path>`. Six corrections applied:

| # | Claim | Status | Correction |
|---|-------|--------|------------|
| 1 | NotificationBell line 238 `absolute top-full` | ✅ Confirmed | — |
| 2 | ChatPanel.tsx at `src/components/client/ChatPanel.tsx` | ❌ Wrong path | **File is `src/components/ChatPanel.tsx`** — shared component used by both admin + client chat |
| 3 | content-requests.ts lines 208-217 drops rationale | ✅ Confirmed | — |
| 4 | content-brief.ts no strategyCardContext/pageType params | ✅ Confirmed | pageType exists as a context property but no strategyCardContext at all |
| 5 | StrategyTab.tsx line 44 kdColor() | ✅ Confirmed | — |
| 6 | StrategyTab.tsx lines 575, 670-673, 688, 696 | ✅ Confirmed | — |
| 7 | workspace-intelligence.ts missing backlinkProfile/serpFeatures | ✅ Confirmed | — |
| 8 | page-keywords.ts lines 130-176 upsertPageKeyword() | ✅ Confirmed | — |
| 9 | PageIntelligence.tsx line 34 expects `'ai_estimate'` | ❌ Wrong | **Type is `'exact' \| 'partial_match' \| 'ai_estimate'`** — `'bulk_lookup'` written by strategy is not in this union at all. Fix: strategy should write `'exact'` (SEMRush bulk = exact keyword data) |
| 10 | keyword-strategy.ts uses replaceAllPageKeywords() | ✅ Confirmed | — |
| 11 | routes.ts line 23 ClientTab missing 'brand' | ✅ Confirmed | — |
| 12 | workspace.ts lines 175-177 existing toggles | ✅ Confirmed | — |
| 13 | public-analytics.ts line 176 client chat endpoint | ✅ Confirmed | — |
| 14 | approvals.ts lines 266-272 CMS write path | ✅ Confirmed | — |
| 15 | FeaturesTab.tsx at `src/components/admin/FeaturesTab.tsx` | ❌ Wrong path | **File is `src/components/settings/FeaturesTab.tsx`** |
| 16 | AdminInbox.tsx exists | ❌ Wrong | **Does not exist in origin/main** — must be CREATED as a new file |
| 17 | ContentGaps.tsx at `src/components/client/ContentGaps.tsx` | ❌ Wrong path | **File is `src/components/strategy/ContentGaps.tsx`** |
| 18 | AdminChat.tsx fixed-position slide-out pattern | ✅ Confirmed | Pattern at lines 129-130 |

**Additional spec-vs-audit drift fixed:**
- KD ranges updated to match spec exactly (0–30 / 31–60 / 61–80 / 81–100)
- Loading phrases updated to full list from spec (9 phrases, including Tinkerin'… and Rummagin'…)
- `client_signals` schema: field is `type` not `ctaType`; includes `status` column
- Two migrations needed: 046 + 047 (spec calls out both explicitly)
- Notification drawer slides in from **left**, not right
- `parseSerpFeatures()` is the function name from spec
- `useSmartPlaceholder` must read from cached seoContext slice — no independent AI calls
- Cache invalidation calls added (3 specific call sites from spec)

---

## Findings by Group

---

### GROUP 1 — Chat + Notifications

#### 1A. Chatbot Loading States

| File | Line | Current | Fix |
|------|------|---------|-----|
| `src/components/ChatPanel.tsx` | 117–119 | Three bouncing dots (`animate-bounce`) | Replace with cycling Western loading text |

**Shared component:** `ChatPanel.tsx` is used by both admin and client chat. This change applies to both automatically — no separate admin implementation needed.

**Loading phrases (full list from spec — cycle randomly per response):**
> Hootin'… / Hollerin'… / Rustlin'… / Wranglin'… / Cookin'… / Fetchin'… / Gettin' after it… / Tinkerin'… / Rummagin'…

**Behavior:** Random selection per response. Fade in/out if response takes >4s (second pick).

---

#### 1B. Service Interest CTA

| File | Role | Change |
|------|------|--------|
| `src/components/ChatPanel.tsx` | Message render loop | Inject `<ServiceInterestCTA>` below AI response when signal detected |
| `server/routes/public-analytics.ts` | Line 176 — POST chat endpoint | Add signal detection + `client_signals` DB insert + broadcast |
| `server/db/migrations/046-client-signals.sql` | New migration | `client_signals` table (see schema below) |
| `shared/types/client-signals.ts` | New types file | `ClientSignal` interface + `ClientSignalType` union |
| `src/components/client/ServiceInterestCTA.tsx` | New component | Stylized CTA button, two variants |
| `src/hooks/client/useServiceInterest.ts` | New hook | Mutation to POST signal |

**`client_signals` table schema (migration 046):**
```sql
CREATE TABLE client_signals (
  id TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL REFERENCES workspaces(id),
  type TEXT NOT NULL CHECK(type IN ('content_interest', 'service_interest')),
  chatContext TEXT NOT NULL,  -- JSON: last 10 messages
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'actioned')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**CTA variants:**
- `content_interest` → "Explore content recommendations" (navigates to strategy tab)
- `service_interest` → "Get in touch" (fires signal, shows confirmation message)

**Signal detection:** fired when user message contains content/brief/writing intent OR forward-motion/pricing/next-steps language.

**⚠️ NOTE:** Feature flag `bridge-client-signal` **already exists** in `shared/types/feature-flags.ts`. Do NOT add a duplicate.

**Cache invalidation on insert:**
```typescript
invalidateIntelligenceCache(workspaceId);
invalidateSubCachePrefix(workspaceId, 'slice:clientSignals');
```

---

#### 1C. Admin Signals Panel

| File | Role | Change |
|------|------|--------|
| `server/routes/admin/client-signals.ts` | New route file | GET `/api/admin/client-signals/:workspaceId` + PATCH status update |
| `src/components/NotificationBell.tsx` | Notifications panel | Add "Client Signals" section at top when unread signals exist |
| `src/components/admin/AdminInbox.tsx` | **NEW FILE** (does not exist) | Create with "Signals" tab; signal list, expand to chat context, status workflow |
| `src/hooks/admin/useClientSignals.ts` | New hook | Query key: `['admin-client-signals', workspaceId]` |
| `server/email.ts` | Line 57 sendEmail() | Add `sendClientSignalEmail()` helper |

**Email spec:**
- Subject: `[hmpsn.studio] Client signal from [Workspace Name]`
- Body: signal type, workspace, chat context snippet, link to Signals tab
- Uses existing `layout()` + `opts.cta` button support in `email-templates.ts`

**⚠️ SHARED FILE — SEQUENTIAL:** `NotificationBell.tsx` is touched by BOTH 1C and 1D. Single agent owns ALL `NotificationBell.tsx` changes.

---

#### 1D. Notification Panel Slide-Out (Bug Fix)

| File | Line | Current | Fix |
|------|------|---------|-----|
| `src/components/NotificationBell.tsx` | 238 | `absolute top-full right-0 mt-2 w-72 z-50` — clipped by sidebar `overflow-y-auto` | Convert to fixed-position slide-out drawer |

**Drawer spec:** Fixed position, slides in from the **left** over the sidebar, 360px wide, `z-50`, closes on outside click or Escape.

**Pattern to follow exactly:** `src/components/AdminChat.tsx` lines 129-130 (confirmed fixed-position pattern).

---

### GROUP 2A — Briefs Button Context Fix

**CRITICAL BUG CONFIRMED:** `generateBrief()` receives no strategy context.

| File | Line | Finding |
|------|------|---------|
| `server/routes/content-requests.ts` | 208–217 | Confirmed: POST handler never passes `rationale`, `intent`, `priority` to `generateBrief()` |
| `server/content-brief.ts` | 731–770 | Confirmed: no `strategyCardContext` parameter in function signature |
| `shared/types/briefs.ts` | — | New interfaces (defined in spec — see below) |

**New interfaces (exact shapes from spec):**

```typescript
// shared/types/briefs.ts — extend existing
interface StrategyCardContext {
  rationale?: string;
  volume?: number;
  difficulty?: number;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  competitorProof?: string;
  impressions?: number;
}

interface PageTypeBriefConfig {
  pageType: 'blog' | 'landing' | 'service' | 'location' | 'pillar' | 'product' | 'resource';
  journeyStage: 'awareness' | 'consideration' | 'decision';
  schemaType: string[];
  structureTemplate: string[];
  eeatSignals: string[];
  mediaCallouts: string[];
  competitorBenchmark?: { wordCount: number; topicsSummary: string; contentType: string };
}
```

**Journey stage derivation** (from `searchIntent` field):
- `informational` → `awareness` (TOFU)
- `commercial` → `consideration` (MOFU)
- `transactional` → `decision` (BOFU)

**Per-type schema types:**
- `blog` → `Article`
- `service` → `Service` + `LocalBusiness`
- `landing` → `WebPage`
- `location` → `LocalBusiness` + `GeoCoordinates`
- `pillar` → `Article` + `BreadcrumbList`
- `product` → `Product` + `AggregateRating`

---

### GROUP 2B — Smarter Recommendation Cards

| File | Path (CORRECTED) | Line | Finding |
|------|---------|------|---------|
| `StrategyTab.tsx` | `src/components/client/StrategyTab.tsx` | 44 | `kdColor()` — replace with `kdFraming()` from shared utility |
| `StrategyTab.tsx` | `src/components/client/StrategyTab.tsx` | 575 | `contentRequests.find()` — status tracking data source confirmed |
| `StrategyTab.tsx` | `src/components/client/StrategyTab.tsx` | 670–673 | Status display logic — extend to full 4-state pipeline |
| `ContentGaps.tsx` | **`src/components/strategy/ContentGaps.tsx`** | — | Parallel card component — same changes apply |

**KD framing ranges (exact from spec — do not alter):**
```
KD  0–30  → "Low competition — strong odds"
KD 31–60  → "Moderate competition — achievable with a strong post"
KD 61–80  → "Competitive — requires authority and depth"
KD 81–100 → "Highly competitive — long-term play"
```
Tooltip shows raw KD number. Shared utility: `src/lib/kdFraming.ts`.

**Status badge colors (from spec):**
- Brief requested → amber
- In production → teal
- Published → green
- Tracking rankings → blue (with position if available)

**Predicted impact (feature A):** `volume × estimatedCTR(positionBucket)`. Only renders when `volume > 0` (SEMRush) AND GSC CTR calculable. No placeholder if absent.

---

### GROUP 2C — SEO Editor Unification

| File | Change |
|------|--------|
| `src/components/SeoEditor.tsx` | Switch to `/api/webflow/all-pages/:siteId`; add collection filter chips; add select-all per collection; route CMS apply through `updateCollectionItem()` |
| `src/hooks/admin/useSeoEditor.ts` | Update endpoint |

**CMS write path (already exists in `server/approvals.ts` lines 266-272):**
- CMS pages: `updateCollectionItem(collectionId, itemId, { [fieldSlug]: value })` + `publishCollectionItems()`
- Field mapping from `publishTarget.fieldMap`
- If collection not in `fieldMap` → mark "Manual apply required"
- Show "Publishes to Webflow" indicator on CMS rows

**Cache invalidation on CMS SEO apply:**
```typescript
invalidateIntelligenceCache(workspaceId);
```

---

### GROUP 2D — Page Intelligence + Strategy Blend

**CRITICAL MISMATCH CONFIRMED + CORRECTED:**

| File | Finding |
|------|---------|
| `server/routes/keyword-strategy.ts` | Writes `metricsSource: 'bulk_lookup'` |
| `src/components/PageIntelligence.tsx` line 34 | Valid type is `'exact' \| 'partial_match' \| 'ai_estimate'` — **`'bulk_lookup'` is not a valid value** |
| `server/page-keywords.ts` lines 130–176 | `upsertPageKeyword()` exists — unused by strategy |
| `server/routes/keyword-strategy.ts` | `replaceAllPageKeywords()` confirmed at lines 1745 + 1928 |

**Fix (chosen approach — widen the type, not change the source value):**
1. `METRICS_SOURCE` const in `shared/types/keywords.ts` includes `BULK_LOOKUP: 'bulk_lookup'` as a 4th value — strategy correctly describes its data source
2. `PageIntelligence.tsx` local `StrategyPage` type is widened to import `MetricsSource` from `shared/types/keywords.ts`, replacing the hardcoded `'exact' | 'partial_match' | 'ai_estimate'` union
3. Strategy continues writing `metricsSource: 'bulk_lookup'` — this is accurate (bulk domain organic lookup)
4. Switch strategy from `replaceAllPageKeywords()` → `upsertPageKeyword()` per keyword (merge-upsert, never destroys existing PI data)
5. Verify: seed PI data → run strategy → assert PI fields intact

> **Note:** The audit initially proposed strategy should write `'exact'` instead of `'bulk_lookup'`. After implementation review, approach 2 (widen the type) was chosen as more semantically accurate — SEMRush bulk lookup data is not the same as an exact keyword match.

**Safety contract from spec:**
- Upsert is additive only: never overwrite a non-null field with null
- Pre-implementation: document every field both systems read/write

---

### GROUP 2E — Intelligence Gap: backlinkProfile + serpFeatures

| File | Line | Finding |
|------|------|---------|
| `server/workspace-intelligence.ts` | 206–285 | `assembleSeoContext()` confirmed missing both fields |
| `shared/types/intelligence.ts` | 71–72 | Both declared optional in `SeoContextSlice` — confirmed in intelligence-types.test.ts |
| `server/seo-data-provider.ts` | — | `getBacklinksOverview()` exists — just not called |
| `server/page-keywords.ts` | — | `serpFeatures` per-keyword data available for aggregation |

**`parseSerpFeatures()`** (function name from spec): new function that aggregates `serpFeatures` from `page_keywords` rows for the workspace. Returns `{ featuredSnippets: number, peopleAlsoAsk: number, localPack: boolean }`. No new API call needed.

---

### GROUP 3 — Client Portal

#### 3A. Client Brand Section

| File | Change |
|------|--------|
| `src/routes.ts` line 23 | Add `'brand'` to `ClientTab` union |
| `src/components/client/BrandTab.tsx` | **NEW FILE** — two-panel design |
| `src/components/client/ClientDashboard.tsx` | Add `{tab === 'brand' && <ErrorBoundary label="Brand"><BrandTab .../></ErrorBoundary>}` |
| `src/components/layout/Sidebar.tsx` | Add Brand `NavItem` to client nav group |

**ClientDashboard pattern (confirmed):** Uses **inline conditionals** `{tab === 'x' && ...}`, NOT switch/case.

**Two panels:**
- Business profile (editable): description, services, contact info → syncs to `businessProfile`
- Brand positioning (read-only): plain-language voice summary from `intelligenceProfile.brandVoice`

**Cache invalidation on brand profile client edit:**
```typescript
clearSeoContextCache(workspaceId);
debouncedSettingsCascade();
```

**businessPriorities column (migration 047):**
```sql
ALTER TABLE workspaces ADD COLUMN businessPriorities TEXT; -- JSON array of goal strings
```

---

#### 3B. Hide Site Intelligence Toggle

| File | Path (CORRECTED) | Change |
|------|---------|--------|
| `FeaturesTab.tsx` | **`src/components/settings/FeaturesTab.tsx`** | Add `siteIntelligenceClientView` toggle (copy `analyticsClientView` pattern at lines 109-161) |
| `src/components/client/OverviewTab.tsx` | — | Skip Site Intelligence module when `siteIntelligenceClientView === false` |
| `server/routes/admin/workspaces.ts` | — | Accept + persist `siteIntelligenceClientView` in PATCH |
| `shared/types/workspace.ts` | — | Add `siteIntelligenceClientView?: boolean \| null` (default `true`) |

---

#### 3C. Smart Placeholder Hook

| File | Change |
|------|--------|
| `src/hooks/useSmartPlaceholder.ts` | **NEW FILE** — single hook with auth-context param |

**Critical:** Hook reads from **existing cached `seoContext` slice** — no independent AI calls. `seoContext` already contains brand voice, personas, keywords, business context. Single intelligence fetch per workspace session (5-minute TTL already in place).

**Returns:**
- Admin context: `{ placeholder: string, suggestions: string[] }` — chips + pre-fill
- Client context: `{ placeholder: string }` — ghost text only, no chips, no pre-fill

**Feature-flagged:** `smart-placeholders` (add to `shared/types/feature-flags.ts`).

**Injection sites:**
- `src/components/AdminChat.tsx` — admin: chips + prefill
- `src/components/ChatPanel.tsx` — client: ghost text only
- Strategy generation inputs and workspace config forms (admin only)

---

## Test Coverage Plan

> **Policy: overtest rather than undertest.** Every feature gets unit + integration + component coverage.

### Tests to UPDATE (4 files)

| File | What to Add |
|------|------------|
| `tests/unit/content-brief.test.ts` | New suite: `generateBrief() with strategyCardContext` — assert rationale, volume, trendDirection appear in generated prompt. New suite: `generateBrief() with pageType` — one test per pageType variant asserting correct structure template, schema type, journey stage, eeat framing injected. (Existing file already covers the stored `pageType` field shape — these test the generation logic.) |
| `tests/unit/format-for-prompt.test.ts` | Add `backlinkProfile` + `serpFeatures` to `richIntelligence` fixture. Add assertions: section included when populated; section omitted when `undefined`; both fields present together. |
| `tests/unit/workspace-intelligence.test.ts` | Extend `buildSeoContext` mock to return `backlinkProfile` + `serpFeatures`. Assert assembled intelligence contains both. Add test: graceful omission when `getBacklinksOverview()` throws. |
| `tests/integration/content-requests-routes.test.ts` | Add: POST content request with strategy metadata → fetch generated brief → assert brief prompt contains rationale string. |

### New Unit Tests (5 files)

| File | Test Cases |
|------|-----------|
| `tests/unit/kd-framing.test.ts` | `kdFraming(0)` → "Low competition…". `kdFraming(30)` → "Low…". `kdFraming(31)` → "Moderate…". `kdFraming(60)` → "Moderate…". `kdFraming(61)` → "Competitive…". `kdFraming(80)` → "Competitive…". `kdFraming(81)` → "Highly competitive…". `kdFraming(100)` → "Highly competitive…". Boundary values 30/31 and 60/61 and 80/81 explicitly tested. `kdFraming(undefined)` → graceful fallback. |
| `tests/unit/loading-phrases.test.ts` | Returns a non-empty string. Return value is from the defined 9-phrase list. Over 50 calls, all 9 phrases appear at least once (distribution test). No two consecutive identical phrases. All phrases end with `…`. |
| `tests/unit/client-signals-store.test.ts` | `createClientSignal()` inserts row with correct `type`, `status: 'new'`, `chatContext`. `listClientSignals(workspaceId)` returns signals for that workspace only (isolation). `getClientSignal(id)` returns full record. `updateSignalStatus(id, 'reviewed')` persists. Signal with null chatContext gracefully handled. |
| `tests/unit/metrics-source-enum.test.ts` | `METRICS_SOURCE.EXACT === 'exact'`. `METRICS_SOURCE.PARTIAL_MATCH === 'partial_match'`. `METRICS_SOURCE.AI_ESTIMATE === 'ai_estimate'`. Import from `shared/types/keywords.ts` — type-check that `'bulk_lookup'` is NOT assignable to `MetricsSource`. |
| `tests/unit/page-intelligence-strategy-blend.test.ts` | Seed PI data for a page. Run strategy upsert for same page. Assert original PI fields intact (upsert didn't wipe). Assert `metricsSource` written is `'exact'` not `'bulk_lookup'`. Assert `replaceAllPageKeywords` is NOT called (spy). Assert `upsertPageKeyword` IS called per keyword. |

### New Integration Tests (4 files)

| File | Test Cases |
|------|-----------|
| `tests/integration/client-signals-routes.test.ts` | POST chat endpoint with content intent → 200. GET admin signals → returns record with `type`, `status: 'new'`, `chatContext`. PATCH signal status to 'reviewed' → persists. GET signals for different workspaceId → empty (isolation). |
| `tests/integration/seo-editor-unified.test.ts` | GET all-pages endpoint returns both static + CMS items. Collection filter param returns only matching collection. CMS item bulk generate returns suggestions. CMS item apply calls `updateCollectionItem()` path (mock Webflow API). Unmapped collection item → response includes `manualApplyRequired: true`. |
| `tests/integration/feature-toggle-site-intelligence.test.ts` | PATCH workspace `siteIntelligenceClientView: false` → 200. GET workspace → toggle persists as `false`. PATCH back to `true` → 200 and persists. Default for new workspace → `true` (or null treated as true). |
| `tests/integration/admin-signals-inbox.test.ts` | Admin signals list returns all signals across workspaces. Signal expand includes full `chatContext` JSON. Email send triggered on signal creation (mock `sendEmail`, assert called with correct subject pattern). Signal status workflow: new → reviewed → actioned. |

### New Component Tests (4 files)

| File | Test Cases |
|------|-----------|
| `tests/component/ServiceInterestCTA.test.tsx` | Renders with `type='content_interest'` → shows "Explore content recommendations". Renders with `type='service_interest'` → shows "Get in touch". Click fires `useServiceInterest` mutation. Button disabled while mutation in flight. Distinct styled appearance (not plain text link). |
| `tests/component/BrandTab.test.tsx` | Business profile section renders editable fields (description, services, contact). Save button fires update mutation. Brand positioning section renders as read-only (no inputs). Positioning text sourced from `intelligenceProfile.brandVoice` mock. Full brand voice doc NOT rendered anywhere in component. |
| `tests/component/NotificationBell.test.tsx` | Panel container has `fixed` class (not `absolute`). Client Signals section visible when signals mock has items. Empty signals → signals section not rendered. Slide-out closes on backdrop click. Escape key closes panel. |
| `tests/component/SmartPlaceholder.test.tsx` | Admin context: suggestion chips render. Admin context: input pre-fills on chip click. Client context: no chips rendered. Client context: ghost placeholder text present. Client context: no pre-fill button rendered. Feature flag `smart-placeholders: false` → no enhancement, plain input. Hook reads from `seoContext` mock, not a direct AI call. |

---

## Codebase Patterns for Implementers

> Include relevant entries from this section in every agent dispatch prompt.

| Pattern | Detail |
|---------|--------|
| **ClientDashboard tab rendering** | Inline conditionals `{tab === 'x' && <ErrorBoundary label="X"><Tab .../></ErrorBoundary>}` — NOT switch/case. File: `src/components/client/ClientDashboard.tsx` |
| **DB migration numbering** | Next available: **046** (client_signals), **047** (businessPriorities). Latest existing: `045-anomaly-scan-tracker.sql` |
| **Feature flag registration** | `FEATURE_FLAGS` const in `shared/types/feature-flags.ts`. Add key + value string; type auto-derives. `bridge-client-signal` already exists — do NOT add duplicate. New flags needed: `'smart-placeholders'`, `'client-brand-section'`, `'seo-editor-unified'` |
| **React Query key convention** | Admin: `['admin-<resource>', workspaceId]`. Client: `['client-<resource>', workspaceId]` |
| **Integration test setup** | `createTestContext(port)` from `tests/integration/helpers.js`. `beforeAll(ctx.startServer, 25_000)`. Pick an unused port. |
| **Sidebar NavItem addition** | `buildNavGroups()` in `src/components/layout/Sidebar.tsx`. Add `{ id: 'brand', label: 'Brand', icon: SomeIcon }` to appropriate group |
| **FeaturesTab location** | `src/components/settings/FeaturesTab.tsx` — NOT admin/ |
| **ContentGaps location** | `src/components/strategy/ContentGaps.tsx` — NOT client/ |
| **ChatPanel location** | `src/components/ChatPanel.tsx` — NOT client/ — shared by both admin + client |
| **AdminInbox** | Does not exist in origin/main — create as new file |
| **metricsSource valid values** | `'exact' \| 'partial_match' \| 'ai_estimate'` — strategy must write `'exact'` for SEMRush bulk data; `'bulk_lookup'` is NOT a valid value |
| **Smart placeholder intelligence** | Reads cached `seoContext` slice — no independent AI call. 5-min TTL already in place |
| **Notification drawer direction** | Slides in from **left** over sidebar |

---

## Existing Coverage Confirmed

| Area | Status |
|------|--------|
| Email send + CTA button | ✅ `sendEmail()` line 57; `opts.cta` in `email-templates.ts` |
| CMS write path | ✅ `updateCollectionItem()` + `publishCollectionItems()` in `approvals.ts` 266-272 |
| Intelligence slices (all 8) | ✅ Fully implemented Phase 4A/4B/4C |
| `getBacklinksOverview()` | ✅ Exists in SeoDataProvider — not wired |
| `page_keywords` upsert | ✅ `upsertPageKeyword()` at lines 130-176 — unused by strategy |
| Feature flag infrastructure | ✅ `shared/types/feature-flags.ts` + `<FeatureFlag>` component |
| `bridge-client-signal` flag | ✅ **Already exists** — do not duplicate |
| `businessProfile` type | ✅ Defined at workspace.ts lines 230-246 |
| AdminChat slide-out pattern | ✅ Fixed-position at lines 129-130 |
| pr-check.ts guards | ✅ Lines 211-233: `buildSeoContext()` + `buildWorkspaceIntelligence()` |
| ClientDashboard tab pattern | ✅ Inline conditionals confirmed |
| `content-brief.test.ts` v4 fields | ✅ Exists — tests stored pageType shape. New tests target generation logic. |

---

## Infrastructure Recommendations

### Shared Utilities

| Utility | File | Used By |
|---------|------|---------|
| `kdFraming(score: number): string` | `src/lib/kdFraming.ts` | StrategyTab + ContentGaps |
| `useLoadingPhrase(): string` | `src/hooks/useLoadingPhrase.ts` | ChatPanel |
| `ClientSignal` interface | `shared/types/client-signals.ts` | public-analytics, admin route, useClientSignals |
| `StrategyCardContext` interface | `shared/types/briefs.ts` (extend) | content-brief.ts, content-requests.ts, StrategyTab |
| `PageTypeBriefConfig` interface | `shared/types/briefs.ts` (extend) | content-brief.ts, content-requests.ts |
| `METRICS_SOURCE` const | `shared/types/keywords.ts` | keyword-strategy.ts, page-keywords.ts, PageIntelligence.tsx |
| `parseSerpFeatures()` | `server/workspace-intelligence.ts` | assembleSeoContext() only |

### New pr-check.ts Rules

| Rule | Regex Pattern | Glob | Level |
|------|--------------|------|-------|
| No raw `'bulk_lookup'` strings | `['"]bulk_lookup['"]` | `**/*.ts,**/*.tsx` | error |
| No raw `'ai_estimate'` outside types | `['"]ai_estimate['"]` | `server/**/*.ts,src/**/*.ts` | error |
| No `replaceAllPageKeywords` in strategy routes | `replaceAllPageKeywords` | `server/routes/keyword-strategy.ts` | error |
| No `getBacklinksOverview` outside workspace-intelligence | `getBacklinksOverview` | `server/**/*.ts` (exclude `workspace-intelligence.ts`) | error |

---

## High-Contention Shared Files (Sequential Tasks)

| File | Touched By | Strategy |
|------|-----------|---------|
| `src/components/ChatPanel.tsx` | 1A (loading + CTA) AND 3C (ghost placeholder) | Phase 1A owns it first; Phase 2's 3C agent reads committed result and adds only placeholder logic |
| `src/components/NotificationBell.tsx` | 1C (signals section) + 1D (slide-out) | Single agent owns ALL changes in same task |
| `server/workspace-intelligence.ts` | 2E only | Single agent, no parallel conflict |
| `shared/types/workspace.ts` | 1B (ClientSignal), 3A (ClientTab), 3B (siteIntelligenceClientView) | Phase 0 agent writes all |
| `shared/types/briefs.ts` | 2A (StrategyCardContext, PageTypeBriefConfig) | Phase 0 agent |
| `shared/types/keywords.ts` | 2D (METRICS_SOURCE) | Phase 0 agent |
| `shared/types/feature-flags.ts` | 3B, 3C (new flags) | Phase 0 agent |
| `scripts/pr-check.ts` | Infrastructure | Final sequential task (PR 4) |

---

## ═══════════════════════════════════════════
## PR STOP 1 — Shared Contracts
## ═══════════════════════════════════════════

**Branch:** `feature/pie-phase0-contracts`
**Merges into:** `staging`
**Size:** Small (~5 files, no UI changes)

### What ships in this PR

| File | Change |
|------|--------|
| `shared/types/client-signals.ts` | New — `ClientSignal` interface, `ClientSignalType` union |
| `shared/types/briefs.ts` | Extend — add `StrategyCardContext`, `PageTypeBriefConfig` |
| `shared/types/keywords.ts` | Extend — add `METRICS_SOURCE` const + `MetricsSource` type |
| `shared/types/workspace.ts` | Extend — add `siteIntelligenceClientView?: boolean \| null`, `ClientTab: \| 'brand'` |
| `shared/types/feature-flags.ts` | Extend — add `'smart-placeholders'`, `'client-brand-section'`, `'seo-editor-unified'` |
| `server/db/migrations/046-client-signals.sql` | New migration |
| `server/db/migrations/047-business-priorities.sql` | New migration |

### Before merging

```bash
npx tsc --noEmit --skipLibCheck   # zero errors
npx vitest run                     # full suite passes
npx tsx scripts/pr-check.ts        # zero errors
```

### Why this PR exists first
All parallel Phase 1 agents import from `shared/types/`. They must read from committed code — not each other's in-progress branches. This PR is the gate. No Phase 1 agent starts until this is green on staging.

---

## Parallelization Strategy

### Phase 1 — Parallel Batch (6 agents, after PR 1 merged to staging)

| Agent | Task | Files OWNED | Model |
|-------|------|------------|-------|
| **1A** | Chatbot loading phrases + Service Interest CTA | `src/components/ChatPanel.tsx`, `src/components/client/ServiceInterestCTA.tsx`, `src/hooks/useLoadingPhrase.ts`, `src/hooks/client/useServiceInterest.ts` | **Sonnet** |
| **1B** | Notification panel slide-out + Signals section | `src/components/NotificationBell.tsx` (ALL changes) | **Sonnet** |
| **1C** | Admin Signals backend + inbox + email | `server/routes/admin/client-signals.ts` (new), `src/components/admin/AdminInbox.tsx` (new), `src/hooks/admin/useClientSignals.ts` (new), `server/email.ts` | **Sonnet** |
| **2A** | Briefs context fix + page-type brief generation | `server/content-brief.ts`, `server/routes/content-requests.ts` | **Sonnet** |
| **2B** | Smarter cards + KD framing utility | `src/components/client/StrategyTab.tsx`, `src/components/strategy/ContentGaps.tsx`, `src/lib/kdFraming.ts` (new) | **Sonnet** |
| **3A** | Client brand section UI | `src/components/client/BrandTab.tsx` (new), `src/components/client/ClientDashboard.tsx`, `src/components/layout/Sidebar.tsx`, `src/routes.ts` | **Sonnet** |

**Phase 1 diff review before advancing:**
```bash
npx tsc --noEmit --skipLibCheck
grep -rn "absolute top-full" src/components/NotificationBell.tsx  # should be zero hits
grep -rn "animate-bounce" src/components/ChatPanel.tsx             # should be zero hits
npx vitest run tests/unit/content-brief.test.ts tests/component/
```

---

## ═══════════════════════════════════════════
## PR STOP 2 — Group 1: Chat + Notifications
## ═══════════════════════════════════════════

**Branch:** `feature/pie-group1-chat-notifications`
**Merges into:** `staging` (after PR 1 is green)
**Includes:** Phase 1 agents 1A + 1B + 1C + signal detection from public-analytics.ts

### What ships in this PR

| Feature | Files |
|---------|-------|
| Chatbot loading phrases | `ChatPanel.tsx` |
| Service Interest CTA (client) | `ServiceInterestCTA.tsx`, `useServiceInterest.ts`, `useLoadingPhrase.ts` |
| Signal detection (server) | `server/routes/public-analytics.ts` |
| Admin signals route + inbox tab | `server/routes/admin/client-signals.ts`, `AdminInbox.tsx` (new), `useClientSignals.ts` |
| Notification panel slide-out fix | `NotificationBell.tsx` |
| Client Signals section in panel | `NotificationBell.tsx` (same file) |
| Email notification | `server/email.ts` |
| Group 1 tests | 3 new unit + 2 new integration + 2 new component tests |

### Feature flag gate
Group 1 CTA + signal features run behind `bridge-client-signal` (already exists). Notification slide-out is a bug fix — no flag needed.

### Before merging

```bash
npx tsc --noEmit --skipLibCheck
npx vitest run
npx tsx scripts/pr-check.ts
# Manual QA on staging:
# 1. Open client chat, send a message about pricing → CTA appears
# 2. Click CTA → admin notification panel shows signal
# 3. Open notification panel → renders as slide-out drawer, not clipped
# 4. Admin inbox → Signals tab visible with signal record
# 5. Check email inbox for signal notification
```

---

### Phase 2 — Parallel Batch (4 agents, after PR 2 merged to staging)

| Agent | Task | Files OWNED | Model |
|-------|------|------------|-------|
| **2C** | SEO editor unification (CMS writes + collection filter) | `src/components/SeoEditor.tsx`, `src/hooks/admin/useSeoEditor.ts` | **Sonnet** |
| **2D** | Page Intelligence + Strategy blend | `server/routes/keyword-strategy.ts`, `server/page-keywords.ts` | **Sonnet** |
| **2E** | Intelligence gaps: backlinkProfile + serpFeatures | `server/workspace-intelligence.ts`, `server/seo-data-provider.ts` | **Sonnet** |
| **3B+3C** | Site Intelligence toggle + Smart placeholder hook | `src/components/settings/FeaturesTab.tsx`, `src/components/client/OverviewTab.tsx`, `server/routes/admin/workspaces.ts`, `src/hooks/useSmartPlaceholder.ts` (new), `src/components/AdminChat.tsx`, `src/components/ChatPanel.tsx` (placeholder only — 1A already committed loading/CTA changes) | **Sonnet** |

**Phase 2 diff review before advancing:**
```bash
npx tsc --noEmit --skipLibCheck
grep -rn "'bulk_lookup'" server/ src/ --include="*.ts" --include="*.tsx"  # should be zero
grep -rn "replaceAllPageKeywords" server/routes/keyword-strategy.ts       # should be zero
npx vitest run tests/unit/page-intelligence-strategy-blend.test.ts
npx vitest run tests/unit/workspace-intelligence.test.ts
```

---

## ═══════════════════════════════════════════
## PR STOP 3 — Group 2: Strategy + SEO
## ═══════════════════════════════════════════

**Branch:** `feature/pie-group2-strategy-seo`
**Merges into:** `staging` (after PR 2 is green)
**Includes:** Phase 1 agents 2A + 2B + Phase 2 agents 2C + 2D + 2E

### What ships in this PR

| Feature | Files |
|---------|-------|
| Briefs context fix (strategyCardContext) | `content-brief.ts`, `content-requests.ts` |
| Page-type-aware brief generation | `content-brief.ts` |
| Smarter cards (A/D/E) + KD framing | `StrategyTab.tsx`, `ContentGaps.tsx`, `kdFraming.ts` |
| SEO editor unification + CMS writes | `SeoEditor.tsx`, `useSeoEditor.ts` |
| Page Intelligence + Strategy blend | `keyword-strategy.ts`, `page-keywords.ts` |
| Intelligence gaps wired | `workspace-intelligence.ts`, `seo-data-provider.ts` |
| Group 2 tests | 4 updated + 3 new unit + 2 new integration |

### Feature flag gates
- SEO editor unification behind `seo-editor-unified` flag
- Smarter cards render additions are non-breaking (additive UI) — no flag needed

### Before merging

```bash
npx tsc --noEmit --skipLibCheck
npx vitest run
npx tsx scripts/pr-check.ts
# Manual QA on staging:
# 1. Request a brief from a strategy card → open brief → assert rationale + volume appear in brief content
# 2. Run strategy on a workspace → navigate to Page Intelligence → assert it's populated (not empty)
# 3. SEO editor (with flag on) → shows static + CMS pages in unified list
# 4. Apply SEO to a CMS page → confirm Webflow item updated
# 5. Backlink profile visible in admin chat context (via intelligence panel)
```

---

### Phase 3 — Parallel Batch (Group 3 + Phase 3 cleanup split)

Phase 3A was already completed in Phase 1 (BrandTab UI). The remaining Phase 3B+3C work was in Phase 2. Phase 3 cleanup runs as sequential tasks:

| Agent | Task | Files OWNED | Model |
|-------|------|------------|-------|
| **Cleanup** | All remaining tests (13 total from plan) + pr-check rules + docs | See test plan above + `scripts/pr-check.ts`, `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md` | Haiku (tests) / Sonnet (complex tests) |

**Phase 3 model breakdown:**

| Test File | Model |
|-----------|-------|
| `kd-framing.test.ts` | **Haiku** |
| `loading-phrases.test.ts` | **Haiku** |
| `metrics-source-enum.test.ts` | **Haiku** |
| `feature-toggle-site-intelligence.test.ts` | **Haiku** |
| `ServiceInterestCTA.test.tsx` | **Haiku** |
| Update `format-for-prompt.test.ts` | **Haiku** |
| Update `workspace-intelligence.test.ts` | **Haiku** |
| `client-signals-store.test.ts` | **Sonnet** |
| `page-intelligence-strategy-blend.test.ts` | **Sonnet** |
| `client-signals-routes.test.ts` | **Sonnet** |
| `seo-editor-unified.test.ts` | **Sonnet** |
| `admin-signals-inbox.test.ts` | **Sonnet** |
| `BrandTab.test.tsx` | **Sonnet** |
| `NotificationBell.test.tsx` | **Sonnet** |
| `SmartPlaceholder.test.tsx` | **Sonnet** |
| Update `content-requests-routes.test.ts` | **Haiku** |
| Update `content-brief.test.ts` | **Sonnet** |
| `pr-check.ts` rules (4 new) | **Haiku** |
| Doc updates | **Haiku** |

---

## ═══════════════════════════════════════════
## PR STOP 4 — Group 3: Client Portal + Infrastructure
## ═══════════════════════════════════════════

**Branch:** `feature/pie-group3-portal-infra`
**Merges into:** `staging` (after PR 3 is green)
**Includes:** Phase 1 agent 3A + Phase 2 agent 3B+3C + all Phase 3 cleanup

### What ships in this PR

| Feature | Files |
|---------|-------|
| Client brand section (new tab) | `BrandTab.tsx`, `ClientDashboard.tsx`, `Sidebar.tsx`, `routes.ts` |
| Site Intelligence toggle | `FeaturesTab.tsx`, `OverviewTab.tsx`, `workspaces.ts` route |
| Smart placeholder hook | `useSmartPlaceholder.ts`, `AdminChat.tsx`, `ChatPanel.tsx` |
| All 17 new/updated test files | See test plan |
| 4 new pr-check.ts rules | `scripts/pr-check.ts` |
| Post-ship docs | `FEATURE_AUDIT.md`, `data/roadmap.json`, `BRAND_DESIGN_LANGUAGE.md` |

### Feature flag gates
- Brand section behind `client-brand-section`
- Smart placeholders behind `smart-placeholders`
- Site Intelligence toggle is an admin setting — no flag needed

### Before merging

```bash
npx tsc --noEmit --skipLibCheck
npx vitest run                        # full suite — all 17 new tests must pass
npx tsx scripts/pr-check.ts           # 4 new rules enforced, zero violations
grep -r "purple-" src/components/client/  # zero hits — no purple in client views
# Manual QA on staging:
# 1. Client portal → Brand tab visible → edit business profile → saves
# 2. Brand positioning section → read-only, shows voice summary only
# 3. Admin settings → Features tab → toggle Site Intelligence off
# 4. Client dashboard → Site Intelligence module gone, layout reflows
# 5. Admin chat input → suggestion chips appear for workspace
# 6. Client chat input → ghost placeholder only, no chips
```

### Final merge to main
After PR 4 is verified on staging → merge `staging` → `main`.

---

## ═══════════════════════════════════════════
## PR SEQUENCE SUMMARY
## ═══════════════════════════════════════════

```
PR 1 — Shared Contracts (Phase 0)
  → Merge to staging → verify tsc + vitest green
  ↓
PR 2 — Group 1: Chat + Notifications
  → Merge to staging → QA chat CTA + signals panel + slide-out fix
  ↓
PR 3 — Group 2: Strategy + SEO
  → Merge to staging → QA brief context + PI populated + SEO editor unification
  ↓
PR 4 — Group 3: Client Portal + Infrastructure
  → Merge to staging → QA brand tab + toggles + placeholders + full test suite
  ↓
staging → main (release)
```

**Hard rules (from CLAUDE.md):**
- Never start PR N+1 until PR N is merged and CI is green on staging
- Each PR stays behind its feature flag until manually enabled on staging for QA
- Run `npx tsx scripts/pr-check.ts` before every merge

---

## Pre-Plan Checklist

- [x] Extract search patterns from spec
- [x] Launch parallel agents for exhaustive scan (5 agents)
- [x] Verify all 18 specific claims against live codebase (`git show origin/main`)
- [x] Apply 6 file path / claim corrections
- [x] Fix spec drift (KD ranges, loading phrases, client_signals schema, migration count)
- [x] Categorize every finding by fix type
- [x] Verify existing coverage
- [x] Correct fictional test file reference (`tests/enrich-seo-context.test.ts` does not exist)
- [x] Inventory shared files and high-contention areas
- [x] Document codebase patterns for implementers
- [x] Full test plan: 4 updates + 13 new test files across unit/integration/component
- [x] Model assignments per task in every phase table
- [x] 4 new pr-check.ts rules with exact regex patterns
- [x] 4 PR stops with QA checklists and quality gates
- [x] PR sequence summary with hard rules
- [ ] Present to user for review
- [ ] Hand off to writing-plans
