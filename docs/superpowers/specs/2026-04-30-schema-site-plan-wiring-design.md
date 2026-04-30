# Schema Generator — Workstream D: Site Plan Wiring

**Date:** 2026-04-30
**Status:** Approved for implementation planning
**Depends on:** Workstream C (entity graph) — `SiteContext` and `SiteContextPage` must exist before D extends them
**Unlocks:** Agency-curated roles drive schema emission; junk pages are excluded from the snapshot

---

## Problem

The Schema Site Plan stores agency-curated `pageRoles` (24 role types, AI-generated then human-reviewed), but `generator.ts` and `schema-suggester.ts` never read them. The plan is descriptive only.

From the baseline audit:
- 8 pages should produce no schema (`/schedule/*` Calendly embeds, `/401`, `/404`) — generator runs against all 28 indiscriminately
- `/discovery` has Site Plan role `lead-gen` but emits plain `WebPage` — should emit `Service` + `potentialAction: ReserveAction`
- Site Plan role counts don't match generator output for `pillar`, `partnership`, `case-study` (count mismatch)
- Re-generation trigger: when agency changes a role, schema doesn't update automatically — requires manual per-page regenerate

---

## Architecture

Workstream D extends `SiteContext` and `SiteContextPage` introduced by Workstream C. It does not create a new threading mechanism — it enriches the existing one.

### `SiteContextPage` extension

Add three optional fields to `SiteContextPage` in `server/schema/site-context.ts`:

```typescript
export interface SiteContextPage {
  // ... C fields unchanged ...

  /** Agency-curated role from Site Plan. Undefined when no plan exists. */
  role?: SchemaPageRole;
  /** When true: skip schema generation; render excluded indicator in dashboard. */
  excluded?: boolean;
  /** @ids this page should reference, from Site Plan PageRoleAssignment.entityRefs. */
  entityRefs?: string[];
}
```

`assembleSiteContext` gains a `pageRoles` parameter (the caller reads the plan once and passes it in — keeps the assembler a pure function with no DB calls):

```typescript
// Updated signature (D extends C's):
export function assembleSiteContext(
  pages: WorkspacePage[],
  baseUrl: string,
  canonicalEntities: CanonicalEntity[] = [],
  pageRoles: PageRoleAssignment[] = [],   // NEW in D
): SiteContext

// Inside the page-classification loop:
const roleMap = new Map(pageRoles.map(r => [r.pagePath, r]));
const assignment = roleMap.get(page.publishedPath);
siteCtxPage.role = assignment?.role;
siteCtxPage.excluded = assignment?.excluded ?? false;
siteCtxPage.entityRefs = assignment?.entityRefs;
```

Callers pass `getSchemaPlan(siteId)?.pageRoles ?? []`. Falls back gracefully when no plan exists — `role`/`excluded`/`entityRefs` stay undefined, C's behavior is unchanged.

---

## Part 1: `PageRoleAssignment` data layer

### New field on `PageRoleAssignment` (`shared/types/schema-plan.ts`)

```typescript
export interface PageRoleAssignment {
  pagePath: string;
  pageTitle: string;
  role: SchemaPageRole;
  primaryType: string;
  entityRefs: string[];
  notes?: string;
  industrySubtype?: SchemaIndustrySubtype;
  /** When true, this page is excluded from schema generation entirely. */
  excluded?: boolean;
}
```

### AI prompt update (`server/schema-plan.ts`)

Add `excluded` to the JSON schema the AI returns. Instruct the AI to set `excluded: true` for:
- Pages under `/schedule/*` (Calendly or similar third-party booking embeds)
- Error pages: `/401`, `/404`, `/500`
- Any page whose title/URL signals it is a third-party iframe with no original indexable content

Agency can override `excluded` in either direction via the Site Plan review UI — same curate-after-AI pattern as roles.

---

## Part 2: Exclusion in orchestrator

### `SchemaPageSuggestion` gets `excluded` flag

```typescript
export interface SchemaPageSuggestion {
  // ... existing fields ...
  /** When true: schema was intentionally not generated. Page appears in dashboard with excluded indicator. */
  excluded?: boolean;
}
```

### `generateSchemaSuggestions` skip logic

Before fetching HTML or calling `generateLeanSchema` for a page:

```typescript
const pageCtx = siteContext?.pages.find(p => p.path === publishedPath);
if (pageCtx?.excluded) {
  results.push({
    pageId: page.id,
    pageTitle: page.title || '',
    slug: page.slug || '',
    url,
    excluded: true,
    existingSchemas: [],
    suggestedSchemas: [],
  });
  onProgress?.(results, false, `Skipped excluded page: ${publishedPath}`);
  continue;
}
```

Skipping HTML fetch for excluded pages avoids unnecessary network calls. Excluded pages still appear in the snapshot array so the dashboard can show them.

### Frontend: excluded indicator (`SchemaPageCard` or equivalent)

When `suggestion.excluded === true`:
- Render muted card (reduced opacity or grey surface)
- Badge: "Excluded — no schema generated"
- "Remove exclusion" button → calls existing `updateSchemaPlanRoles` endpoint, clears `excluded` flag on the relevant `PageRoleAssignment`, marks schema as stale (shows "Regenerate" prompt)

No new endpoints required. Stale state: after removing exclusion, the page shows its previous schema (if any) with a "Schema may be outdated — regenerate" indicator. Existing per-page regenerate button handles the refresh.

---

## Part 3: Role → @type override (fills gaps only)

### Strategy

After `classifyPage` runs in `generateLeanSchema`, check two conditions:
1. Classifier returned kind `WebPage` (URL pattern didn't match anything specific)
2. `siteContext` has a role assigned for this page

If both are true, use the role to override kind. If the classifier already identified the page as `Service`, `BlogPosting`, `Article`, etc., the role is ignored — classifier wins.

```typescript
let effectiveKind = classified.kind;
const pageCtx = input.siteContext?.pages.find(p => p.path === input.pageMeta.publishedPath);
if (effectiveKind === 'WebPage' && pageCtx?.role) {
  effectiveKind = roleToKind(pageCtx.role) ?? effectiveKind;
}
```

### Role → kind mapping

| Role | Effective kind | Template | Notes |
|------|---------------|----------|-------|
| `lead-gen` | `LeadGen` (new) | Service + `potentialAction: ReserveAction` | For booking/conversion pages like `/discovery` |
| `pillar` | `CaseStudy` (reuse) | Article + `about` field | Reuses Article template; about set to page description |
| `partnership` | `Partnership` (new) | WebPage + `mentions: Organization @id` | References the site's canonical Organization entity |
| `location` | `Homepage` with `businessKind: 'local'` | Reuses existing LocalBusiness template | For explicit location pages not at root path |
| `faq` | `WebPage` (no change) | FAQPage already appended by existing FAQ extractor when accordions found | Role confirms intent but extractor handles emission |
| `generic` | `WebPage` (no change) | No change — same as classifier fallback | |
| All other roles | `WebPage` (no change) | Fallback — role noted but no template override yet | Future PRs can extend the mapping |

### New template shapes

**`buildLeadGenSchema`** (new in `server/schema/templates/static.ts`):
```json
{
  "@type": "Service",
  "@id": "https://hmpsn.studio/discovery#service",
  "name": "Book a Discovery Call",
  "url": "https://hmpsn.studio/discovery",
  "description": "...",
  "provider": { "@id": "https://hmpsn.studio/#organization" },
  "potentialAction": {
    "@type": "ReserveAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://hmpsn.studio/discovery",
      "actionPlatform": ["http://schema.org/DesktopWebPlatform"]
    }
  }
}
```

**`buildPartnershipSchema`** (new in `server/schema/templates/static.ts`):
```json
{
  "@type": "WebPage",
  "@id": "https://hmpsn.studio/our-partnership#webpage",
  "url": "https://hmpsn.studio/our-partnership",
  "name": "Our Partnership",
  "description": "...",
  "mentions": { "@id": "https://hmpsn.studio/#organization" }
}
```

---

## PR structure

### D-PR1: Data layer + exclusion

Low risk. No generator changes. Immediate visible benefit: 8 junk pages excluded on next regeneration.

| File | Change |
|------|--------|
| `shared/types/schema-plan.ts` | Add `excluded?: boolean` to `PageRoleAssignment` |
| `server/schema-plan.ts` | AI prompt update — instruct exclusion assignment |
| `server/schema/site-context.ts` | Extend `SiteContextPage`; merge `role`/`excluded`/`entityRefs` from plan |
| `server/schema-suggester.ts` | Orchestrator skip for excluded pages |
| `server/schema-suggester.ts` | Add `excluded?: boolean` to `SchemaPageSuggestion` interface |
| `src/components/schema/SchemaPageCard.tsx` | Excluded indicator + remove-exclusion button |
| `tests/schema/site-context.test.ts` | Extend unit tests: role/excluded merging from plan |
| `tests/integration/schema-exclusion.test.ts` | New — assert excluded pages in snapshot, no schema generated |

### D-PR2: Role → @type override

Higher risk. Touches generator dispatch and introduces two new template shapes.

| File | Change |
|------|--------|
| `server/schema/generator.ts` | `roleToKind` helper; role-fills-gaps override after `classifyPage` |
| `server/schema/templates/static.ts` | `buildLeadGenSchema`, `buildPartnershipSchema` |
| `server/schema/validator.ts` | Any new required-field entries for new shapes |
| `tests/integration/schema-role-override.test.ts` | New — assert `/discovery` → Service+ReserveAction; partnership page → correct shape |

---

## Verification gates

**After D-PR1 (staging):**
- Re-run baseline audit: snapshot contains 28 entries, 8 with `excluded: true` and `suggestedSchemas: []`
- Dashboard shows 8 muted "Excluded" cards
- `npm run typecheck && npx vite build && npx vitest run` — zero failures

**After D-PR2 (staging):**
- `/discovery` snapshot entry emits `Service` with `potentialAction.@type === 'ReserveAction'`
- All 20 non-excluded pages still pass validator (zero new errors)
- `npm run typecheck && npx vite build && npx vitest run` — zero failures

---

## Implementation planning notes

Follow `docs/PLAN_WRITING_GUIDE.md`. Key constraints from `CLAUDE.md`:

- **Phase-per-PR:** D-PR2 must not start until D-PR1 is merged and green on staging.
- **Depends on C:** D-PR1 cannot be dispatched until C's `SiteContext`/`SiteContextPage` interfaces are committed. Pre-commit the interface extensions before any agent starts template work.
- **File ownership:** `shared/types/schema-plan.ts` is shared by both PRs — lock to one agent at a time.
- **Model assignments:** Data layer + exclusion wiring → Haiku; role-override dispatch + new templates → Sonnet; integration tests → Sonnet.
- **Data flow rule:** `SchemaPageSuggestion.excluded` flows into the snapshot JSON column — verify `parseJsonFallback` handles the new field gracefully on read (existing rows have no `excluded` field; absence must not crash the mapper).
- **Typed data contracts:** `excluded?: boolean` on `PageRoleAssignment` is optional — Zod schema in `server/schemas/` (if one exists for this type) must be updated to include it as `.optional()`. A required field absent from stored blobs causes `parseJsonSafe` to return the empty fallback, wiping all existing plan data.

---

## What this does NOT include

- Auto-regeneration on role change (deferred — would require background job infrastructure)
- Role-specific enrichment for `about` (team members as `Person` entities) and `contact` (contactPoint) — requires page content extraction, fits better in Workstream B or a future PR
- Role overrides for pages the classifier already identifies correctly (e.g. forcing `/about` to emit something other than `AboutPage`) — role fills gaps only; full override is a future capability
- `industrySubtype` escalation (Dentist, Physician, etc.) — deferred per existing `local-business.ts` comment
