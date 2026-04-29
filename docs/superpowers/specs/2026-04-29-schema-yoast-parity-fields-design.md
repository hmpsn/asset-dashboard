# Schema Yoast-Parity Fields — Design Spec

**Status:** Design approved 2026-04-29. Ready for plan-writing.

**Authors:** Joshua Hampson + Claude (brainstorm session)

**Related work shipped first:**
- PR #362 — Pillar 2 (data wiring + cross-references)
- PR #366 — Pillar 2.1 (SearchAction correctness fix)
- PR #368 — Pillar 1 (validator bar; required fields per @type, cross-ref shape, value-shape rules)

**Deferred until after this work:**
- `schema-pillar-3-gates` — `schema-dts` compile-time types + `schemarama` CI corpus + cross-ref helper-import pr-check rule. Reactivation gated on completion of the migration queue described in §6.

---

## 1. Background

After the lean schema rewrite (PR #360) and Pillars 2 + 2.1 + 1, the schema generator produces structurally correct, Google-Rich-Results-eligible output. A fresh-eyes audit against the live hmpsn.studio surface identified a remaining gap: the output is **structurally correct but substantively thin** versus Yoast Premium / RankMath Pro parity.

Five high-leverage fields are missing despite the platform already having the data:
- `Service.areaServed` (from `BusinessProfile.address.city/state`) — local-SEO money for geo-targeted agencies
- `Service.serviceType` (URL-slug derivable) — Google taxonomy
- `Organization.knowsAbout` (from `keywordStrategy.siteKeywords`)
- `Article.keywords` (from `keywordStrategy.pageMap[]`)
- `WebSite.potentialAction` (sitelinks SearchAction; gated on a new `Workspace.siteHasSearch` flag — Pillar 2.1 dropped the unconditional emission because most sites have no search endpoint)

Plus an architectural correctness concern: today's `buildSchemaContext` reads workspace + intelligence data via direct field reads (`ws.brandVoice`, `getRawKnowledge(ws.id)`, etc.), while the rest of the platform standardized on `buildWorkspaceIntelligence({ slices: [...] })` slice consumption (used by AdminChat, content briefs, copy generation, rewrite chat, meeting briefs, content decay, internal links). Schema is the lone outlier.

The audit ran three parallel research agents (consumer-side, producer-side, feature-precedent) and confirmed:
- Schema generator (`server/schema/`) is **clean** — narrow typed boundary via `WorkspaceSchemaInput` (4 fields) + `PageMetaInput` (9 fields). Zero direct intelligence imports inside the generator package.
- The orchestrator's `SchemaContext` aggregator carries leftover unused `_*` scaffolding fields from prior iterations.
- Pattern B (slice consumption) is dominant across 7+ features; schema is the only Pattern A (custom context-builder) instance.

## 2. Goal

Ship Yoast-Premium-equivalent fields the platform already has data for, while planting the slice-consumption pattern that will let `buildSchemaContext` migrate to Pattern B incrementally.

## 3. Architectural decision: Trajectory 3 (hybrid + forcing functions)

Three trajectories were considered:

| | Trajectory 1 | Trajectory 2 | **Trajectory 3 (chosen)** |
|---|---|---|---|
| **What** | Refactor `buildSchemaContext` to full slice consumption first, then add parity-fields | Skip the refactor, add parity-fields directly to existing pattern | New parity-field reads use slice consumption; legacy reads stay; forcing functions install |
| **Cost** | 1-2 days refactor + retest before any user-visible change | Zero | ~70 min extra inside PR1 |
| **Aligns with platform Pattern B?** | Fully | No (preserves Schema as outlier) | Going-forward yes; legacy migrates as touched |
| **Risk** | Behavioural drift across many fields, discovered late | Schema stays an architectural outlier | Two patterns coexist temporarily |

**Trajectory 3 is the chosen path.** Reasons:
1. Doesn't block user-visible work — parity-fields ships in ~3 days, only ~half a day longer than Trajectory 2.
2. Sets the right pattern going forward (every new schema field lands as `Workspace → buildWorkspaceIntelligence({ slices: [...] }) → assembled-into → WorkspaceSchemaInput → generator`).
3. Avoids re-engineering working code. Pillar 2's existing reads (BusinessProfile, brandVoice, defaultLocale) work and are tested. Migrating them is risky for zero output change.
4. Aligns with CLAUDE.md: *"Where existing code has problems that affect the work, include targeted improvements as part of the design — the way a good developer improves code they're working in. Don't propose unrelated refactoring."*

Trajectory 3 is designed to **converge to Trajectory 1** via opportunistic migration, locked by forcing functions. See §6.

## 4. PR1 — Validator + fields + slice-migration starter

Single PR. ~2 days subagent-driven implementation. ~12-15 tasks.

### 4.1 Validator API refactor

`server/schema/validator.ts`:
- New `ValidationFinding` interface in `shared/types/schema-validation.ts`:
  ```typescript
  export interface ValidationFinding {
    severity: 'error' | 'warning';
    /** schema.org @type of the affected node */
    type: string;
    /** missing/malformed field (e.g. "publisher.logo") — undefined for whole-graph issues */
    field?: string;
    /** stable rule id for filtering / disable lists */
    ruleId: string;
    /** human-readable message for admin UI */
    message: string;
  }
  ```
- `validateLeanSchema()` returns `ValidationFinding[]`.
- `RequiredFields` extended to `{ required: string[]; recommended: string[] }` per `@type`.
- All 6 existing validator helpers (`validateBreadcrumb`, `validateCrossRefs`, `validateArticleShape`, `validateBreadcrumbOrdering`, `validateAbsoluteUrls`, `validateLocalBusinessShape`) return `ValidationFinding[]`.
- `LeanGeneratorOutput` gains `validationFindings: ValidationFinding[]` (typed); keeps `validationErrors: string[]` (severity=error only, message-flattened) for backwards-compat with existing snapshot storage.

Industry precedent: ESLint, TypeScript Compiler, RFC 7807 Problem Details. Stringly-typed prefixes were rejected as the protocol because they force every consumer to re-parse what should be a typed field.

### 4.2 SchemaContext cleanup

Delete the 5 unused leftover scaffolding fields confirmed dead by the pre-plan audit (§2.3 of `docs/superpowers/audits/2026-04-29-schema-yoast-parity-fields-audit.md`):
- `_planContext`, `_pageNode`, `_ancestors`, `_briefId`, `_pageAnalysis`

**Preserve** these three (the architectural audit was incomplete; the pre-plan audit caught it):
- `_architectureTree` — written 3 times in `server/jobs.ts` + `server/routes/webflow-schema.ts`; defer cleanup to a separate audit.
- `_existingErrors` — written once + test fixture references; staged for planned validator-error-deduplication feature.
- `_faqOpportunities` — **actively consumed** in `schema-suggester.ts:188-190` (FAQ enrichment branch).

Distinct from the §6 migration queue: these are dead-code deletions, not legacy patterns.

### 4.3 Six new template fields

| Field | Source | Tier | Slice migration? |
|---|---|---|---|
| `Service.areaServed` | `WorkspaceSchemaInput.businessProfile.address` (already wired Pillar 2) — emit `{ '@type': 'Place', name: '<city>, <state>' }` when both present, `{ name: '<city>' }` when only city, omit when neither | recommended | No (already typed boundary) |
| `LocalBusiness.areaServed` | Same source as Service.areaServed | recommended | No |
| `Service.serviceType` | URL slug capitalized (e.g. `/services/development` → `"Development"`); omit when slug is generic (`/services` root) | recommended | No (deterministic) |
| `Organization.knowsAbout` | Top 5 of `seoContext.keywordStrategy.siteKeywords` (deduped, lowercased; declined-keyword-filtered by the slice) | recommended | **YES — first slice migration** |
| `Article.keywords` | `intel.seoContext.pageKeywords.{primaryKeyword, secondaryKeywords}` from `seoContext` slice called with `pagePath`. Comma-joined string per Google docs. Omit when no pageMap entry. (Pre-plan audit correction: `PageProfileSlice` has no `secondaryKeywords` field — `seoContext.pageKeywords` is the canonical source per `shared/types/intelligence.ts:68-102`.) | recommended | **YES — second slice migration** |
| `WebSite.potentialAction` (gated) | `Workspace.siteHasSearch === true` + `?s={search_term_string}` template | recommended (when flag true) | No (per-entity DB field) |

Plus: new `Workspace.siteHasSearch?: boolean` field added to `shared/types/workspace.ts` + DB column via migration + Zod schema. Default `false` so output is unchanged on staging until PR2 ships the admin toggle.

### 4.4 Slice-migration starter (Trajectory 3 plant)

In `server/helpers.ts:buildSchemaContext`:
- Replace `ws.keywordStrategy?.siteKeywords` direct read with `intel.seoContext.strategy.siteKeywords`. **The slice does NOT apply the declined-keyword filter** (per pre-plan audit Q6 — confirmed via reading the assembler in `server/workspace-intelligence.ts:590`). The schema layer continues to call `getDeclinedKeywords(ws.id)` and apply the filter post-slice. Pushing the declined-filter into the slice itself is a separate roadmap follow-up (would benefit other slice consumers).
- For per-page schema generation, call `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath })` per page (the cache makes this cheap — 5-min LRU dedup + single-flight). The returned `intel.seoContext.pageKeywords` is a `PageKeywordMap` with both `primaryKeyword` and `secondaryKeywords` populated for that path. To preserve a single fetch per generation pass, call once at workspace level (no `pagePath`) and read `seoContext.strategy.pageMap[]`, indexed by path; OR call per-page (cached) — both are valid; integration test enforces one underlying API call per page-data shape.

Adds new fields to typed boundaries:
- `WorkspaceSchemaInput.siteKeywordsForKnowsAbout?: string[]`
- `PageMetaInput.pageKeywords?: { primary: string; secondary: string[] }`

### 4.5 Forcing functions (lock the migration path)

See §6 for full migration design. PR1 ships:
1. **pr-check rule** `schema-context-direct-read-not-on-allowlist` — flags any new `ctx.X = ws.Y` (or helper-call) line in `buildSchemaContext` outside the identity allow-list, unless inline-hatched.
2. **CLAUDE.md paragraph** under "Code Conventions" — formal convention.
3. **Roadmap entry** `schema-context-builder-pattern-b-migration` (status `in-progress`) listing the 5 remaining direct reads with target slice fields.

### 4.6 Frontend (minimal in PR1)

The schema admin UI today renders `validationErrors` as a list. Update to render `validationFindings` grouped by severity:
- Errors keep current red styling.
- Warnings get a new amber "Recommended" badge.
- Page header stat reads `findings.filter(f => f.severity === 'warning').length` for the warnings count.

Rich completeness widget (deep-links, profile-fields-missing summary) deferred to PR2.

### 4.7 Tests

- Validator: ~38 existing tests migrate from `toContain('string')` to `toContainEqual({ ruleId, ... })`.
- Templates: 6 new tests for the 6 new fields, plus 2 "field present in @graph" assertions per template using the new fields.
- Integration: 1 new test confirming the workspace-wide `pageProfile` slice fetch happens once per `generateSchemaSuggestions` call (not 28 times — would be a perf regression).
- Slice-migration: 1 unit test verifying `buildSchemaContext` reads `siteKeywords` from `seoContext` slice mock, not directly from workspace.

## 5. PR2 — Admin discoverability surfaces

Single PR. ~1-1.5 days. ~6-8 tasks.

**Goal:** Turn recommended-tier warnings into actionable admin UX. Each missing field becomes a one-click jump to the canonical write location. No new API endpoints — everything reads from existing data.

### 5.1 "Schema profile completeness" widget on the Schema page

Placement in `src/components/SchemaSuggester.tsx`: between the existing "Schema Site Plan Active" card and the "Pages / Validated / Existing Schemas" stat row.

Reads `validationFindings` from the snapshot (PR1 ships this). Computes completeness % = `(uniqueFields - missingFields) / uniqueFields`. Renders a progress bar + missing-field list. Each missing-field row is a button → navigates to the canonical write location via `?tab=...&focus=...` URL params. Receiver tabs already wire `useSearchParams` per CLAUDE.md's tab deep-link contract.

When 0 warnings: collapses to a small "✓ Schema profile complete" badge.

### 5.2 Read-only mirror in `BusinessProfileTab.tsx`

A new "Schema impact" SectionCard at the top listing the 5 fields outside this tab that affect schema, with ✓/✗ status and deep-links:
- Brand logo → White-Label Branding section
- Address → editable below within same tab
- Phone → editable below within same tab
- Social profiles → editable below within same tab
- Site has search endpoint → Features tab

Read-only — clicking either deep-links to the canonical write location or scrolls to the relevant field within the same tab. Zero data duplication, zero alternate write paths.

### 5.3 Microcopy on Logo URL field

`src/components/settings/FeaturesTab.tsx`. One-line helper text below the input:

> *Also used as publisher logo in your schema. Required for Article rich snippets in Google search results.*

### 5.4 `Workspace.siteHasSearch` admin toggle

`FeaturesTab.tsx`, in a new "Site capabilities" section near the Logo URL field. Checkbox + helper copy explaining the SearchAction effect and the URL pattern requirement (`https://yoursite.com/?s={query}`).

When toggled on: PR1's gated `WebSite.potentialAction` emission activates on next regenerate.

### 5.5 Enriched warning rendering

PR1 ships basic warning rendering (red errors + amber "Recommended" badges). PR2 adds:
- Click a warning row → expands to show suggested fix + deep-link.
- Group warnings by `field` (e.g. all 9 logo warnings collapse to one row "Publisher logo missing on 9 pages → upload in Settings · Features").
- Persistent "X validated · Y warnings · Z fixes available" summary in the page header.

### 5.6 Backend changes

**None.** PR1 already ships `validationFindings: ValidationFinding[]` on the snapshot output. The completeness widget computes its summary client-side. The mirror in `BusinessProfileTab` reads workspace + `validationFindings` from existing query hooks.

### 5.7 Tests

- Component tests: completeness widget renders correctly for 0/partial/full populated states.
- Component tests: each missing-field row's `onClick` navigates to the correct target URL (verifies the tab deep-link contract).
- Integration test: regenerate schema → completeness widget reflects new findings (no stale render).
- E2E (Playwright, optional): admin navigates to schema page with incomplete profile, clicks "missing social profiles," lands on `BusinessProfileTab` with the social-profiles input focused.

## 6. Migration plan — Trajectory 3 → Trajectory 1

### 6.1 Migration tracker

Roadmap entry `schema-context-builder-pattern-b-migration` (committed in PR1, status `in-progress`):

```
Direct reads in server/helpers.ts:buildSchemaContext to migrate:
  1. brandVoice            → seoContext.brandVoice
  2. businessContext       → seoContext.strategy.businessContext  (NB: NOT keywordStrategy)
  3. knowledgeBase         → seoContext.knowledgeBase
  4. _businessProfile      → seoContext.businessProfile
  5. _personasBlock        → seoContext.personas (AudiencePersona[]; formatting moves to schema layer)

PR1 of schema-yoast-parity-fields ports siteKeywords as the pattern anchor
(established outside this queue, since it ships with the PR rather than as
opportunistic follow-up). Identity fields (companyName, liveDomain, logoUrl,
workspaceId, _siteId, _defaultLocale) intentionally stay as direct reads —
they're per-entity DB fields, not on a slice.

Each migration is opportunistic — done when adjacent code is touched for other
reasons. Completion gates Pillar 3 reactivation.
```

### 6.2 pr-check rule

New rule **`schema-context-direct-read-not-on-allowlist`** in `scripts/pr-check.ts`:

- **Path filter:** `server/helpers.ts`
- **Detection:** scans the body of `buildSchemaContext` (boundary-delimited from the function declaration to the next exported function). Flags any line matching `ctx\.\w+\s*=\s*(ws\.|getRawKnowledge|buildPersonasContext|getInsights)` unless:
  - The right-hand side is in the identity allow-list: `ws.name`, `ws.id`, `ws.liveDomain`, `ws.brandLogoUrl` (plus the function-arg `siteId`)
  - OR an inline `// schema-context-direct-read-ok: <reason>` hatch is on the same line or directly above
- **Severity:** `error`
- **Lifecycle:** PR1 commits the rule with the allow-list = current state (current legacy reads grandfathered in via inline hatches added during PR1). Each migration PR removes a hatch as that field moves to slice consumption. When the queue is empty, the rule's allow-list is identity-fields-only.

### 6.3 CLAUDE.md convention

Added under "Code Conventions" → after the existing schema-context rules:

> **`buildSchemaContext` reads must use intelligence slices.** New data sources for schema generation are read via `buildWorkspaceIntelligence({ slices: [...] })` inside `server/helpers.ts:buildSchemaContext`. Direct workspace reads (`ctx.X = ws.Y`) are reserved for identity fields (`name`, `id`, `liveDomain`, `brandLogoUrl`, plus `_siteId`/`_defaultLocale`). All other fields must come from a slice. Five remaining direct reads (`brandVoice`, `businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`) are tracked in `data/roadmap.json:schema-context-builder-pattern-b-migration` for opportunistic migration. Net-new direct reads outside the identity allow-list require an inline `// schema-context-direct-read-ok: <reason>` hatch and a justification in the PR description. Enforced by pr-check.

### 6.4 Suggested migration order (when the trigger surfaces)

| # | Field | Trigger | Effort |
|---|---|---|---|
| 1 | `brandVoice` → `seoContext.brandVoice` | Next AI rewrite or content brief work that touches the brand voice path | 1h |
| 2 | `businessContext` → `seoContext.keywordStrategy.businessContext` | Next adjacent edit | 30min |
| 3 | `knowledgeBase` → `seoContext.knowledgeBase` | Next time knowledge-base related work happens | 1h |
| 4 | `_businessProfile` → `seoContext.businessProfile` | Next BusinessProfileTab change | 30min |
| 5 | `_personasBlock` → `seoContext.personas` (with formatting moving to schema layer) | Most disruptive — last | 2h |

If no organic triggers surface within 4-6 weeks of PR1 merge: file a dedicated cleanup PR to close out the queue.

### 6.5 Verification per migration step

Every migration PR includes:
- Unit test confirming the field reads from the slice mock (not the workspace directly).
- Chrome MCP regenerate-on-staging check confirming output is byte-identical to pre-migration (no behavioural change — pure refactor).
- pr-check confirms the allow-list shrinks by exactly one entry.

### 6.6 Migration completion criterion → Pillar 3 reactivation

When the roadmap entry flips to `status: done`:

1. **pr-check rule tightens** — allow-list becomes `[ws.name, ws.id, ws.liveDomain, ws.brandLogoUrl, siteId]` only. Any new `ctx.X = ws.Y` outside that list errors regardless of inline hatch.
2. **CLAUDE.md paragraph updates** — drops the migration-queue mention, becomes the steady-state rule.
3. **`buildSchemaContext` becomes ~30 lines** — almost entirely `intel.seoContext.X` assignments + identity passthrough.
4. **Pillar 3 reactivates** — `schema-dts` typed return values + `schemarama` CI corpus + cross-ref helper-import pr-check rule. The deferral was specifically because parity-fields would reshape templates; once parity-fields ships AND the architecture is settled, Pillar 3's typing layer can be added without future rework.

## 7. Out of scope

- `Article.mentions` — would require a new `client-name` CMS field per case study, or NLP heuristics. Park as a roadmap follow-up if real demand surfaces.
- `Article.about` typed-entity upgrade — current literal `"Case study"` works. Defer until we have `topicCluster`-driven rich `about` strategy.
- Healthcare subtype escalation (Dentist/Physician/etc.) — separate roadmap item `schema-intelligence-layer-v2`.
- FAQ-from-GSC enrichment — separate roadmap item.
- E-E-A-T author injection from content brief — separate roadmap item.
- "Site authors" feature for Person `author`/`employee` entities — separate product feature.
- Cross-page `@id` consistency validation (asserting `/#organization` is identical across all pages) — would require comparing schemas across the snapshot, not within a single document.
- Tightening `Article.publisher.logo` from required to recommended — already required in Pillar 1; specifically required by Google for Article rich result eligibility, so it stays required.

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Slice-fetch latency adds significant time to per-page generation loop | Medium | Workspace-wide `buildWorkspaceIntelligence` call once per generation pass, indexed by path for the per-page loop. 5-min cache per Agent 2's audit. Verified by integration test counting fetch calls. |
| `seoContext.keywordStrategy.siteKeywords` slice doesn't apply the declined-keyword filter the same way the direct read does | Low | Verify slice impl applies filter before PR1 lands. If not, slice gets fixed (one-line change) or schema-side applies the filter post-slice. |
| `validationFindings` consumers (existing snapshot UI, future Pillar 3 schemarama integration) require updates beyond the in-scope frontend changes | Low | Backward-compat field `validationErrors: string[]` stays alongside `validationFindings` for existing snapshot storage. Old snapshots unaffected. |
| Migration stalls — opportunistic triggers don't surface | Medium | 4-6 week deadline → dedicated cleanup PR. Roadmap entry visible in project tracking. |
| Two patterns coexist (direct reads + slice reads) confuses new contributors | Medium | CLAUDE.md paragraph + inline `// schema-context-direct-read-ok` hatches make the legacy reads explicit. Migration tracker is discoverable from roadmap.json. |
| pr-check rule false-positives on legitimate identity-field additions | Low | Allow-list explicit and small (5 entries); future identity additions extend it via PR review. |

## 9. Open questions / decisions deferred

None at design close. Plan-writing can begin after user spec review.

## 10. Estimates

| | Effort | When |
|---|---|---|
| **PR1** (validator + 6 fields + migration starter) | 2 days subagent-driven | Next sprint |
| **PR2** (admin discoverability surfaces) | 1-1.5 days subagent-driven | After PR1 merges |
| **Migration queue (5 entries)** | 5h cumulative across opportunistic PRs | 4-6 weeks |
| **Pillar 3 reactivation** | 1 day | After migration queue empties |
