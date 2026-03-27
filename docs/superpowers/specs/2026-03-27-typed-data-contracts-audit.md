# Typed Data Contracts Audit — Design Spec

**Date:** 2026-03-27
**Status:** Draft
**Scope:** Runtime validation at every JSON parse boundary, prioritized by blast radius
**Prerequisite for:** Phase 2 Connected Intelligence, Copy & Brand Engine, any new features

---

## Problem Statement

The codebase has **194 `JSON.parse()` calls across 57 server files** with no runtime validation. Data flows through typed TypeScript interfaces, but these types are compile-time only — they evaporate at the DB boundary. When stored JSON doesn't match the expected shape (due to schema evolution, AI output malformation, or corrupted writes), consumers silently receive `undefined` fields, wrong types, or empty arrays.

This is not theoretical. In PR #86 alone, **7 bugs** traced to this class of error: wrong field names (`data.ctr` vs `data.actualCtr`), wrong units (percentage vs decimal), and missing fields (`estimatedClickDelta`). These bugs were caught in review. In the broader codebase — particularly the content generation pipeline where AI output feeds into published content — the same class of error likely exists undetected.

### Why now

1. **Content generation pipeline** is the highest-risk path. AI-generated briefs and posts are parsed from JSON, fed into GPT-4 prompts, and published to Webflow. A wrong parse silently produces wrong content.
2. **Stripe payment metadata** controls which pages get work orders. Malformed JSON could target wrong pages.
3. **Phase 2 of Connected Intelligence** adds more cross-module data flows. Each new connection multiplies the surface area for parse errors.
4. **The Copy & Brand Engine** (confident-lamport worktree) will add another AI generation pipeline that reads from workspace config JSON. It inherits every unvalidated parse in `workspaces.ts`.

---

## Architecture

### Current: Trust-Based Parsing

```
SQLite JSON column → JSON.parse() → cast to TypeScript interface → use
                     ↑ no validation        ↑ compile-time only
```

Every `rowToX()` mapper does `JSON.parse(row.field)` and assigns the result to a typed field. If the stored JSON has wrong keys, missing fields, or wrong types, TypeScript doesn't catch it — the error manifests at runtime as `undefined` property access.

### Proposed: Validated Parsing

```
SQLite JSON column → JSON.parse() → Zod schema.parse() → typed result → use
                                     ↑ runtime validation
                                     ↑ logs warning + returns safe default on failure
```

**Key design decisions:**

1. **Zod for validation** — already in the project (`server/middleware/validate.ts`). Same import, same patterns.
2. **Warn-and-default, don't throw** — a corrupted JSON field shouldn't crash the server. Log a warning with the workspace ID and field name, return a safe default (empty array, zero, null).
3. **Validate at the read boundary** — in `rowToX()` mappers, not at write time. This catches both new writes AND legacy data.
4. **Progressive rollout** — start with critical paths (content pipeline, payments, workspace config), expand to medium-risk paths.

### Validation Helper

A new shared utility: `server/db/json-validation.ts`

```typescript
import { z, type ZodType } from 'zod';
import { createLogger } from '../logger.js';

const log = createLogger('json-validation');

/**
 * Safely parse a JSON string with Zod validation.
 * On parse failure: logs a warning and returns the fallback value.
 * On JSON.parse failure: logs a warning and returns the fallback value.
 * Never throws.
 */
export function parseJsonSafe<T>(
  raw: string | null | undefined,
  schema: ZodType<T>,
  fallback: T,
  context?: { workspaceId?: string; field?: string; table?: string },
): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    log.warn({
      ...context,
      errors: result.error.issues.slice(0, 3),
    }, `JSON validation failed for ${context?.table}.${context?.field}`);
    return fallback;
  } catch (err) {
    log.warn({ ...context, err }, `JSON parse failed for ${context?.table}.${context?.field}`);
    return fallback;
  }
}

/**
 * Parse a JSON string without Zod but with safe fallback.
 * Use only for low-risk fields where a full schema isn't warranted.
 */
export function parseJsonFallback<T>(
  raw: string | null | undefined,
  fallback: T,
): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

---

## Risk Tiers

### Tier 0 — CRITICAL (data feeds AI generation, payments, or published content)

| # | File | Parse Location | Data | Downstream Impact |
|---|------|---------------|------|-------------------|
| C1 | `server/content-brief.ts` | Row mapper (~19 JSON.parse calls) | Brief outline, keywords, SERP analysis, EEAT guidance, schema recs, keyword validation | Feeds into GPT-4 prompt for content generation. Wrong outline = wrong article structure. Missing keywords = off-topic content. |
| C2 | `server/content-posts-db.ts` | Lines 116, 177, 190 | Post sections, review checklist | Sections publish directly to Webflow CMS. Corrupted sections = garbled published content. |
| C3 | `server/internal-links.ts` | Line 369 | AI-generated link suggestions | Links inserted into published content. Malformed link data = broken internal links on live site. |
| C4 | `server/stripe.ts` | Lines ~525, ~560, ~593 | Cart items, page IDs, subscription ID | Work orders created from parsed metadata. Wrong page IDs = wrong pages get modified. |
| C5 | `server/workspaces.ts` | Lines 109-135 | keywordStrategy, businessProfile, brandVoice, contentPricing, publishTarget, personas, eventConfig, eventGroups, competitorDomains, auditSuppressions, portalContacts | Seeds every AI prompt (strategy, briefs, rewrites, chat). Controls pricing, publishing, portal access. |
| C6 | `server/approvals.ts` | Line 41 | Approval batch items | Controls whether content publishes. Self-healing code indicates prior corruption. |

### Tier 1 — HIGH (affects admin decision-making or client-visible data)

| # | File | Parse Location | Data | Downstream Impact |
|---|------|---------------|------|-------------------|
| H1 | `server/reports.ts` | Lines 99-101 | SeoAuditResult, action items | Audit results displayed to clients, fed into admin chat context |
| H2 | `server/recommendations.ts` | Row mapper | Recommendations, summary | Displayed to clients, affects strategy decisions |
| H3 | `server/admin-chat-context.ts` | Lines 460-495 | Audit pages (`as any[]` × 10+) | Feeds directly into admin chat AI prompt |
| H4 | `server/chat-memory.ts` | Lines 103, 141 | Chat message history | Chat context, conversation continuity |
| H5 | `server/schema-validator.ts` | Lines 99-101 | Rich results, errors, warnings | Schema validation displayed to admin, affects schema decisions |
| H6 | `server/content-requests.ts` | Line 95 | Request comments | Client-facing comments in request workflow |
| H7 | `server/analytics-insights-store.ts` | Row mapper | Insight `data` JSON column | Priority feed display, insight enrichment |

### Tier 2 — MEDIUM (internal admin, caches, display-only)

| # | File | Data | Notes |
|---|------|------|-------|
| M1 | `server/performance-store.ts` | Performance metrics | Display-only, no generation |
| M2 | `server/rank-tracking.ts` | Ranking data | Display-only |
| M3 | `server/keyword-metrics-cache.ts` | Keyword trends | Cache, regenerable |
| M4 | `server/email-queue.ts` | Email job payload | Transient queue |
| M5 | `server/websocket.ts` | Client messages | Already has action-level validation |
| M6 | `server/schema-suggester.ts` | Schema suggestions | Admin review before publish |
| M7 | `server/seo-change-tracker.ts` | Change tracking data | Historical record |

### Tier 3 — LOW (internal tooling, transient, or already protected)

Activity logs, competitor schema cache, job state, content matrices, decay analysis cache, anomaly detection, provider responses (already try/caught).

---

## Zod Schemas Required

### Tier 0 Schemas

**`server/schemas/content-schemas.ts`** — Content brief and post validation:

```typescript
// ContentBrief field schemas
const outlineItemSchema = z.object({
  heading: z.string(),
  subheadings: z.array(z.string()).optional(),
  notes: z.string(),
  wordCount: z.number().optional(),
  keywords: z.array(z.string()).optional(),
});

const serpAnalysisSchema = z.object({
  contentType: z.string(),
  avgWordCount: z.number(),
  commonElements: z.array(z.string()),
  gaps: z.array(z.string()),
});

const eeatGuidanceSchema = z.object({
  experience: z.string(),
  expertise: z.string(),
  authority: z.string(),
  trust: z.string(),
});

const schemaRecommendationSchema = z.object({
  type: z.string(),
  notes: z.string(),
});

const keywordValidationSchema = z.object({
  volume: z.number(),
  difficulty: z.number(),
  cpc: z.number(),
  validatedAt: z.string(),
});

const realTopResultSchema = z.object({
  position: z.number(),
  title: z.string(),
  url: z.string(),
});

// PostSection schema
const postSectionSchema = z.object({
  index: z.number(),
  heading: z.string(),
  content: z.string(),
  wordCount: z.number(),
  targetWordCount: z.number(),
  keywords: z.array(z.string()),
  status: z.enum(['pending', 'generating', 'done', 'error']),
  error: z.string().optional(),
});

const reviewChecklistSchema = z.object({
  factual_accuracy: z.boolean(),
  brand_voice: z.boolean(),
  internal_links: z.boolean(),
  no_hallucinations: z.boolean(),
  meta_optimized: z.boolean(),
  word_count_target: z.boolean(),
});
```

**`server/schemas/workspace-schemas.ts`** — Workspace config validation:

```typescript
const pageKeywordMapSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  // ... all fields from PageKeywordMap interface
}).passthrough(); // allow extra fields for forward compat

const keywordStrategySchema = z.object({
  pageMap: z.array(pageKeywordMapSchema),
  // ... other KeywordStrategy fields
}).passthrough();

const businessProfileSchema = z.object({
  name: z.string().optional(),
  industry: z.string().optional(),
  targetAudience: z.string().optional(),
  // ... other fields
}).passthrough();

const contentPricingSchema = z.object({
  briefPrice: z.number().optional(),
  postPrice: z.number().optional(),
  // ... other fields
}).passthrough();
```

**`server/schemas/payment-schemas.ts`** — Stripe metadata validation:

```typescript
const cartItemSchema = z.object({
  productType: z.string(),
  pageIds: z.array(z.string()).optional(),
  issueChecks: z.array(z.string()).optional(),
});

const stripeMetadataSchema = z.object({
  cartItems: z.array(cartItemSchema),
  pageIds: z.array(z.string()).optional(),
});
```

**`server/schemas/approval-schemas.ts`** — Approval batch items:

```typescript
const approvalItemSchema = z.object({
  pageId: z.string(),
  pagePath: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'changes_requested']),
  // ... other ApprovalItem fields
}).passthrough();
```

### Tier 1 Schemas

**`server/schemas/audit-schemas.ts`** — Audit result validation (complex, nested):

```typescript
// Partial validation — validate the top-level shape and critical fields,
// use .passthrough() for deeply nested audit data that varies by check type
const auditPageSchema = z.object({
  url: z.string(),
  score: z.number().optional(),
  issues: z.array(z.object({
    type: z.string(),
    severity: z.string(),
    message: z.string(),
  }).passthrough()).optional(),
}).passthrough();

const auditResultSchema = z.object({
  pages: z.array(auditPageSchema).optional(),
  // Top-level summary fields
}).passthrough();
```

**`server/schemas/insight-data-schemas.ts`** — Per-insight-type validation:

```typescript
// Map each InsightType to its Zod schema
const insightDataSchemas: Record<InsightType, ZodType> = {
  page_health: z.object({ score: z.number(), trend: z.string(), clicks: z.number(), ... }),
  ranking_mover: z.object({ query: z.string(), currentPosition: z.number(), ... }),
  ctr_opportunity: z.object({ actualCtr: z.number(), expectedCtr: z.number(), ... }),
  // ... all InsightDataMap types
};
```

---

## Implementation Strategy

### Phase A: Foundation (1 task)
1. Create `server/db/json-validation.ts` with `parseJsonSafe` and `parseJsonFallback`
2. Create `server/schemas/` directory structure
3. Write unit tests for `parseJsonSafe` (handles null, malformed JSON, schema failure, valid data)

### Phase B: Tier 0 Critical Paths (5 tasks, can be parallelized)
4. **Content briefs** — Add Zod schemas for all 15 JSON fields in the row mapper. Replace bare `JSON.parse` with `parseJsonSafe`. Test with intentionally malformed data.
5. **Content posts** — Add Zod schemas for sections and review checklist. Validate at row mapper.
6. **Internal links** — Validate AI-generated link suggestions before insertion.
7. **Stripe payments** — Validate cart items and page IDs from session metadata before creating work orders.
8. **Workspace config** — Add Zod schemas for keywordStrategy, businessProfile, contentPricing, publishTarget, personas, eventConfig, eventGroups. Replace all 13 JSON.parse calls in the row mapper.

### Phase C: Tier 0 Continued + Tier 1 (4 tasks)
9. **Approvals** — Remove self-healing code, add pre-store validation. Validate at read boundary.
10. **Audit snapshots** — Partial validation (top-level shape + critical fields) for `SeoAuditResult`.
11. **Admin chat context** — Replace `as any[]` casts with validated type guards.
12. **Insight data store** — Validate insight `data` field against `InsightDataMap` at read boundary.

### Phase D: Tier 1 Remaining + Documentation (3 tasks)
13. **Recommendations + Schema validator + Content requests + Chat memory** — Group of smaller stores that share the same pattern. One task, multiple files.
14. **Add JSDoc annotations** — Document every `ctr`, `bounceRate`, `conversionRate`, `engagementRate` field across `shared/types/analytics.ts` with unit-of-measure.
15. **Final verification + docs** — Run all tests, update FEATURE_AUDIT.md, CLAUDE.md.

---

## Testing Strategy

Each validation task includes:

1. **Happy path** — valid data parses correctly, returns typed result
2. **Missing optional fields** — returns defaults, no warning logged
3. **Wrong field type** — e.g., string where number expected → logs warning, returns fallback
4. **Missing required field** — logs warning, returns fallback (not crash)
5. **Completely malformed JSON** — logs warning, returns fallback
6. **Null/undefined input** — returns fallback immediately
7. **Extra fields** — allowed (`.passthrough()`), not stripped

**For Tier 0 (critical path) tasks**, add integration tests that:
- Insert malformed JSON directly into SQLite
- Verify the API still returns valid responses (with defaults)
- Verify warnings are logged

---

## Migration Path

This is **fully backward-compatible**. No data migration needed. No API changes.

- Existing valid data passes Zod validation transparently
- Existing malformed data (if any) gets logged and defaulted instead of silently producing wrong values
- New data is validated before storage where feasible (Phase C adds write-side validation for approvals)

---

## Success Criteria

- [ ] Zero `JSON.parse()` calls without either `parseJsonSafe()` or `parseJsonFallback()` in Tier 0 files
- [ ] Every Tier 0 Zod schema has unit tests (happy + malformed + null)
- [ ] Pino structured warnings logged for every validation failure (with workspaceId)
- [ ] No `as any` or `as unknown as Record` in Tier 1 files (replaced with type guards or validated parsers)
- [ ] All percentage fields documented with JSDoc unit annotation
- [ ] 888+ tests still passing
- [ ] Build still passing

---

## Estimated Effort

| Phase | Tasks | Est. Hours | Parallelizable? |
|-------|-------|-----------|-----------------|
| A: Foundation | 1 | 0.5h | No (must be first) |
| B: Tier 0 | 5 | 4-5h | Yes (all 5 in parallel) |
| C: Tier 0+ Tier 1 | 4 | 3-4h | Partially (9+10 parallel, 11+12 parallel) |
| D: Remaining + Docs | 3 | 2-3h | Yes |
| **Total** | **13** | **10-13h** | |

---

## Appendix: Full Audit Data

See agent audit output for complete file-by-file listing of all 194 JSON.parse locations with risk classifications.
