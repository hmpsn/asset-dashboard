# Cross-Provider Keyword & Backlink Hardening

**Date:** 2026-04-16
**Branch:** `fix/cross-provider-keyword-backlink-hardening` (off `staging`)
**PR:** Single PR, single phase

---

## Context

Post-PR #218 Chrome verification surfaced four issues (A3, A4, C, D) plus a pending testing gap. This plan bundles all of them into one PR to minimize review overhead.

**Scope:**
- **Bug A3** — `serpFeatures` silently dropped when mapping competitor keywords (both DFS and SEMRush paths)
- **Bug A4** — Unix-epoch date strings cause `Invalid Date` in `BacklinkProfile.tsx` (both providers)
- **Enhancement C** — Raise `compLimit` 100 → 200 (provider-agnostic, single change site)
- **Enhancement D** — Top-N-by-volume semantics: DFS gets `order_by` payload field; SEMRush gets 2× overfetch + in-memory sort
- **Testing** — Integration + unit tests covering the four changes
- **Mechanization** — 2 new pr-check rules guarding the two bug patterns

---

## Bug Analysis

### A3: serpFeatures dropped in competitor keyword mapping

**File:** `server/routes/keyword-strategy.ts:663–671`

The competitor keyword dedup loop pushes objects into `competitorKeywordData`. The push omits `serpFeatures`:

```ts
// CURRENT (broken)
competitorKeywordData.push({
  keyword: ck.keyword,
  volume:  ck.volume,
  difficulty: ck.difficulty,
  domain: ck.domain,
  position: ck.position,
  // serpFeatures never included → undefined for client
});
```

Both DFS (`dataforseo-provider.ts`) and SEMRush (`semrush.ts:374`) already populate `DomainKeyword.serpFeatures`. The field is lost at the route-layer mapping step.

**Impact:** Client sees no SERP feature tags on competitor keyword rows.

**Fix:** Add `serpFeatures: ck.serpFeatures` to every `competitorKeywordData.push({...})` call.

**Type changes required:**
- `server/routes/keyword-strategy.ts:583` — route-local array type: add `serpFeatures?: string`
- `shared/types/workspace.ts:125` — `KeywordStrategyData.competitorKeywordData` item: add `serpFeatures?: string`

### A4: Invalid Date in BacklinkProfile

**File:** `src/components/strategy/BacklinkProfile.tsx:145–146`

```tsx
{new Date(rd.firstSeen).toLocaleDateString()}  // → "Invalid Date"
```

**Root cause:** Both providers pass raw date strings that `new Date()` cannot parse:
- SEMRush `getReferringDomains` (`semrush.ts:820–825`): CSV `first_seen`/`last_seen` are Unix epoch **seconds** (e.g. `"1747509061"`). `new Date("1747509061")` = Invalid Date because `new Date(string)` treats a pure-number string as ISO, not epoch seconds.
- DFS `getReferringDomains` (`dataforseo-provider.ts:805–815`): `first_seen`/`last_visited` are DFS-format strings like `"2021-01-15 00:00:00 +00:00"` — parseable by `Date.parse` but passes through as-is; zero-epoch values also possible.

**Fix:** Shared `normalizeProviderDate(raw: string): string` in `server/seo-data-provider.ts`:

```ts
export function normalizeProviderDate(raw: string): string {
  if (!raw) return '';
  // Pure integer string → treat as Unix epoch
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    const ms = n > 1e12 ? n : n * 1000;   // detect seconds vs ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString();
}
```

Apply at both provider boundaries. `BacklinkProfile.tsx` renders `new Date(rd.firstSeen)` unchanged — once the provider returns valid ISO strings, this works without a frontend change.

---

## Enhancement C: compLimit 100 → 200

**File:** `server/routes/keyword-strategy.ts:658`

```ts
// CURRENT
const compLimit = semrushMode === 'full' ? 100 : 50;

// NEW
const compLimit = semrushMode === 'full' ? 200 : 50;
```

This is above the provider layer — applies to both DFS and SEMRush fetches identically.

---

## Enhancement D: Top-N-by-volume semantics

**Goal:** The `compLimit` competitors must be the *highest-volume* keywords, not arbitrary order.

### DFS

**File:** `server/providers/dataforseo-provider.ts:508–517` (`getDomainKeywords` payload)

Add `order_by` to the request body:

```ts
order_by: ['keyword_data.keyword_info.search_volume,desc'],
```

Zero client-side cost — DFS returns results sorted by volume.

### SEMRush

SEMRush's `getDomainKeywords` URL API has no sort parameter. Strategy: **overfetch 2× + in-memory sort**.

**File:** `server/routes/keyword-strategy.ts` (competitor fetch call)

```ts
const fetchLimit = compLimit * 2;
const rawCompetitorKws = await provider.getDomainKeywords(domain, ws.id, fetchLimit);
// sort descending by volume, then slice
const sortedKws = rawCompetitorKws.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
const competitorKws = sortedKws.slice(0, compLimit);
```

Only applied when `provider.name === 'semrush'` (or equivalent guard). DFS already sorted by API.

---

## Implementation Tasks

### Task 1 — Shared type updates (pre-commit, no parallel work after)

**Files:** `shared/types/workspace.ts`, `server/routes/keyword-strategy.ts` (type only)

1. `shared/types/workspace.ts:125` — add `serpFeatures?: string` to `competitorKeywordData` item type
2. `server/routes/keyword-strategy.ts:583` — add `serpFeatures?: string` to route-local array type

### Task 2 — `normalizeProviderDate` helper

**File:** `server/seo-data-provider.ts`

Add `normalizeProviderDate(raw: string): string` as an exported function (implementation above).

### Task 3 — Bug A3 fix (serpFeatures)

**File:** `server/routes/keyword-strategy.ts:663–671`

Add `serpFeatures: ck.serpFeatures` to the `competitorKeywordData.push({...})` call. Add `// compkw-serp-ok` hatch if a second call site exists that legitimately omits it (currently none expected).

### Task 4 — Bug A4 fix (provider date normalization)

**Files:**
- `server/semrush.ts:820–825` — apply `normalizeProviderDate()` to `first_seen` and `last_seen`
- `server/providers/dataforseo-provider.ts:805–815` — apply to `first_seen` and `last_visited`

Ensure `normalizeProviderDate` is imported from `server/seo-data-provider.ts` in both files.

### Task 5 — Enhancement C + D

**File:** `server/routes/keyword-strategy.ts`

1. Change `compLimit` from 100 → 200 (line 658)
2. Add `order_by` to DFS payload (or pass as option if provider signature supports it)
3. Add SEMRush overfetch + sort logic (provider-name guard)

**File:** `server/providers/dataforseo-provider.ts:508–517`

Add `order_by: ['keyword_data.keyword_info.search_volume,desc']` to `getDomainKeywords` payload.

### Task 6 — Tests

**New files:**
- `tests/unit/seo-data-provider.test.ts` — `normalizeProviderDate` edge cases (unix seconds, unix ms, DFS ISO, empty, zero-epoch, unparseable)
- `tests/unit/semrush.test.ts` — `getReferringDomains` mapper: assert `firstSeen`/`lastSeen` are ISO strings
- `tests/integration/backlinks-date-shape.test.ts` (port **13320**) — `GET /api/workspace/:id/backlinks` returns `firstSeen` / `lastSeen` as ISO strings (not "Invalid Date", not raw epoch)
- `tests/integration/keyword-strategy-serp-features.test.ts` (port **13321**) — competitor keyword rows include `serpFeatures` field

**Extend:**
- `tests/unit/dataforseo-provider.test.ts` — `getReferringDomains` mapper date normalization test

### Task 7 — pr-check rules

**File:** `scripts/pr-check.ts` (append to `CHECKS` array)

**Rule A — Raw provider date passed to `new Date()`:**

```ts
{
  name: 'Raw provider date passed to new Date()',
  pattern: 'new Date\\((\\w+\\.)?(first_?[sS]een|last_?[sS]een|last_?[vV]isited)',
  fileGlobs: ['*.ts'],
  pathFilter: 'server/',
  exclude: ['server/seo-data-provider.ts'],
  excludeLines: ['// provider-date-ok'],
  message: 'Pass provider date strings through normalizeProviderDate() before constructing a Date. Add // provider-date-ok if already normalized.',
  severity: 'warn',
},
```

**Rule B — Competitor keyword push missing `serpFeatures`:**

```ts
{
  name: 'Competitor keyword push missing serpFeatures',
  pattern: 'competitorKeywordData\\.push\\(\\{',
  fileGlobs: ['*.ts'],
  pathFilter: 'server/',
  excludeLines: ['// compkw-serp-ok'],
  message: 'Include serpFeatures in competitorKeywordData.push({...}) or add // compkw-serp-ok if intentionally omitted.',
  severity: 'warn',
  customCheck: (files: { path: string; content: string }[]) => {
    const errors: string[] = [];
    for (const file of files) {
      if (!file.path.includes('server/')) continue;
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('competitorKeywordData.push({')) continue;
        if (line.includes('// compkw-serp-ok')) continue;
        // Look ahead up to 12 lines for serpFeatures or closing });
        const lookahead = lines.slice(i + 1, i + 13).join('\n');
        const closeIdx = lookahead.indexOf('});');
        const hasSerpFeatures = lookahead.includes('serpFeatures');
        if (closeIdx !== -1 && !hasSerpFeatures) {
          errors.push(`${file.path}:${i + 1}: competitorKeywordData.push missing serpFeatures`);
        }
      }
    }
    return errors;
  },
},
```

---

## Verification

```bash
npm run typecheck
npx vite build
npx vitest run tests/unit/seo-data-provider.test.ts
npx vitest run tests/unit/semrush.test.ts
npx vitest run tests/unit/dataforseo-provider.test.ts
npx vitest run tests/integration/backlinks-date-shape.test.ts
npx vitest run tests/integration/keyword-strategy-serp-features.test.ts
npx vitest run   # full suite
npx tsx scripts/pr-check.ts
```

---

## File Ownership

| File | Task |
|------|------|
| `shared/types/workspace.ts` | Task 1 |
| `server/seo-data-provider.ts` | Task 2 |
| `server/routes/keyword-strategy.ts` | Tasks 1, 3, 5 |
| `server/semrush.ts` | Task 4 |
| `server/providers/dataforseo-provider.ts` | Tasks 4, 5 |
| `scripts/pr-check.ts` | Task 7 |
| `tests/unit/seo-data-provider.test.ts` | Task 6 |
| `tests/unit/semrush.test.ts` | Task 6 |
| `tests/unit/dataforseo-provider.test.ts` | Task 6 |
| `tests/integration/backlinks-date-shape.test.ts` | Task 6 |
| `tests/integration/keyword-strategy-serp-features.test.ts` | Task 6 |

---

## Deferred

- The other 2 pr-check rules from `sturdy-beacon` mechanization plan (unrelated patterns, separate session)
- A2 content brief verification (separate Chrome verification session)
- WS_EVENTS round-trip test (needs client JWT setup, separate session)
