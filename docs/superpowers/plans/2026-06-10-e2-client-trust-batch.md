# E2 — Client Trust Batch (Audit #8)

**Branch:** `claude/core-e2-client-trust-batch`
**After:** E1 merged
**Model:** Sonnet (implementation) / Opus (review)
**Date authored:** 2026-06-10

---

## Context

Five cheap fixes that each erode client trust today. All are cosmetic or behavioral — no data-schema changes, no new endpoints.

---

## Fix Inventory

### Fix 1 — Tier-lock vs admin-hidden conflation (`clientDashboardNav.ts:28`)

**Root cause:** `strategyLocked = effectiveTier === 'free' || !ws.seoClientView` passes the combined value into `locked: strategyLocked`, which always renders the lock icon + upgrade modal. But `!ws.seoClientView` is an admin toggle ("don't expose SEO strategy to this client at all"), conceptually different from tier-gating. A paid client whose admin has hidden SEO strategy sees a lock icon and is invited to upgrade — but upgrading won't help.

**Pattern precedent:** `analyticsClientView !== false` already hides the Performance nav item entirely.

**Fix:**
- `ws.seoClientView === false` → omit item entirely (no upgrade path shown)
- `effectiveTier === 'free'` with `ws.seoClientView !== false` → `locked: true`
- `isPaid && ws.seoClientView !== false` → `locked: false`

Remove the `strategyLocked` variable (dead after change).

---

### Fix 2 — Dishonest export labels (`ContentPlanTab.tsx:62-64`)

`handleDownload` maps `'docx'` → `format=csv` and `'pdf'` → `format=json`. Button labels say "Word Doc" / "PDF". Rename the prop union to `'csv' | 'json'`, update handler to pass format directly, update MatrixProgressView button labels to "Spreadsheet (CSV)" / "Raw Data (JSON)".

---

### Fix 3 — WinsSurface dead link + misrepresented free-tier count

**3a:** Remove the dead `<a href="#">See full history →</a>` link (no real target exists).

**3b:** Compute `thisMonthWinsCount` = wins where `detectedAt` is within last 30 days. Use that in the free-tier teaser, not the all-time `wins.length`. If zero in last 30 days, say "Wins are being tracked — upgrade to see what we built."

---

### Fix 4 — "ROI N" badge mislabel (`OverviewTab.tsx:~286`)

`opportunity.value` is a 0-100 composite opportunity score. Relabel badge from `` `ROI ${N}` `` to `` `Score ${N}` ``. Update nearby comment to say "opportunity score".

---

### Fix 5 — Swallowed mutation errors

**InsightsEngine.tsx:** Add `useToast` import. In `handleRegenerate` catch (`:169`) replace `/* silently fail */` comment with `toast(msg, 'error')`. In `handleStatusUpdate` and `handleDismiss` catches replace `console.error` with targeted error toasts.

**ContentBriefs.tsx:** Classify each catch:
- `handleRegenerateOutline` (:214) — user-triggered → add toast
- `handleRegenerateBrief` (:227) — user-triggered → add toast
- `saveBriefField` (:235) — background auto-save → add explanatory comment
- `toggleRequestBrief` inner/fallback catches (:255, :269) — background fallback → add explanatory comments
- `handleDeleteRequest` (:286) — user-triggered → add toast
- `handleGenerateBriefForRequest` (:365) — user-triggered → add toast
- `handleGeneratePost` (:383) — user-triggered → add toast (still returns false for caller)
- `handleUpdateRequestStatus` (:397) — cascading/background → add explanatory comment
- `handleSendToClient` (:343-345) — already has toast, no change
- `handleGenerate` — already uses `setError()`, no change

---

## Test Plan

### `tests/unit/WinsSurface.test.tsx` (extend)
1. Free-tier teaser uses 30-day window (2 recent + 3 old wins → shows "2 wins")
2. Free-tier teaser zero count (all wins old → fallback string)
3. "See full history" link absent even with 10 wins

### `tests/component/client/clientDashboardNav.test.ts` (new)
1. free + seoClientView=true → strategy present, locked=true
2. paid + seoClientView=false → strategy absent
3. paid + seoClientView=true → strategy present, locked=false
4. paid + seoClientView=undefined → strategy present, locked=false
5. free + seoClientView=false → strategy absent

### `tests/component/client/InsightsEngine.test.tsx` (extend)
1. handleRegenerate shows error toast on post() rejection
2. handleStatusUpdate shows error toast on patch() rejection
3. handleDismiss shows error toast on del() rejection

### `tests/component/ContentBriefs.test.tsx` (new or extend)
1. handleRegenerateOutline shows toast on failure
2. handleRegenerateBrief shows toast on failure
3. handleDeleteRequest shows toast on failure
4. handleGenerateBriefForRequest shows toast on failure (non-409)

---

## Verification Commands

```bash
npm run typecheck && npx vite build && npx vitest run && npm run pr-check && npm run verify:feature-flags
grep -r "purple-" src/components/client/
```
