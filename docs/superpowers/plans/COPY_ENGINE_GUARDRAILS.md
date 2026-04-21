# Copy & Brand Engine — Subagent Guardrails

> Companion document for the three Copy & Brand Engine implementation plans.
> **Every agent dispatcher MUST read this before dispatching subagents.**
>
> Plans governed:
> - `2026-03-26-brandscript-engine.md` (Phase 1)
> - `2026-03-27-page-strategy-engine.md` (Phase 2)
> - `2026-03-27-copy-pipeline.md` (Phase 3)
>
> Specs referenced:
> - `../specs/2026-03-26-brandscript-engine-design.md`
> - `../specs/2026-03-27-page-strategy-engine-design.md`
> - `../specs/2026-03-27-copy-pipeline-design.md`
>
> Rules: `docs/rules/multi-agent-coordination.md`

---

## Execution Order (Strict)

```
Phase 1: Brandscript Engine + Voice Calibration
  ↓ (Phase 1 fully complete, committed, verified)
Phase 2: Page Strategy Engine
  ↓ (Phase 2 fully complete, committed, verified)
Phase 3: Full Copy Pipeline
```

**No phase overlap.** Phase 2 reads from Phase 1 tables and imports Phase 1 types. Phase 3 reads from both. Starting Phase 2 before Phase 1 is committed will cause import failures and missing tables.

**Verification gate between phases:**
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] All Phase N tables exist in `data/app.db`
- [ ] All Phase N exported functions are importable
- [ ] All Phase N shared types compile correctly

---

## Cross-Phase Contracts

### Phase 1 → Phase 2

**Database tables Phase 2 reads from:**
| Table | Used for |
|-------|----------|
| `brandscripts` | Blueprint generator pulls brand context |
| `brandscript_sections` | Section content for AI generation prompts |
| `voice_profiles` | Voice DNA informs brand notes on section plans |
| `brand_identity_deliverables` | Messaging pillars inform page recommendations |

**Exported functions Phase 2 calls:**
| Function | Module | Signature |
|----------|--------|-----------|
| `getBrandscript` | `server/brandscript.ts` | `(workspaceId: string, id: string) → Brandscript \| null` |
| `buildBrandscriptContext` | `server/seo-context.ts` | `(workspaceId: string, emphasis?: ContextEmphasis) → string` |
| `buildVoiceProfileContext` | `server/seo-context.ts` | `(workspaceId: string, emphasis?: ContextEmphasis) → string` |
| `buildIdentityContext` | `server/seo-context.ts` | `(workspaceId: string, emphasis?: ContextEmphasis) → string` |

**Shared types Phase 2 imports:**
| Type | Module |
|------|--------|
| `Brandscript`, `BrandscriptSection` | `shared/types/brand-engine.ts` |
| `VoiceProfile`, `VoiceDNA` | `shared/types/brand-engine.ts` |
| `BrandDeliverable`, `DeliverableType` | `shared/types/brand-engine.ts` |
| `ContextEmphasis` | `shared/types/brand-engine.ts` |

### Phase 2 → Phase 3

**Database tables Phase 3 reads from:**
| Table | Used for |
|-------|----------|
| `site_blueprints` | Top-level project context |
| `blueprint_entries` | Section plans, keywords, page types — the source of truth for copy generation |
| `blueprint_versions` | Version snapshots include brief_id references |

**Exported functions Phase 3 calls:**
| Function | Module | Signature |
|----------|--------|-----------|
| `getBlueprint` | `server/page-strategy.ts` | `(workspaceId: string, blueprintId: string) → SiteBlueprint \| null` |
| `addEntry` / `updateEntry` | `server/page-strategy.ts` | Entry CRUD (Phase 3 sets `brief_id`) |
| `PAGE_TYPE_CONFIGS` | `server/content-brief.ts` | Word count ranges, section counts per page type |

**Shared types Phase 3 imports:**
| Type | Module |
|------|--------|
| `SiteBlueprint`, `BlueprintEntry` | `shared/types/page-strategy.ts` |
| `SectionPlanItem`, `SectionType`, `NarrativeRole` | `shared/types/page-strategy.ts` |
| `ContentPageType` | `shared/types/content.ts` (unified enum — NOT `BlueprintPageType`) |

**UI components Phase 3 reuses:**
| Component | Module | Notes |
|-----------|--------|-------|
| `SteeringChat` | `src/components/brand/SteeringChat.tsx` | Must include auto-summarization (spec addendum 1) |
| `BlueprintDetail` | `src/components/brand/BlueprintDetail.tsx` | Phase 3 adds Copy tab to this component |

### Phase 1 → Phase 3 (direct)

**Exported functions Phase 3 calls:**
| Function | Module | Signature |
|----------|--------|-----------|
| `addVoiceSample` | `server/voice-calibration.ts` | `(workspaceId, content, contextTag, source) → VoiceSample` |
| `buildBrandscriptContext` | `server/seo-context.ts` | With `emphasis` parameter for smart context selection |
| `buildVoiceProfileContext` | `server/seo-context.ts` | With `emphasis` parameter |
| `buildIdentityContext` | `server/seo-context.ts` | With `emphasis` parameter |
| `PROMPT_TYPE_TO_SECTION_TYPE` | `shared/types/brand-engine.ts` | Maps calibration prompt types to Phase 2 section types |

---

## Phase 1: Task Dependencies & File Ownership

### Task Dependency Graph

```
Sequential foundation:
  Task 1 (Migration 053) → Task 2 (Shared Types)

Parallel services (after Task 2):
  Task 3 (Brandscript Service) ∥ Task 4 (Discovery Ingestion) ∥ Task 5 (Voice Calibration) ∥ Task 6 (Brand Identity)

Sequential shared-file tasks (after parallel batch):
  Task 7 (SEO Context Builders) — modifies server/seo-context.ts
  Task 8 (App.ts Route Registration) — modifies server/app.ts
  Task 9 (Brand Engine API Client) — creates src/api/brand-engine.ts

Parallel frontend (after Task 9):
  Task 10 (BrandscriptTab) ∥ Task 11 (DiscoveryTab) ∥ Task 12 (VoiceTab) ∥ Task 13 (IdentityTab)

Sequential shared frontend (after parallel batch):
  Task 14 (SteeringChat — shared component)
  Task 15 (BrandHub.tsx integration) — modifies src/components/BrandHub.tsx
```

### Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 1 (Migration 053) | `haiku` | Mechanical SQL from plan |
| Task 2 (Shared Types) | `haiku` | Transcribing types + constants from spec |
| Task 3 (Brandscript Service) | `sonnet` | CRUD patterns with edge-case judgment |
| Task 4 (Discovery Ingestion) | `sonnet` | CRUD patterns with edge-case judgment |
| Task 5 (Voice Calibration) | `sonnet` | CRUD patterns with edge-case judgment |
| Task 6 (Brand Identity) | `sonnet` | CRUD + auto-voice-sample hook logic |
| Task 7 (SEO Context Builders) | `opus` | Emphasis branching logic, brand context design |
| Task 8 (App.ts Routes) | `haiku` | Mechanical route registration |
| Task 9 (API Client) | `haiku` | Mechanical typed fetch wrappers |
| Task 10 (BrandscriptTab) | `sonnet` | UI with established patterns |
| Task 11 (DiscoveryTab) | `sonnet` | UI with established patterns |
| Task 12 (VoiceTab) | `sonnet` | UI with established patterns |
| Task 13 (IdentityTab) | `sonnet` | UI with established patterns |
| Task 14 (SteeringChat) | `opus` | High reuse surface + auto-summarization logic |
| Task 15 (BrandHub integration) | `sonnet` | Adding tab to existing pattern |

### File Ownership Map

| File | Owner | Phase |
|------|-------|-------|
| `server/db/migrations/053-brandscript-engine.sql` | Task 1 | Sequential |
| `shared/types/brand-engine.ts` | Task 2 | Sequential |
| `server/brandscript.ts` | Task 3 | Parallel batch 1 |
| `server/routes/brandscript.ts` | Task 3 | Parallel batch 1 |
| `server/discovery-ingestion.ts` | Task 4 | Parallel batch 1 |
| `server/routes/discovery-ingestion.ts` | Task 4 | Parallel batch 1 |
| `server/voice-calibration.ts` | Task 5 | Parallel batch 1 |
| `server/routes/voice-calibration.ts` | Task 5 | Parallel batch 1 |
| `server/brand-identity.ts` | Task 6 | Parallel batch 1 |
| `server/routes/brand-identity.ts` | Task 6 | Parallel batch 1 |
| `server/seo-context.ts` | Task 7 | Sequential |
| `server/app.ts` | Task 8 | Sequential |
| `src/api/brand-engine.ts` | Task 9 | Sequential |
| `src/components/brand/BrandscriptTab.tsx` | Task 10 | Parallel batch 2 |
| `src/components/brand/DiscoveryTab.tsx` | Task 11 | Parallel batch 2 |
| `src/components/brand/VoiceTab.tsx` | Task 12 | Parallel batch 2 |
| `src/components/brand/IdentityTab.tsx` | Task 13 | Parallel batch 2 |
| `src/components/brand/SteeringChat.tsx` | Task 14 | Sequential |
| `src/components/BrandHub.tsx` | Task 15 | Sequential |

---

## Phase 2: Task Dependencies & File Ownership

### Task Dependency Graph

```
Sequential foundation:
  Task 1 (Migration 054) → Task 2 (Shared Types + content.ts extension)

Parallel services (after Task 2):
  Task 3 (Blueprint CRUD) ∥ Task 4 (Blueprint Generator)

Sequential shared-file tasks (after parallel batch):
  Task 5 (Routes — includes reorder before param routes!) — creates server/routes/page-strategy.ts
  Task 6 (App.ts route registration) — modifies server/app.ts
  Task 7 (API client additions) — modifies src/api/brand-engine.ts

Parallel frontend (after Task 7):
  Task 8 (PageStrategyTab) ∥ Task 9 (BlueprintDetail) ∥ Task 10 (VersionHistory)

Sequential shared frontend (after parallel batch):
  Task 11 (BrandHub.tsx — add Page Strategy tab)
```

### Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 1 (Migration 054) | `haiku` | Mechanical SQL from plan |
| Task 2 (Shared Types + content.ts) | `haiku` | Transcribing types from spec; re-export pattern is trivial |
| Task 3 (Blueprint CRUD) | `sonnet` | CRUD with ID-stability logic requires judgment |
| Task 4 (Blueprint Generator) | `opus` | AI prompt design, brand context integration |
| Task 5 (Routes) | `haiku` | Mechanical route + middleware wiring |
| Task 6 (App.ts route registration) | `haiku` | Mechanical |
| Task 7 (API client additions) | `haiku` | Typed fetch wrappers |
| Task 8 (PageStrategyTab) | `sonnet` | UI with established patterns |
| Task 9 (BlueprintDetail) | `sonnet` | UI with established patterns |
| Task 10 (VersionHistory) | `sonnet` | UI with established patterns |
| Task 11 (BrandHub integration) | `sonnet` | Adding tab to existing pattern |

### File Ownership Map

| File | Owner | Phase |
|------|-------|-------|
| `server/db/migrations/054-page-strategy-engine.sql` | Task 1 | Sequential |
| `shared/types/page-strategy.ts` | Task 2 | Sequential |
| `shared/types/content.ts` | Task 2 | Sequential (extend ContentPageType + TemplateSection) |
| `server/page-strategy.ts` | Task 3 | Parallel batch 1 |
| `server/blueprint-generator.ts` | Task 4 | Parallel batch 1 |
| `server/routes/page-strategy.ts` | Task 5 | Sequential |
| `server/app.ts` | Task 6 | Sequential |
| `src/api/brand-engine.ts` | Task 7 | Sequential |
| `src/components/brand/PageStrategyTab.tsx` | Task 8 | Parallel batch 2 |
| `src/components/brand/BlueprintDetail.tsx` | Task 9 | Parallel batch 2 |
| `src/components/brand/BlueprintVersionHistory.tsx` | Task 10 | Parallel batch 2 |
| `src/components/BrandHub.tsx` | Task 11 | Sequential |

---

## Phase 3: Task Dependencies & File Ownership

### Task Dependency Graph (Tier 1 — Core Pipeline)

```
Sequential foundation:
  Task 1 (Migration 055) → Task 2 (Shared Types) → Task 3 (Export existing constants)

Parallel services (after Task 3):
  Task 4 (Copy Review Service) ∥ Task 5 (Copy Generation Engine) ∥ Task 6 (Copy Intelligence Service) ∥ Task 7 (Copy Export Service)

Sequential shared-file tasks (after parallel batch):
  Task 8 (SEO Context — add buildCopyIntelligenceContext + buildBlueprintContext)
  Task 9 (Routes) — creates server/routes/copy-pipeline.ts
  Task 10 (App.ts route registration)
  Task 11 (API client additions) — modifies src/api/brand-engine.ts

Parallel frontend (after Task 11):
  Task 12 (CopyReviewPanel) ∥ Task 13 (BatchGenerationPanel) ∥ Task 14 (CopyExportPanel) ∥ Task 15 (CopyIntelligenceManager)

Sequential integration:
  Task 16 (BlueprintDetail.tsx — add Copy tab)
```

### Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 1 (Migration 055) | `haiku` | Mechanical SQL from plan |
| Task 2 (Shared Types) | `haiku` | Transcribing types from spec |
| Task 3 (Export constants) | `haiku` | Re-exporting existing symbols only |
| Task 4 (Copy Review Service) | `sonnet` | Review logic with quality-flag patterns |
| Task 5 (Copy Generation Engine) | `opus` | Core AI generation, quality rules, brand prompt engineering |
| Task 6 (Copy Intelligence Service) | `opus` | Pattern analysis, intelligence scoring across corpus |
| Task 7 (Copy Export Service) | `sonnet` | Format conversion with established patterns |
| Task 8 (SEO Context builders) | `sonnet` | Adding to existing context builder pattern |
| Task 9 (Routes) | `haiku` | Mechanical route wiring |
| Task 10 (App.ts) | `haiku` | Mechanical route registration |
| Task 11 (API client) | `haiku` | Typed fetch wrappers |
| Task 12 (CopyReviewPanel) | `sonnet` | UI with established patterns |
| Task 13 (BatchGenerationPanel) | `sonnet` | UI with established patterns |
| Task 14 (CopyExportPanel) | `sonnet` | UI with established patterns |
| Task 15 (CopyIntelligenceManager) | `sonnet` | UI with established patterns |
| Task 16 (BlueprintDetail copy tab) | `sonnet` | Extending existing component |

### File Ownership Map

| File | Owner | Phase |
|------|-------|-------|
| `server/db/migrations/055-copy-pipeline.sql` | Task 1 | Sequential |
| `shared/types/copy-pipeline.ts` | Task 2 | Sequential |
| `server/content-posts-ai.ts` | Task 3 | Sequential (export only) |
| `server/content-brief.ts` | Task 3 | Sequential (export only) |
| `server/copy-review.ts` | Task 4 | Parallel batch 1 |
| `server/copy-generation.ts` | Task 5 | Parallel batch 1 |
| `server/copy-intelligence.ts` | Task 6 | Parallel batch 1 |
| `server/copy-export.ts` | Task 7 | Parallel batch 1 |
| `server/seo-context.ts` | Task 8 | Sequential |
| `server/routes/copy-pipeline.ts` | Task 9 | Sequential |
| `server/app.ts` | Task 10 | Sequential |
| `src/api/brand-engine.ts` | Task 11 | Sequential |
| `src/components/brand/CopyReviewPanel.tsx` | Task 12 | Parallel batch 2 |
| `src/components/brand/BatchGenerationPanel.tsx` | Task 13 | Parallel batch 2 |
| `src/components/brand/CopyExportPanel.tsx` | Task 14 | Parallel batch 2 |
| `src/components/brand/CopyIntelligenceManager.tsx` | Task 15 | Parallel batch 2 |
| `src/components/brand/BlueprintDetail.tsx` | Task 16 | Sequential |

---

## Missing Spec Addendum Items → Plan Tasks

These spec addendum requirements are NOT currently reflected in the implementation plans. Each must be added as an explicit task or step.

### Phase 1 Plan — Missing Items

**1. VoiceSampleSource future values** (Spec Addendum §2)
- **Where to add:** Task 2 (Shared Types)
- **Change:** Add `'copy_approved' | 'identity_approved'` to `VoiceSampleSource` type
- **Why:** Phase 3 writes approved copy back as voice samples. Without these values in the type, the implementer invents inconsistent strings.

**2. ContextEmphasis parameter** (Spec Addendum §3)
- **Where to add:** Task 7 (SEO Context Builders)
- **Change:** All three new builder functions (`buildBrandscriptContext`, `buildVoiceProfileContext`, `buildIdentityContext`) must accept optional `emphasis?: ContextEmphasis` parameter (`'full' | 'summary' | 'minimal'`). Default to `'full'`. Add `ContextEmphasis` type to `shared/types/brand-engine.ts` (Task 2).
- **Why:** Phase 3 uses smart context selection per page type. Without emphasis control, every generation gets the same massive payload.

**3. PROMPT_TYPE_TO_SECTION_TYPE mapping** (Spec Addendum §4)
- **Where to add:** Task 2 (Shared Types) — add to `shared/types/brand-engine.ts`
- **Change:** Create the mapping constant that maps calibration prompt types to Phase 2 section types. Phase 3 queries this to find best voice samples per section type.
- **Constant:**
  ```typescript
  export const PROMPT_TYPE_TO_SECTION_TYPE: Record<string, string> = {
    'hero_headline': 'hero',
    'about_intro': 'about-team',
    'service_body': 'features-benefits',
    'cta_copy': 'cta',
    'faq_answer': 'faq',
    'testimonial_copy': 'testimonials',
    'blog_intro': 'content-body',
    'meta_description': 'seo-meta',
  };
  ```

**4. Brand Identity auto-creates voice samples** (Spec Addendum §5)
- **Where to add:** Task 6 (Brand Identity Service)
- **Change:** When a tagline, elevator pitch, or tone example is approved (status → `'approved'`), auto-call `addVoiceSample()` with `source: 'identity_approved'` and appropriate `context_tag` mapping:
  - Approved tagline → `context_tag: 'headline'`
  - Approved elevator pitch → `context_tag: 'body'`
  - Approved tone example → matching `context_tag`
- **Why:** These are the highest-quality voice samples the system produces. Not using them wastes the best training data.

**5. SteeringChat auto-summarization** (Spec Addendum §1)
- **Where to add:** Task 14 (SteeringChat Component)
- **Change:** After 6 steering exchanges, auto-summarize prior exchanges into a condensed block. Recent 3 exchanges stay in full. Summarization uses GPT-4.1-mini. Store summary on the session record.
- **Reference implementation:** `server/routes/rewrite-chat.ts` — look for the `summarizeConversation` pattern.
- **Why:** Phase 3 produces 10+ rounds of steering per section across dozens of pages. Without summarization, context windows fill with stale notes.

### Phase 2 Plan — Missing Items

**6. Unified ContentPageType (not BlueprintPageType)** (Spec Addendum §2)
- **Where to add:** Task 2 (Shared Types)
- **Change:** Do NOT create a separate `BlueprintPageType`. Instead, extend `ContentPageType` in `shared/types/content.ts` with the new values (`homepage`, `about`, `contact`, `faq`, `testimonials`, `custom`). Import and use `ContentPageType` everywhere in `page-strategy.ts`.
- **Why:** Phase 3 uses page type to select generation instructions. Two separate enums causes type errors or runtime mismatches.

**7. Section plan item IDs must be stable UUIDs** (Spec Addendum §6)
- **Where to add:** Task 3 (Blueprint CRUD) — `addEntry()` and `bulkAddEntries()`
- **Change:** When creating section plan items, generate UUIDs for each item. When updating entries, preserve existing IDs for existing sections. Only generate new IDs for newly added sections. Never regenerate IDs when content, order, or type changes.
- **Why:** Phase 3's `copy_sections.section_plan_item_id` references these IDs. If they change, approved copy becomes orphaned.

**8. Default section plans use PAGE_TYPE_CONFIGS** (Spec Addendum §3)
- **Where to add:** Task 4 (Blueprint Generator)
- **Change:** Import `PAGE_TYPE_CONFIGS` from `server/content-brief.ts`. Use its word count ranges instead of hardcoding values in `DEFAULT_SECTION_PLANS`.
- **Why:** Phase 3 auto-generates a brief from the blueprint entry. Conflicting word counts between blueprint and brief confuse the copy generator.

### Phase 3 Plan — Items to Verify

Phase 3 plan already includes most spec addendum items (quality rules, AEO principles, brief enrichment, copy intelligence). Verify these are implemented:

- [ ] `copy_approved` voice sample feedback loop (Plan Task ~20) — confirmed present
- [ ] `WRITING_QUALITY_RULES` import (Plan Task 5) — verify exported in Phase 3 Task 3
- [ ] Content Brief auto-generation before copy (Enhancement 1) — verify `brief_id` set on entry
- [ ] Quality flags column on `copy_sections` (Enhancement 4) — verify in migration

---

## Pre-Dispatch Checklist

Run this before dispatching any task batch. Takes 2 minutes; prevents 2-hour rollbacks.

### Before ANY batch dispatch

- [ ] This guardrails doc has been read in the current session
- [ ] The phase's verification gate has passed (tsc + build + tables exist)
- [ ] All shared contracts (types, function signatures, constants) are committed
- [ ] Implementer prompt includes file ownership list (OWNS / READ-ONLY)
- [ ] Implementer prompt includes cross-phase dependencies for any Phase N imports
- [ ] Model is selected from the phase's Model Assignments table above

### Before PARALLEL batch dispatch (extra steps)

- [ ] No two agents in the batch own the same file
- [ ] Every shared-file task is in a SEQUENTIAL slot (not this batch)
- [ ] Each agent's OWNS list has been cross-checked against other agents in this batch

### After PARALLEL batch completes (before next batch)

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vitest run` — full test suite passing (not just new tests)
- [ ] **Invoke `scaled-code-review` skill** — multi-agent review of the batch output. This catches cross-module issues, compliance violations, and logic bugs that single-file review misses. The skill auto-scales agent count based on change size.
- [ ] Fix all Critical and Important issues before dispatching next batch

### Agent BLOCKED / NEEDS_CONTEXT recovery

- **NEEDS_CONTEXT** — provide the missing information, re-dispatch same task, same model
- **BLOCKED (context problem)** — provide more context, re-dispatch same model
- **BLOCKED (task too large)** — break task into 2, dispatch subtask 1 first
- **BLOCKED (plan wrong)** — stop, escalate to human, do not force retry
- **DONE_WITH_CONCERNS** — read concerns before proceeding. Correctness/scope concerns → resolve first. Observational notes → log and continue.

---

## Known Gotchas (Include in Agent Prompts)

When dispatching subagents for any phase, include these codebase-specific warnings:

1. **Express route ordering** — literal routes (`/entries/reorder`) MUST be registered before parameterized routes (`/entries/:entryId`). Express matches in registration order.
2. **Prepared statements** — use the `stmts()` lazy cache pattern (see `server/approvals.ts`). Never store prepared statements in local variables.
3. **JSON column parsing** — use `parseJsonSafe` / `parseJsonSafeArray` from `server/db/json-validation.ts`. Never bare `JSON.parse` on DB columns.
4. **Import placement** — imports go at the top of the file with existing imports. Never mid-file.
5. **ID generation** — All phases use `randomUUID()` from Node `crypto`. Pattern: `prefix_${randomUUID().slice(0, 8)}` (e.g., `bs_a1b2c3d4`). See plan Amendments §2.
6. **Three-state booleans** — SQLite uses 0/1/NULL for boolean columns. Map correctly in `rowToX()` converters.
7. **Zod field names** — when writing Zod schemas for existing TypeScript interfaces, cross-reference field names against the source interface. Zod won't flag name mismatches at compile time.

---

## Revision Log

| Date | Change |
|------|--------|
| 2026-03-28 | Initial creation — audit of 3 specs + 3 plans |
| 2026-03-28 | Added model assignments per task (all 3 phases), pre-dispatch checklist, BLOCKED recovery guide |
| 2026-03-28 | Migration numbers updated: 026→041, 027→042, 028→043. ID generation updated to `randomUUID()` convention. See plan Amendments section for full list of 9 pattern alignment corrections. |
| 2026-04-09 | Migration numbers updated again: 041→053, 042→054, 043→055. Migrations 041–052 have since shipped. Current highest: 052-workspace-competitor-fetch.sql. |
| 2026-04-09 | Added Phase 1 Review — Recurring Patterns section (6 bug patterns from 7 rounds of PR #161 review). |

---

## Phase 1 Review — Recurring Patterns

> These patterns were caught during 7 rounds of code review on Phase 1 (PR #161). Phase 2 and Phase 3 agents must read this section before writing any server-side code.

### 1. Workspace scoping in every WHERE clause

Every `UPDATE`, `DELETE`, and non-PK `SELECT` on a brand-engine table must include `AND workspace_id = ?` even when the row is also keyed by `id`. Defence-in-depth: a mis-routed request must not leak another workspace's rows.

**Brand-engine tables:** `brandscripts`, `brandscript_sections`, `discovery_sources`, `discovery_extractions`, `voice_profiles`, `voice_samples`, `voice_calibration_sessions`, `brand_identity_deliverables`, `brand_identity_versions`, `site_blueprints` (Phase 2), `blueprint_entries` (Phase 2), `copy_sections` (Phase 3).

For tables with FK-only workspace scoping (e.g. `voice_samples` → `voice_profile_id` → `voice_profiles.workspace_id`), queries must JOIN through to the workspace or use the profile id obtained from a workspace-scoped read.

### 2. AI-call-before-DB-write race

When a handler `await`s an AI call (~5s) and then writes to the DB, two concurrent requests can both observe "no existing row" and both INSERT duplicates. This will happen in every blueprint generator, copy generator, and calibration endpoint in Phase 2 and Phase 3.

**Required pattern for 1:1-per-workspace tables (one row per workspace+type):**
- UNIQUE index on `(workspace_id, natural_key)` in the migration
- Existence check + INSERT/UPDATE inside `db.transaction()`
- Catch `SQLITE_CONSTRAINT_UNIQUE` and retry as UPDATE

**Required pattern for 1:N tables (many rows per source):**
- `force` flag + guard against re-processing (return 409 via a custom error class)
- On `force`, delete existing child rows INSIDE the transaction before inserting new ones

Full patterns with code examples: `docs/rules/ai-dispatch-patterns.md`

### 3. Prompt Layer 2 contract — do not duplicate voice DNA

`buildSystemPrompt` in `server/prompt-assembly.ts` injects voice DNA + guardrails into the system message when `profile.status === 'calibrated'` (Layer 2). Any user-prompt code that also inlines voice DNA must guard on `profile.status !== 'calibrated'`.

**Use the helper:** import `buildVoiceCalibrationContext(profile)` from `server/voice-calibration.ts`. Returns `{ samplesText, dnaText, guardrailsText }` where `dnaText` and `guardrailsText` are empty strings when calibrated.

Do not build your own inline voice context injection — it will duplicate Layer 2 once the profile is calibrated.

### 4. Delete-then-reinsert batch updates must preserve metadata

The batch-save pattern (delete-all + reinsert) is used for brandscript sections, voice samples ordering, and any future collection edit UI. This clobbers `created_at` and `sort_order`.

Before the delete, build `Map<id, { createdAt, sortOrder }>` and re-apply on insert:
```typescript
const existingMeta = new Map(existing.items.map(i => [i.id, { createdAt: i.createdAt, sortOrder: i.sortOrder }]));
// ... delete ...
const meta = (item.id && existingMeta.get(item.id)) || { createdAt: now, sortOrder: i };
```

### 5. PATCH undefined vs null on multi-column UPDATEs

When a PATCH endpoint updates 2+ columns and one is optional (e.g. a routing destination), use separate prepared statements: one that updates all columns (when the optional field is explicitly provided) and one that updates only the non-optional columns (when the optional field is absent). A single statement that always writes all columns silently clears the optional field when the caller omits it.

See `updateExtractionStatus` in `server/discovery-ingestion.ts` for the two-statement pattern.

### 6. getOrCreate* functions must return non-nullable types

Functions named `getOrCreate*` always return a valid entity. Their return type must not include `| null`. Callers must not have a dead `if (!result)` guard.

---

### Pre-flight checklist for Phase 2 and Phase 3 tasks

Before marking any Phase 2 or Phase 3 implementation task as done, verify:
- [ ] Every new `db.prepare()` SELECT/UPDATE/DELETE on a workspace-scoped table includes `AND workspace_id = ?`
- [ ] Every AI-generating endpoint that writes a 1:1-per-workspace row has a UNIQUE index + `db.transaction()` + SQLITE_CONSTRAINT_UNIQUE retry
- [ ] Every AI-generating endpoint that writes 1:N rows has a `force` flag + 409 guard + transactional delete-before-reinsert on force
- [ ] `json: true` passed to every `callCreativeAI` call whose result goes to `parseJsonFallback`
- [ ] Voice context in user prompts built via `buildVoiceCalibrationContext(profile)`, not inline
- [ ] Batch-save UX preserves `created_at` and `sort_order` via pre-delete `Map`
- [ ] PATCH endpoints with optional fields use separate statements per field set
