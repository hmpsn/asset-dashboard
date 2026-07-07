# Wave 3 BUILD TICKET - Schema (surface `schema`, Page `seo-schema`)

> **Surface:** admin Schema surface, live `Page 'seo-schema'` (`src/routes.ts:6`) in Optimization nav (`src/lib/navRegistry.tsx:143-147`, `needsSite: true`).
> **HEAD component + mount:** `SchemaSuggester` (`src/components/SchemaSuggester.tsx:81-88`, `?tab=generator|guide` receiver) mounted from `src/App.tsx:423` with `siteId`, `workspaceId`, `fixContext`, `businessProfile`, and `intelligenceProfile`.
> **Wave:** W3 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **XL** (`docs/ui-rebuild/phase-a/surfaces/schema.json:464-469`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` (especially §5 score authority, §7 structural template, §8 tests) -> `surfaces/schema.json` -> `phase0/surfaces/schema.md` -> `docs/rules/schema-entity-resolution.md` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through one `REBUILT_SURFACES['seo-schema']` entry (`src/components/layout/rebuiltSurfaces.ts:5-19`). Flag-OFF remains byte-identical legacy `SchemaSuggester` in `App.tsx:423`. Source gap: the task text says `Page "schema"` / `REBUILT_SURFACES['schema']`, but the live `Page` union has only `seo-schema` (`src/routes.ts:6`); do not invent a new route id.
> **Frozen/domain law:** Frozen Contract #11 freezes `schema_item` / `schema_plan` deliverables (`CROSS_SURFACE_CONTRACTS.md:61-73`, `shared/types/client-deliverable.ts:18-23`, `server/db/migrations/111-client-deliverable.sql:16-28`). Entity disambiguation stays server-side under `server/intelligence/entity-resolution*`; pr-check rule `Wikidata disambiguation outside entity-resolution intelligence modules` guards that boundary (`docs/rules/schema-entity-resolution.md:14-32`).

---

## 1. ⚠ OWNER DELTAS

Most schema questions adopt the documented default, but two cross-reference gaps are real and must stay visible: (1) the task names a `schema` Page key while source truth is `seo-schema`, and (2) AD-011's `surfaces` array omits schema even though this ticket still applies the prompt's zero-drop/additive-parity floor. No owner decision is invented here.

| Discovery OQ / N / Q | Resolution | Backing |
|---|---|---|
| Q1 - Schema Site Plan subsystem has no prototype home | **Adopt default:** bridge-mount existing `SchemaPlanPanel` inside the rebuilt surface as T1 carry-over; redesign later. | `schema.json:331-337`; Phase 0 Q1 `phase0/surfaces/schema.md:158-161`; AD-010 explicitly lists `SchemaPlanPanel` (`owner-decisions.json:140-155`); live panel `SchemaPlanPanel.tsx:100-121,164-240,330-580`. |
| Q2 - CMS-field publishing / mapping home | **Adopt default:** same-surface advanced panel/Drawer/GroupBlock; do not move to Settings or sequence out of the release train. | `schema.json:339-343`; Phase 0 Q2 `phase0/surfaces/schema.md:161`; CMS mapping UI/hook `SchemaGeneratorSetup.tsx:230-288`, `useSchemaSuggesterCmsWorkflow.ts:38-120`; endpoints `webflow-schema.ts:155-270`. |
| Q3 - Five publish-safety affordances | **Adopt default:** all carry. Graph gate, manual fallback, retract, history/rollback, and site template are hard-floor parity. | `schema.json:345-349`; Phase 0 Q3 `phase0/surfaces/schema.md:162`; graph gate `BulkPublishPanel.tsx:31-76`; manual/retract/history/template `SchemaPageCard.tsx:369-545`; endpoints `webflow-schema.ts:409-607`. |
| Q4 / N4 - Impact panel vs Insights graduation | **Complement, not replace.** Carry aggregate GSC before/after impact panel; graduation is deferred under AD-004. | `schema.json:351-355,410-412`; Phase 0 Q4/N4 `phase0/surfaces/schema.md:135,163`; `schemaImpact.get` API `src/api/schema.ts:74-103`; AD-004 `PHASE_A_DECISIONS.md:13,28-30`; SB-001 `server-backlog.json:7-23`. |
| Q5 / N1 - Coverage % definition for coverage ring | **Adopt server-computed definition:** published-live / total pages, serialized on the snapshot view via SB-009; no client heuristic. | `schema.json:357-360,393-398`; Phase 0 Q5/N1 `phase0/surfaces/schema.md:132,164`; AD-016 score authority (`owner-decisions.json:219-230`); SB-009 (`server-backlog.json:127-140`); serializer currently lacks aggregate `server/serializers/client-safe.ts:213-226`. |
| Q6 / N2 - "Missing schema - from Site Audit" stat | **Defer the audit-sourced count until SB-011.** Ship the strip with honest absent/disabled copy for that stat. | `schema.json:363-367,400-402`; Phase 0 Q6/N2 `phase0/surfaces/schema.md:133,165`; mismatch evidence `SeoAudit.tsx:547-551`, `server/audit-page.ts:177-181,377-388`; SB-011 (`server-backlog.json:159-170`). |
| Q7 - Competitor schema endpoint | **Adopt default:** leave internal-only; it feeds plan generation and has no UI consumer at HEAD. | `schema.json:369-373`; Phase 0 Q7 `phase0/surfaces/schema.md:166`; endpoint documented `phase0/surfaces/schema.md:121`; schema surface dep row `schema.json:271-274`. |
| Q8 - Orphaned SchemaHealthDashboard + SchemaReviewTab/Modal | **Partial default:** do not resurrect or port orphans. Cleanup is deferred to AD-030/C3-later because this ticket's must-not-touch bucket forbids `src/components/client/**`. | `schema.json:375-379`; Phase 0 Q8 `phase0/surfaces/schema.md:167`; AD-030 lists orphan cleanup (`owner-decisions.json:381-395`); SchemaReviewModal replaced standalone tab (`src/components/client/SchemaReviewModal.tsx:1-5`). |
| Q9 / N5 - Prototype purple vs HEAD teal | **Reject purple surface accent; keep teal action language.** Admin AI actions may use purple only where the design system allows it, but Schema's general surface accent stays teal. | `schema.json:381-385,415-418`; Phase 0 N5/Q9 `phase0/surfaces/schema.md:136,168`; Four Laws `BRAND_DESIGN_LANGUAGE.md:41-47,72-73`. |
| NEW - `missing_schema` / `schema_errors` have no server producer | **Treat as pre-existing wiring bug and route through SB-011.** Do not paper over it in the client. | `schema.json:387-390`; verifier confirmation `schema.json:481-485`; live mismatch `SeoAudit.tsx:547-551`, `server/audit-page.ts:177-181,377-388`; SB-011 (`server-backlog.json:159-170`). |
| N3 - Pub-status tag on collapsed card header | **Adopt.** It is UI-only from snapshot/publish state; do not drop existing/rich/stale/rec badges while adding it. | `schema.json:405-408`; Phase 0 N3 `phase0/surfaces/schema.md:134`; existing badges `SchemaPageCard.tsx:119-138`; publish-state merge `useSchemaSuggesterPublishingWorkflow.ts:52-73`. |

---

## 2. Capability checklist

Every row below is zero-drop: carry the HEAD behavior into the rebuilt surface, even when the prototype omitted it. Treat this as the prompt's AD-011 additive-parity floor plus the Phase 0 no-capability-deletion hard floor (`owner-decisions.json:159-173`, `phase0/surfaces/schema.md:150-156,162`). Target primitives must follow `BUILD_CONVENTIONS.md:134-220`; DataTables are self-carded and Drawers use the shared overlay focus trap.

### 2.1 Shell / routing / URL state
- [ ] **Rows 1-2** nav + `?tab=generator|guide` receiver survive. Evidence: route/nav `src/routes.ts:6`, `navRegistry.tsx:143-147`; receiver reads/writes `SchemaSuggester.tsx:41-47,81-88,236-254`. Primitive: `PageHeader`, `LensSwitcher`/`Segmented`, validated URL-state hook. Zero-drop: keep two-halves contract and runtime/static tests.
- [ ] **Rows 3-5** WorkflowStepper, guide content, CommandPalette action carry. Evidence: stepper `SchemaSuggester.tsx:297-307,412-422`; guide `SchemaSuggester.tsx:277-279`; command action noted `phase0/surfaces/schema.md:23-25`. Primitive: `WorkflowStepper`, `GroupBlock`, existing CommandPalette wiring. Zero-drop: no guide retirement.
- [ ] **Rows 6-8** fixContext receiver, Site Audit quick-fix sender, and schema recommendation banners carry. Evidence: fixContext slug resolution and consume-once `useSchemaSuggesterGeneration.ts:213-248`; Site Audit target `SeoAudit.tsx:547-551`; rec routing `recTypeTab.ts:4-18`; card banners `SchemaPageCardDetails.tsx:133-164`. Primitive: `InlineBanner`, per-page badges, validated receiver. Zero-drop: no URL whose receiver ignores params.

### 2.2 Generation workflow
- [ ] **Rows 9-10** full-site scan remains a cancellable background job with streamed progress and saved snapshot restore. Evidence: job type and cancel/progress `useSchemaSuggesterGeneration.ts:116-164`; snapshot restore `useSchemaSuggesterGeneration.ts:52-74`; server snapshot `webflow-schema.ts:109-115`. Primitive: `ProgressIndicator`, `Skeleton`, Toolbar freshness meta. Zero-drop: no toast-only full scan.
- [ ] **Rows 11-12** pre-scan setup, page inventory, Page Type Guide, Add Page picker, and single-page generate carry. Evidence: setup/picker `SchemaGeneratorSetup.tsx:69-215`; Add Page UI `SchemaSuggester.tsx:488-518`; single route `webflow-schema.ts:272-295`. Primitive: `EmptyState`, `SearchField`, `DataTable`/`GroupBlock`, `Drawer` picker if needed. Zero-drop: setup state is not optional.
- [ ] **Rows 13-14** per-page regenerate clears stale manual edits; page-type hints persist with optimistic revert. Evidence: manual-edit clearing `SchemaSuggester.tsx:217-233`; regenerate `useSchemaSuggesterGeneration.ts:250-272`; page-type PUT/revert `SchemaSuggester.tsx:590-606`; server PUT `webflow-schema.ts:119-132`. Primitive: `IconButton`, `FormSelect`, `InlineBanner`. Zero-drop: stale edited JSON must never override regenerated schema.
- [ ] **Rows 15-18** generation loading/error/empty states and generation context carry. Evidence: states `SchemaSuggester.tsx:352-405`; generation context through `buildSchemaIntelligence` `schema-intelligence.ts:51-102`; foreground entity default `schema-suggester.ts:101-123`. Primitive: `Skeleton`, `ErrorState`, `EmptyState`. Zero-drop: non-identity data stays through intelligence slices; no client entity-resolution logic.

### 2.3 Review and edit
- [ ] **Rows 19-24** page-card badges, existing-schema awareness, validation findings, diagnostics, graph type chips, reason text, and rich-result eligibility carry. Evidence: badges `SchemaPageCard.tsx:119-138`; details `SchemaPageCard.tsx:172-180`; existing schemas/findings/types/diagnostics `SchemaPageCardDetails.tsx:27-180,185-280`. Primitive: `Badge`, `StatusBadge`, `GroupBlock`, `Drawer` detail. Zero-drop: adding pub-status cannot delete existing/rich/stale/rec badges.
- [ ] **Rows 25-28** side-by-side diff, inline JSON editor/effective override, script + raw JSON-LD copy, and JSON preview carry. Evidence: diff/editor/preview/copy UI `SchemaPageCard.tsx:181-278`; effective schema/copy functions `useSchemaSuggesterPublishingWorkflow.ts:75-80,175-189`. Primitive: `Drawer`, code preview block, `Toolbar` actions, `FormTextarea` editor. Zero-drop: the Edit step cannot become decorative.

### 2.4 Validation and publish safety
- [ ] **Rows 29-31** per-page publish confirm, 422 validation gate, persisted validation badges, and whole-site graph gate carry. Evidence: publish gate route `webflow-schema.ts:297-407`; badges/blocking `SchemaPageCard.tsx:280-367`; graph query `useSchemaValidation.ts:23-30`; graph endpoint `webflow-schema.ts:690-705`; bulk graph UI `BulkPublishPanel.tsx:31-76`. Primitive: `ConfirmDialog`/inline confirm, `Badge`, `InlineBanner`. Zero-drop: no one-click publish that hides the gate.
- [ ] **Rows 32-34** bulk Publish All progress/skips, stale >90d warning, and published-state merge semantics carry. Evidence: bulk filtering/progress `useSchemaSuggesterPublishingWorkflow.ts:242-261,338-343`; stale warning `SchemaPageCard.tsx:97-101,515-523`; published merge `useSchemaSuggesterPublishingWorkflow.ts:52-73`. Primitive: sticky `Toolbar`/`InlineBanner`, `Badge`, `ProgressIndicator`. Zero-drop: reload must not resurrect retracted pages.
- [ ] **Rows 35-40** CMS-field publish, CMS retract restriction, manual-delivery fallback, retract, version history/rollback, and site template carry. Evidence: CMS statuses/retract/manual/template/history UI `SchemaPageCard.tsx:295-545`; CMS mapping route `webflow-schema.ts:155-270`; publish service CMS-first order `publish-schema-to-live.ts:20-30,220-255`; retract/history/rollback/template routes `webflow-schema.ts:409-607`; version UI `SchemaVersionHistory.tsx:25-162`. Primitive: `GroupBlock`, `Drawer`, `InlineBanner`, `DataTable`/list. Zero-drop: CMS-heavy sites must not lose publish capability.
- [ ] **Row 41 / 65** publish side effects and MCP parity stay on shared domain services. Evidence: route calls `publishSchemaToLive` `webflow-schema.ts:339-351`; canonical follow-ons `publish-schema-to-live.ts:1-30,157-202,283-302`; MCP tools `schema-actions.ts:52-70`. Primitive: none - backend contract. Zero-drop: UI must not fork publish/validate logic.

### 2.5 Client delivery and approvals
- [ ] **Rows 42-45** bulk/single Send to client with note, effective-schema values, sent badges/errors, and PendingApprovals panel carry. Evidence: bulk send/effective schema `useSchemaSuggesterPublishingWorkflow.ts:82-105`; single send `useSchemaSuggesterPublishingWorkflow.ts:191-217`; note inputs `BulkPublishPanel.tsx:78-100`, `SchemaPageCard.tsx:460-493`; PendingApprovals `SchemaSuggester.tsx:541-549`. Primitive: `FormTextarea`, `Button`, `InlineBanner`, `StatusBadge`. Zero-drop: admin-send convention requires the optional note.
- [ ] **Rows 46 and 55 / Frozen #11** client `schema_item` and `schema_plan` deliverables remain frozen and client-owned. Evidence: deliverable types `client-deliverable.ts:18-23`; migration fields `111-client-deliverable.sql:16-28`; adapters `schema-item.ts:1-12,23-39`, `schema-plan.ts:1-45,96-150`; client renderer `DeliverableDetailModal.tsx:95-159`. Primitive: none - do not edit client. Zero-drop: A-lane admin rebuild does not reshape C-lane deliverables.

### 2.6 Schema Site Plan subsystem
- [ ] **Rows 47-54** plan generation, role editing, lifecycle, send, activate, retract, lock-while-regenerating, canonical entities, and role table carry by bridge-mounting `SchemaPlanPanel`. Evidence: job/lock/generate/save/send/activate `SchemaPlanPanel.tsx:100-121,164-256`; action bar/entities/roles `SchemaPlanPanel.tsx:330-580`; routes `webflow-schema.ts:463-525`; admin mutations `schema-plan-admin-mutations.ts:100-183`. Primitive: T1 `Drawer`/`GroupBlock` wrapper around existing panel. Zero-drop: no invisible-by-omission plan cut.

### 2.7 Setup, measurement, realtime, and known orphans
- [ ] **Rows 57-62** business-profile callout, CMS mapping panel, completeness widget, impact panel, result/edit summary, and how-to footer carry. Evidence: callout `SchemaGeneratorSetup.tsx:20-63`; CMS mapping `SchemaGeneratorSetup.tsx:230-288`; mounted widgets/footer `SchemaSuggester.tsx:551-635`; impact API `src/api/schema.ts:74-103`. Primitive: `InlineBanner`, `GroupBlock`, `MetricTile`, `KeyValueRow`. Zero-drop: proof-of-value and completeness loops remain visible.
- [ ] **Rows 63-68** WS events, background job types, MCP tools, competitor-schema internal endpoint, planned-page queue, and activity log contracts survive unchanged. Evidence: WS constants `ws-events.ts:67-71`; invalidation registry `useWsInvalidation.ts:47-51`; MCP tools `schema-actions.ts:52-70`; public endpoint removal note/queue `webflow-schema.ts:654-657`; phase0 endpoint/activity inventory `phase0/surfaces/schema.md:118-123`. Primitive: none or `useWorkspaceEvents` invalidation. Zero-drop: broadcast receiver must invalidate schema query keys.
- [ ] **Rows 56 and 69** legacy public schema endpoints and orphaned `SchemaHealthDashboard` / `SchemaReviewTab` / `SchemaReviewModal` are not rebuilt into the admin page. Evidence: legacy public routes `webflow-schema.ts:609-652`; SchemaReviewModal replaced standalone tab `SchemaReviewModal.tsx:1-5`; phase0 orphan note `phase0/surfaces/schema.md:101,124`; AD-030 cleanup row `owner-decisions.json:381-395`. Primitive: none. Zero-drop: do not resurrect dead standalone `schema-review`.

---

## 3. Server tickets [ride vs defer]

Consume verifier-adjusted backlog IDs, not the gatherer-only `sn-*` labels (`PHASE_A_DECISIONS.md:34-39`, `schema.json:471-491`). Entity-resolution-adjacent work must stay server-side inside `server/intelligence/entity-resolution*`; the UI may only read generated fields (`docs/rules/schema-entity-resolution.md:14-32`, `schema-intelligence.ts:75-100`).

| SB / sn | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-009** (`sn-schema-1`) | AI Search Ready readiness projection + single-definition schema coverage metric | M overall / schema half S | **[ride] W3 (schema half)** | Coverage ring/summary strip are adopted, but AD-016 forbids client-computed coverage (`owner-decisions.json:219-230`). `server-backlog.json:127-140` says schema coverage is a helper on the admin snapshot serializer; current serializer returns `pageCount` + `results` only (`server/serializers/client-safe.ts:213-226`). If the field is absent in a branch, render honest absence rather than deriving it in JSX. |
| **SB-011** (`sn-schema-2`) | Missing-schema audit finding producer + count projection | M | **[defer -> DEF-schema-001]** | The surface stat is new, not HEAD parity, and the current producer/consumer taxonomy is broken: frontend checks `missing_schema`/`schema_errors` (`SeoAudit.tsx:547-551`) while server emits `structured-data` and `aeo-faq-no-schema` (`audit-page.ts:177-181,377-388`). Defer the count until the producer/projection is fixed. |
| **SB-001** (`sn-schema-3 bridge half`) | Shared insight-graduation write seam | L | **[defer -> DEF-schema-002]** | AD-004 defers all graduation bridges to one C3 owner-signed contract (`PHASE_A_DECISIONS.md:13,28-30`). The schema surface may display impact, but must not add a schema-only insight write path. |
| **SB-021** (`sn-schema-3 detection half`) | Rich-result / AI-citation detection data source | L | **[defer -> DEF-schema-003]** | Verifier adjusted `sn-schema-3`: scoring exists, but detection that flips `rich_result_appearing` does not (`schema.json:487-490`). `server-backlog.json:296-308` makes this a separate schema graduation prerequisite. Keep it server-side; no client scraping or entity/disambiguation bypass. |
| **SB-010** (shared site-audit category scores, schema consumer) | Per-category audit scores + 6-cat taxonomy remap | M | **[defer -> DEF-schema-004]** | `server-backlog.json:142-157` lists schema as a consumer, but `schema.json` local server needs are SB-009/SB-011/SB-001/SB-021. Do not build a Schema-local audit scorer; consume the Site Audit-owned field after it lands. DEF-schema-004 records the downstream consume-only deferral so W3 does not invent a local score authority. |

**Net:** SB-009 rides for the coverage field; SB-011, SB-001, SB-021, and SB-010 defer with explicit DEF rows. SB-010 is downstream consume-only and must not create a Schema-local audit scorer.

---

## 4. Deep-link receiver matrix

Two-halves contract applies (CLAUDE.md UI rule 12; `BUILD_CONVENTIONS.md:186-195,250-257`). Update `tests/contract/tab-deep-link-wiring.test.ts` and add a runtime receiver test for the rebuilt surface.

| Link | Sender | Receiver / target | Disposition |
|---|---|---|---|
| `/ws/:id/seo-schema` | Nav / bookmarks / CommandPalette | Page `seo-schema`, Generator default | **KEEP.** Route id is `seo-schema`, not `schema` (`routes.ts:6`, `navRegistry.tsx:143-147`, `App.tsx:423`). |
| `?tab=guide` | Direct bookmarks / current tab UI | Page `seo-schema`, Workflow Guide lens | **KEEP.** HEAD validates `tab` and falls back to `generator` (`SchemaSuggester.tsx:41-47,81-88,236-254`). Runtime test: `/ws/ws-1/seo-schema?tab=guide`. |
| no `tab` or `?tab=generator` | Default / tab UI | Page `seo-schema`, Generator lens | **KEEP.** HEAD strips `?tab=` when switching back to generator (`SchemaSuggester.tsx:244-254`). Runtime test: default URL and `?tab=bad` both land on Generator. |
| `fixContext.targetRoute='seo-schema'` + `pageSlug` / `pageId` | Page Intelligence today; sender moves to SEO Editor Research mode per `schema.json:456-458` | Schema receiver resolves slug -> pageId and auto-generates once | **KEEP.** Receiver consumes once and waits for async inventory if slug cannot resolve yet (`useSchemaSuggesterGeneration.ts:213-248`). |
| Site Audit quick-fix | `SeoAudit.tsx:551` currently targets `adminPath(..., 'seo-schema')` when schema checks fire | Page `seo-schema` | **KEEP sender target, but data bug defers count.** Existing check ids are mismatched (`SeoAudit.tsx:547-551`; `server/audit-page.ts:177-181,377-388`); do not invent a client fallback. |
| Recommendation type `schema` | `REC_TYPE_ADMIN_TAB.schema` | Page `seo-schema` + per-page rec banners | **KEEP.** Routing map `recTypeTab.ts:4-18`; render banners in page detail (`SchemaPageCardDetails.tsx:133-164`). |
| `brand?tab=business-footprint` outbound | Business-profile/completeness fixes | Brand & AI receiver | **SENDER ONLY.** Current callout links to `brand?tab=business-footprint` (`SchemaGeneratorSetup.tsx:45-49`); receiver ownership stays Brand & AI. |
| Retired client `/client/:id/schema-review` | Legacy bookmarks | `/client/:id/inbox?tab=reviews` | **DO NOT RESURRECT AS PAGE/TAB.** `schema-review` is only a client inbox alias (`routes.ts:24-33`, `App.tsx:91-97`); Inbox reads `?tab=` as filter (`InboxTab.tsx:55-59`, `inbox-filter.ts:3-31`); SchemaReviewModal explicitly replaced the standalone ClientTab (`SchemaReviewModal.tsx:1-5`). |

---

## 5. Flag disposition

| Flag | Kind | Disposition | Evidence |
|---|---|---|---|
| `ui-rebuild-shell` | A-lane UI-shell flag | **Gates this rebuilt surface.** Add one `REBUILT_SURFACES['seo-schema']` mount; flag-OFF falls through to legacy `SchemaSuggester` in `App.tsx:423` byte-identical. | Flag default/catalog `shared/types/feature-flags.ts:117-120,460-472`; mount seam `rebuiltSurfaces.ts:5-19`; rebuilt branch `App.tsx:460-480`; surface mount note `schema.json:453-455`. |

No new feature flag is introduced. No existing flag is retired by this surface. Backend/provider availability, graph validation, Webflow CMS mapping, and schema-plan regeneration locks render as state, not flags.

---

## 6. File ownership

**Owned by this ticket (create/edit):**
- `src/components/schema-rebuilt/**` - new `@ds-rebuilt` surface directory. Expected split: `SchemaSurface.tsx`, generation lens, `SchemaPageTable`/card list, page detail `Drawer`, publish safety panel, plan bridge wrapper, CMS mapping panel wrapper, `useSchemaSurfaceState.ts` (validated `?tab=` + fixContext receiver helpers), and mutation feedback via `useToast` + `mutationErrorMessage`. Every file first line `// @ds-rebuilt`.
- `src/components/layout/rebuiltSurfaces.ts` - one line keyed by Page `'seo-schema'`: `lazyWithRetry(() => import('../schema-rebuilt/SchemaSurface').then(m => ({ default: m.SchemaSurface })))`. Never add a new `App.tsx` branch (`rebuiltSurfaces.ts:5-19`).
- `tests/component/schema-rebuilt/**` - flag-transition test with real `useFeatureFlag` seeded through `QueryClient`, a11y-floor assertion, graph-gate/publish-state tests, and runtime receiver tests for `?tab=guide|generator|bad`.
- `tests/contract/tab-deep-link-wiring.test.ts` - keep static sender/receiver pairs green for `seo-schema`, including Site Audit, recommendation, and legacy client inbox alias expectations.
- `data/ui-rebuild-deferred-ledger.json` - add the DEF rows drafted in §7 in the implementation PR only. This ticket does not edit the ledger.

**Reused, NOT rewritten:**
- Existing generation, validation, publish, template, plan, retract, history, rollback, public legacy, and graph endpoints in `server/routes/webflow-schema.ts:109-115,119-132,155-295,297-407,409-525,527-607,609-652,666-753`.
- Shared publish service `server/domains/schema/publish-schema-to-live.ts:1-30,157-202,211-302`; MCP `generate_schema` / `validate_schema` / `publish_schema` tool definitions `server/mcp/tools/schema-actions.ts:52-70`.
- Entity-resolution and schema-intelligence boundary: `buildSchemaIntelligence` consumes intelligence slices (`schema-intelligence.ts:51-102`), and Wikidata/SPARQL logic remains under `server/intelligence/entity-resolution*` per rule (`schema-entity-resolution.md:14-32`). The rebuilt client never performs entity disambiguation.
- Existing schema plan machinery (`SchemaPlanPanel.tsx:100-580`, `schema-plan-admin-mutations.ts:100-183`) as T1 carry-over-then-reskin; behavior remains unchanged.

**Must NOT touch / other-owner constraints:**
- **Frozen Contract #11:** `schema_item` / `schema_plan` deliverable shapes and storage remain frozen (`CROSS_SURFACE_CONTRACTS.md:61-73`, `client-deliverable.ts:18-23`, `111-client-deliverable.sql:16-28`, `schema-plan-dual-write.ts:102-120`). Do not reshape `externalRef`, `parentDeliverableId`, payloads, statuses, or source refs.
- **Entity-resolution boundary:** no Wikidata/SPARQL direct references outside `server/intelligence/entity-resolution*`; pr-check guard is named in `schema-entity-resolution.md:29-33`.
- `src/components/client/**`, including `SchemaReviewModal`, `SchemaReviewTab`, `DeliverableDetailModal`, `InboxTab`, and `UnifiedInbox`. Client schema review is C-lane / inbox-owned.
- Route id `seo-schema` in `src/routes.ts:6`; this ticket does not rename it to `schema`.
- Site Audit, Brand & AI, Recommendations, Links, and Client Dashboard receiver surfaces beyond the sender/receiver contract assertions listed in §4.

---

## 7. D8 / DEF entries

**D8 redirect map:** none for this surface. Page `seo-schema` is preserved (`src/routes.ts:6`) and the legacy mount remains flag-OFF (`App.tsx:423`). The task wording's `Page "schema"` is a label/key mismatch, not a route-removal event. No `D8_REDIRECT_MAP.md` row is required unless a later PR deliberately renames `seo-schema`.

**Deferred-ledger rows to add in the surface PR** (copy the existing ledger shape; classes use the valid enum only: `token | primitive | behavior | data | a11y | perf | copy`). `docs/rules/ui-rebuild-consistency.md:48-57` requires a row in the same PR that introduces each trade-off; existing ledger shape is shown at `data/ui-rebuild-deferred-ledger.json:5-21`.

```jsonc
{
  "id": "DEF-schema-001",
  "surface": "schema",
  "item": "Missing-schema Site Audit count omitted from the Schema summary strip until the audit check taxonomy and projection are fixed.",
  "decision": "Ship the summary strip with an honest absent state for this one stat; do not derive from mismatched client-only check ids.",
  "class": "data",
  "upgradeTrigger": "SB-011 defines or remaps the schema audit finding producer and serializes a per-workspace missing-schema count.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "backlog": "SB-011",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:363-367,400-402,481-485",
    "server": "server/audit-page.ts:177-181,377-388",
    "frontend": "src/components/SeoAudit.tsx:547-551"
  }
},
{
  "id": "DEF-schema-002",
  "surface": "schema",
  "item": "Automatic schema-win graduation to Insights Engine after schema deploys prove a rich result or AI citation.",
  "decision": "Defer the insight write to the owner-signed C3 graduation seam; this rebuild carries impact display only.",
  "class": "behavior",
  "upgradeTrigger": "SB-001 lands the shared graduation write contract with InsightType registration, broadcast, activity log, and snapshot provenance.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "decision": "AD-004",
    "backlog": "SB-001",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:351-355,410-412",
    "source": "docs/ui-rebuild/phase0/surfaces/schema.md:135,163"
  }
},
{
  "id": "DEF-schema-003",
  "surface": "schema",
  "item": "Rich-result and AI-citation detection source for schema outcome scoring and graduation.",
  "decision": "Do not add client-side detection or scrape logic in the rebuilt surface; wait for the server outcome-measurement provider.",
  "class": "data",
  "upgradeTrigger": "SB-021 adds the detection provider that can set rich_result_appearing true for schema_deployed outcomes.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "backlog": "SB-021",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:487-490",
    "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:296-308"
  }
},
{
  "id": "DEF-schema-004",
  "surface": "schema",
  "item": "Shared Site Audit category score omitted from Schema until SB-010 provides the Site Audit-owned projection.",
  "decision": "Do not invent a Schema-local audit scorer; consume the shared category score only after the Site Audit backlog item lands.",
  "class": "data",
  "upgradeTrigger": "SB-010 ships per-category audit scoring with the six-category taxonomy and exposes the schema category score for consumers.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "backlog": "SB-010",
    "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:142-157",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:464-491"
  }
},
{
  "id": "DEF-schema-005",
  "surface": "schema",
  "item": "Schema Site Plan first-class redesign deferred while SchemaPlanPanel is bridge-mounted as T1 carry-over.",
  "decision": "Mount the existing plan machinery inside the rebuilt surface now; defer a full DS-native plan redesign until after parity is proven.",
  "class": "primitive",
  "upgradeTrigger": "A follow-up design spec replaces the bridge with a DS-native plan sub-view without changing plan lifecycle semantics.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "decision": "AD-010",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:331-337",
    "head": "src/components/schema/SchemaPlanPanel.tsx:100-580"
  }
},
{
  "id": "DEF-schema-006",
  "surface": "schema",
  "item": "Orphaned SchemaHealthDashboard and legacy SchemaReviewTab/Modal cleanup deferred outside the admin rebuild surface.",
  "decision": "Do not port or resurrect the orphaned client/schema-review surfaces in W3; leave cleanup to the AD-030 dead-code pass.",
  "class": "behavior",
  "upgradeTrigger": "AD-030 cleanup pass is scheduled and can safely delete or retire orphaned schema client/review files with route tests.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "decision": "AD-030",
    "surface": "docs/ui-rebuild/phase-a/surfaces/schema.json:221-224,286-289,375-379",
    "source": "docs/ui-rebuild/phase0/surfaces/schema.md:101,124,167"
  }
},
{
  "id": "DEF-schema-007",
  "surface": "schema",
  "item": "Reload-durable Sent publication tag derived from approvals rather than session-only sent state.",
  "decision": "Render session-backed sent feedback now; defer a durable Sent tag until the approvals-derived read is verified and tested.",
  "class": "data",
  "upgradeTrigger": "A schema approvals read joins open/recent schema batches to page rows and survives reload without changing deliverable shapes.",
  "owner": "josh",
  "status": "open",
  "roadmapItemId": null,
  "createdAt": "<PR date>",
  "reviewBy": "<+~6wk>",
  "links": {
    "surfaceUnknown": "docs/ui-rebuild/phase-a/surfaces/schema.json:464-466",
    "workflow": "src/components/schema/useSchemaSuggesterPublishingWorkflow.ts:31-35,82-105,191-217"
  }
}
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add flag-transition component coverage with a seeded `QueryClient`, static + runtime deep-link receiver tests, and a flag-ON browser smoke against a workspace with real schema snapshot, validation records, CMS mapping, and a schema plan.
