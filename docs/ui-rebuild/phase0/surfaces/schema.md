# Phase 0 Functionality Ledger — Schema

- **Surface:** Schema · zone: Optimization · nav id (prototype): `schema`
- **HEAD routes covered:** `Page` value `seo-schema` (src/routes.ts:7; navRegistry.tsx:147-148; mounted App.tsx:407 keyed by `webflowSiteId`, with `fixContext` / `businessProfile` / `intelligenceProfile` props). Client half: retired `schema-review` ClientTab alias (src/routes.ts:27-33 → redirects to `/inbox?tab=reviews`); schema plan review now flows through the unified inbox `schema_plan` deliverable (DeliverableDetailModal).
- **Server endpoints:** `server/routes/webflow-schema.ts` (29 endpoints: suggestions, snapshot, page-types, site-inventory, cms-field-mappings, single-page generate, publish, template GET/PUT/PATCH, plan POST/GET/PUT/send-to-client/activate/DELETE, retract, history, rollback, public snapshot/plan/feedback, validate, graph-validation, validation GET/GETall/DELETE), `server/routes/competitor-schema.ts:18`, `server/routes/seo-change-tracker.ts:59` (`/api/schema-impact/:workspaceId`), MCP `server/mcp/tools/schema-actions.ts:52-71` (generate_schema / validate_schema / publish_schema).
- **Prototype views read:** `hmpsn studio Design System/mockup/schema.js` (271 lines — Generator + Workflow Guide sub-tabs).
- **Audited at HEAD:** branch `ui-rebuild-phase-0` (post-Reconcile staging HEAD). Read-only; no git commands run.

## Shape of the surface at HEAD

`SchemaSuggester.tsx` (648 lines) + 16 modules in `src/components/schema/` + 3 workflow hooks. It is far more than a generator: it carries a **site-wide Schema Plan** subsystem (roles + canonical entities + client approval lifecycle), a **CMS-field publishing pipeline**, **whole-site graph validation** that gates bulk publish, **per-page version history/rollback/retract**, a **GSC before/after impact tracker**, and a **completeness widget** that deep-links missing profile fields to their fix locations. The prototype (`schema.js`) mirrors only the generator core (~40% of the surface) and its own header comment says "Mirrors SchemaSuggester.tsx" — it does not mention the plan, CMS, history, or impact subsystems at all.

## Capability table

Status legend: **preserved** (obvious home, same or better) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only) · **at_risk** (exists at HEAD, no visible home in the prototype). Uncertain = at_risk.

### A. Navigation, tabs, entry points

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | Nav entry "Schema" in Optimization group, `needsSite: true` | navRegistry.tsx:147-148; App.tsx:360,407 | preserved | Schema surface, Optimization zone (schema.js:5; Handoff Brief zone map) | |
| 2 | Sub-tabs Generator / Workflow Guide with `?tab=` deep-link two-halves contract (reads `useSearchParams`, writes on change, generator strips param) | SchemaSuggester.tsx:41-47,82-88,236-254 | preserved | schema.js:93,248-251 same two sub-tabs | Deep-link receiver wiring must be re-implemented (contract test exists: tab-deep-link-wiring) |
| 3 | 5-step WorkflowStepper (Scan → Review → Edit → Publish → Validate) with completed/current states | SchemaSuggester.tsx:298-307,412-423 | preserved | schema.js:180-185,208 identical stepper | |
| 4 | Workflow Guide sub-tab (5-step education content) | SchemaSuggester.tsx:277-279; SchemaWorkflowGuide.tsx | preserved | schema.js:227-240 guideBody | |
| 5 | CommandPalette "generate schema" action → navigates to seo-schema | CommandPalette.tsx:197 | preserved | Command palette re-wire | Behavior contract, not visual |
| 6 | Fix-context handoff: Page Intelligence "Add Schema" navigates with `fixContext.targetRoute='seo-schema'` + pageSlug; receiver resolves slug→pageId against inventory/snapshot and auto-generates once (600ms trigger, consume-once ref) | PageIntelligence.tsx:193-196; useSchemaSuggesterGeneration.ts:213-248 | preserved | Parity Ledger: "Schema issues → Schema (deep-link)"; PI merges into SEO Editor Research mode — handoff sender moves there | Receiver contract (slug resolution, consume-once) must carry |
| 7 | Site Audit "Generate structured data in Schema" quick-fix tip link | SeoAudit.tsx:551 | improved | schema.js:214 "Missing schema — from Site Audit" summary stat + ledger deep-link row | Prototype deepens the integration (see Q6) |
| 8 | Schema-type recommendations deep-link here (`recTypeTab.schema → 'seo-schema'`) and render as per-page banners + count badge | src/lib/recTypeTab.ts:17; SchemaSuggester.tsx:89,561; SchemaPageCard.tsx:136-138; SchemaPageCardDetails.tsx (RecommendationBanners) | at_risk | — | No rec affordance anywhere in schema.js |

### B. Generation workflow

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 9 | Full-site scan as cancellable background job (`SCHEMA_GENERATOR`) with streamed partial results, progress messages, done/error/cancelled handling, NextSteps card on completion | useSchemaSuggesterGeneration.ts:116-164; SchemaSuggester.tsx:352-363,436-460 | preserved | schema.js:202,266 "Re-generate all" (toast only) | Job/WS/progress/cancel semantics owed by the state-matrix kit — behavior contract |
| 10 | Saved snapshot persistence: results survive reload, "saved <date>" in subtitle, snapshot-loading interstitial | useSchemaSuggesterGeneration.ts:52-74; SchemaSuggester.tsx:256-260,281-291,640-648; GET /api/webflow/schema-snapshot (webflow-schema.ts:110-115) | preserved | schema.js:247 "Last scan 1d ago" meta | |
| 11 | Pre-scan setup screen: hero CTA + full page inventory with search filter, per-page type select, per-page Generate, and collapsible Page Type Guide (24-role registry with descriptions + examples) | SchemaGeneratorSetup.tsx:69-215; SchemaSuggester.tsx:293-350 | at_risk | — | Prototype starts at the results view; no pre-scan per-page type setup |
| 12 | "Add Page" picker (dropdown, search, excludes already-generated pages, error banner on inventory fetch failure) → single-page generation | PagePicker.tsx; SchemaSuggester.tsx:488-518; useSchemaSuggesterGeneration.ts:166-211; POST /api/webflow/schema-suggestions/:siteId/page (webflow-schema.ts:272-295) | preserved | schema.js:203,267 "Add a page" (toast stub) | Full picker UX must be built; mockup only names the action |
| 13 | Per-page Regenerate (preserves lastPublishedAt, clears stale manual edits, re-expands card) | useSchemaSuggesterGeneration.ts:250-272; SchemaSuggester.tsx:219-233 | preserved | schema.js:164,265 Regenerate | Manual-edit-clearing semantics are a correctness contract (stale edit silently overrides regeneration) |
| 14 | Per-page type hint select persisted server-side, optimistic update with revert-on-failure + "Not saved" inline error | SchemaSuggester.tsx:590-606; SchemaPageCard.tsx:139-155; PUT /api/webflow/schema-page-types (webflow-schema.ts:128-132) | preserved | schema.js:151-153,261 type select (regenerates on change) | Persistence + failure-revert semantics must carry |
| 15 | Single-page generation error banner (dismissible, does not clobber results view) | SchemaSuggester.tsx:380-405,532-539 | preserved | Error state owed by state matrix | |
| 16 | Scan error state with "Scan Again" retry | SchemaSuggester.tsx:366-378 | preserved | Error state owed by state matrix | |
| 17 | Empty result state ("No schema suggestions needed" + Re-scan) | SchemaSuggester.tsx:380-405 | preserved | Empty state owed by state matrix | |
| 18 | Generation context: business profile, intelligence profile, knowledge base, E-E-A-T assets, entity resolution (Wikidata), active plan roles feed the AI prompt | server/schema-generation-context.ts; server/schema-intelligence.ts:51; server/schema-suggester.ts:286,466; FEATURE_AUDIT.md:1159-1205,3125 | preserved | Server-side — unaffected by UI rebuild | Data-layer contract |

### C. Review & edit (page cards)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 19 | Expandable page card: title, slug, edit-state StatusBadge, "N existing" schemas badge, "N types" graph badge, "N rich" eligibility badge, stale "Nd old" badge, validation-error count, rec count | SchemaPageCard.tsx:103-170 | improved (partial) | schema.js:141-168 card w/ validation badge + Live/Sent/Draft pub tag | Prototype adds pub-status tag on collapsed header (good); drops existing/rich/stale/rec badges (rows 20, 24, 33) |
| 20 | "Already on page" existing-schemas section | SchemaPageCardDetails.tsx:27-42 | at_risk | — | Existing-schema awareness also feeds diff (row 25) and coverage math |
| 21 | Validation findings grouped by field, severity-sorted, expandable per-field lists + legacy validationErrors fallback | SchemaPageCardDetails.tsx:49-130 | preserved (detail at_risk) | schema.js:154 validation badge only | Badge carries; the per-field findings drill-down has no mockup home |
| 22 | Generation diagnostics section (per-page generation provenance) | SchemaPageCard.tsx:95,178; SchemaPageCardDetails.tsx (GenerationDiagnosticsSection) | at_risk | — | |
| 23 | @graph type chips + generation reason | SchemaPageCard.tsx:93,177; SchemaPageCardDetails.tsx (GraphTypesSection) | preserved | schema.js:158 type chips | Reason text has no mockup slot |
| 24 | Rich-results eligibility section (per rich-result type, eligible flag) | SchemaPageCard.tsx:94,179; SchemaPageCardDetails.tsx (RichResultsEligibilitySection) | at_risk | — | |
| 25 | Side-by-side diff: current on-page schema vs suggested | SchemaPageCard.tsx:186-199,247-265 | at_risk | — | Requires existingSchemaJson capture (already in snapshot) |
| 26 | Inline JSON editor with live parse validation, per-page edited-JSON override (`getEffectiveSchema`), "(edited)" publish confirm copy, parse errors block publish | SchemaEditor.tsx; useSchemaSuggesterPublishingWorkflow.ts:75-80,142-173; SchemaPageCard.tsx:203-216,266-278,320,336 | at_risk | — | The stepper's "Edit" step exists in the mockup but no editor UI does |
| 27 | Copy script (`<script type="application/ld+json">` wrapper) AND Copy JSON-LD (raw, for Webflow Page Settings), both honoring manual edits, with copied-state feedback | useSchemaSuggesterPublishingWorkflow.ts:175-189; SchemaPageCard.tsx:217-243 | preserved (script variant at_risk) | schema.js:163,264 Copy JSON-LD only | The two-target copy distinction (custom code vs Page Settings field) is user-facing guidance at HEAD (SchemaSuggester.tsx:630-635) |
| 28 | JSON-LD preview (effective schema, pretty-printed, scrollable) | SchemaPageCard.tsx:274-278 | preserved | schema.js:159 sc-code preview | |

### D. Publish & safety

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 29 | Per-page Publish to Webflow with two-step confirm, validation gate (422 on structural or Google-rich-results errors; validation persisted), publish-after-site option, per-page publish error display | SchemaPageCard.tsx:280-368; webflow-schema.ts:298-334; server/domains/schema/publish-schema-to-live.ts | preserved | schema.js:161,262 Publish to Webflow | Confirm step + validation-gate behavior are contracts; mockup is one-click |
| 30 | Per-page validation status badge: valid / warnings / errors ("Fix errors to publish", blocks publish button) / "Not validated yet" | SchemaPageCard.tsx:282-294,336; SchemaSuggester.tsx:145-148,624; useSchemaValidation.ts; webflow-schema.ts:667-753 | preserved | schema.js:128,154 valid/warnings/errors/none badges | Persisted validation records + re-validate endpoints back this |
| 31 | Whole-site @graph validation: status chip (nodes + references checked, warnings, errors), **errors block bulk publish** | useSchemaValidation.ts:24-31; BulkPublishPanel.tsx:31-62; SchemaSuggester.tsx:142-144; webflow-schema.ts:691-705; server/schema/whole-site-graph-validator.ts | at_risk | — | Cross-page @id reference integrity is the core "unified @graph" guarantee; mockup has no site-graph element |
| 32 | Bulk "Publish All (N)" with done/total progress, skips published + non-ready CMS pages, disabled while graph has errors | useSchemaSuggesterPublishingWorkflow.ts:242-261,339-343; BulkPublishPanel.tsx:63-77 | preserved | schema.js:217-219,268 Publish all | Graph-error gate is row 31's at_risk half |
| 33 | Stale-schema detection: published >90d badge + inline "consider regenerating" warning | SchemaPageCard.tsx:97-101,130-132,516-523 | at_risk | — | |
| 34 | Published-state persistence across reload (seeded from `lastPublishedAt`, never resurrects in-session retractions) | useSchemaSuggesterPublishingWorkflow.ts:52-73; webflow-schema.ts:113 (publishDates) | preserved | schema.js Live pub tag implies it | Merge semantics are a correctness contract |
| 35 | CMS-page publishing to mapped CMS field: delivery statuses ready/blocked/failed/written/unchanged, honest "CMS fields not mapped / publish unavailable" notices, distinct "Publish to CMS field" flow, "Published to CMS field" badge | SchemaPageCard.tsx:296-330; useSchemaSuggesterPublishingWorkflow.ts:246-249; server/domains/schema/publish-schema-to-cms-field.ts; FEATURE_AUDIT.md:668 | at_risk | — | Whole CMS delivery pipeline invisible in mockup (with rows 36, 47) |
| 36 | CMS retract restriction: "Clear via Webflow CMS to retract" notice; CMS rollback excluded in history | SchemaPageCard.tsx:411-419; SchemaVersionHistory.tsx:135-142 | at_risk | — | |
| 37 | Manual-delivery fallback: `manual-required` publish result renders paste instructions + character-count vs API limit + Copy JSON-LD | useSchemaSuggesterPublishingWorkflow.ts:124-127; SchemaPageCard.tsx:426-459; SchemaDeliveryDecision type | at_risk | — | Webflow API char-limit reality; silently dropping this bricks large schemas |
| 38 | Retract published schema per page (strips JSON-LD scripts via API, optional site publish, removes from snapshot, resets page state, activity log, Retracted badge) | SchemaPageCard.tsx:398-422; useSchemaSuggesterPublishingWorkflow.ts:263-275; webflow-schema.ts:528-560; FEATURE_AUDIT.md:2630 | at_risk | — | Undo safety net |
| 39 | Per-page publish version history + rollback (re-publishes old version, records as new publish event, "current" marker, restored state, static pages only) | SchemaVersionHistory.tsx; SchemaPageCard.tsx:497-540; webflow-schema.ts:564-607 | at_risk | — | |
| 40 | Save as Site Template (homepage Org+WebSite nodes → site-wide template; auto-save on homepage publish; GET/PUT/PATCH template endpoints) | useSchemaSuggesterPublishingWorkflow.ts:219-240; SchemaPageCard.tsx:369-397; webflow-schema.ts:379-461 | at_risk | — | Template also seeds subpage generation (getOrSeedSiteTemplate) |
| 41 | Publish side-effects: seo_change record, outcome tracking (idempotent), llms.txt regeneration queue, intelligence-cache invalidation, `SCHEMA_SNAPSHOT_UPDATED` broadcast, activity log | publish-schema-to-live.ts:27-30,116; webflow-schema.ts:76-88 | preserved | Server-side — unaffected | Shared with MCP publish_schema tool |

### E. Client delivery & approvals

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 42 | Send ALL schemas to client as "Schema Review" approval batch, with optional note textarea (2000 max), sent-state lockout, error banner | useSchemaSuggesterPublishingWorkflow.ts:82-105; BulkPublishPanel.tsx:78-101; POST /api/approvals/:workspaceId | preserved (note at_risk) | schema.js:219,269 "Send to client" (bulk) | Mockup has no note field — admin-send convention requires one (CLAUDE.md) |
| 43 | Send SINGLE page schema to client with per-page note, sent badge, per-page error | useSchemaSuggesterPublishingWorkflow.ts:191-217; SchemaPageCard.tsx:460-496 | preserved (note at_risk) | schema.js:162,263 per-page Send + Sent tag | |
| 44 | Sent values are the EFFECTIVE schema (manual edits included); currentValue = existing schemas | useSchemaSuggesterPublishingWorkflow.ts:87-95,196-204 | preserved | Behavior contract | |
| 45 | PendingApprovals panel filtered to "Schema" batches with batch retract + refresh key | SchemaSuggester.tsx:541-549; src/components/PendingApprovals.tsx:2,19-27,46 | at_risk | — | Only place the admin sees/retracts open schema batches from this surface |
| 46 | Client receives schema items via inbox approval flow (`schema_item` deliverable adapter; approve/decline propagates to source batch) | server/domains/inbox/deliverable-adapters/schema-item.ts; server/domains/inbox/send-to-client.ts:204-240 | preserved | Client Inbox surface (separate audit) | Cross-surface dependency |

### F. Schema Site Plan (whole subsystem)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 47 | Generate site-wide schema plan as background job (`SCHEMA_PLAN_GENERATION`): page roles + canonical entities from page inventory, keyword strategy, and competitor schema crawl | SchemaPlanPanel.tsx:164-183; server/schema-plan.ts:38,123-128; server/schema-plan-generation-job.ts; FEATURE_AUDIT.md:8345 | at_risk | — | Entire panel absent from schema.js (rows 47-55 = Q1) |
| 48 | Review/edit page roles: 24-role taxonomy with color/tone map, role change auto-manages primaryType + canonical entityRefs, dirty-state + Save | SchemaPlanPanel.tsx:185-224,458-572; shared/types/schema-plan.ts (SCHEMA_ROLE_*) | at_risk | — | |
| 49 | Plan status lifecycle draft → sent_to_client → client_approved / client_changes_requested → active, enforced by state machine | server/state-machines.ts:233,585; server/schema-store.ts:457-469; SchemaPlanPanel.tsx:258-260 | at_risk | — | |
| 50 | Send plan to client: status flip + email + unified-inbox `schema_plan` deliverable dual-write + `SCHEMA_PLAN_SENT` broadcast + activity | SchemaPlanPanel.tsx:226-240; server/domains/schema/schema-plan-admin-mutations.ts:111-130; server/domains/inbox/schema-plan-dual-write.ts | at_risk | — | |
| 51 | Activate plan (generation then follows plan roles; whole-site validator checks against active plan) | SchemaPlanPanel.tsx:242-256; webflow-schema.ts:514-518,698 | at_risk | — | |
| 52 | Retract/delete plan with inline confirm + activity log | SchemaPlanPanel.tsx:408-455; webflow-schema.ts:521-525; schema-plan-admin-mutations.ts:174 | at_risk | — | |
| 53 | Plan mutations locked while regeneration job runs (banner + disabled controls; server 409s carry jobId) | SchemaPlanPanel.tsx:120-121,349-353; webflow-schema.ts:496,638-644 | at_risk | — | |
| 54 | Canonical entities viewer (type/name/@id chips) + Page Type Guide + role-count summary chips | SchemaPlanPanel.tsx:459-530 | at_risk | — | |
| 55 | CLIENT plan review: unified-inbox `schema_plan` deliverable renders read-only page-roles grouped + entity chips; Approve / Request-changes propagates to the real plan via shared `respondToSchemaPlanFeedback` (activity + `SCHEMA_PLAN_SENT` broadcast); guarded against active regeneration | src/components/client/DeliverableDetailModal.tsx:96-160; server/domains/inbox/send-to-client.ts:204-206; server/domains/schema/schema-plan-feedback.ts:73-80; webflow-schema.ts:631-652 | at_risk | Client dashboard rebuild (separate sign-off per Handoff Brief) | Client-facing; schema.js is admin-only |
| 56 | Legacy public endpoints (GET public schema-snapshot / schema-plan, POST feedback) + route-orphaned `SchemaReviewTab`/`SchemaReviewModal` + `schema-review` alias redirect | webflow-schema.ts:612-652; src/routes.ts:27-33; tests/contract/schema-snapshot-invalidation.test.ts:91-95 | preserved (note) | Unified inbox is the live path | SchemaReviewTab/Modal are orphaned components kept for the legacy feedback endpoint; rebuild may retire them (Q8) |

### G. Setup, context & measurement

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 57 | Business-profile completeness callout: LocalBusiness intent inference (address / industry-keyword heuristics), per-workspace localStorage dismiss, deep link to `brand?tab=business-footprint` | SchemaSuggester.tsx:60-79,150-159; SchemaGeneratorSetup.tsx:20-63 | at_risk | — | Drives the highest-value schema type for local businesses |
| 58 | CMS field-mapping panel: auto-detect location/service collections (name heuristics + saved role), map 12 field targets (address/phone/hours/service/price…) per collection (max 4), optimistic save, error surface | SchemaGeneratorSetup.tsx:230-288; useSchemaSuggesterCmsWorkflow.ts:12-121; webflow-schema.ts:155-270 | at_risk | — | Save broadcasts `SCHEMA_CMS_MAPPING_UPDATED` + activity `schema_mapping_updated` |
| 59 | Schema completeness widget: % of pages without actionable missing-field findings, progress bar, missing-field groups (severity-sorted, page counts) each deep-linking "Fix →" to workspace-settings/brand `?tab=&focus=` targets | SchemaCompletenessWidget.tsx:27-139; fieldTargets.ts | at_risk | — | Cross-surface fix routing (business-footprint / intelligence-profile / eeat-assets) |
| 60 | Schema Impact panel: GSC 28-day before/after per deployment, avg clicks/impressions/CTR/position deltas, too-recent (<7d) pending, per-deployment rows; hidden when GSC absent | SchemaImpactPanel.tsx; src/api/schema.ts:101-103; server/routes/seo-change-tracker.ts:59; FEATURE_AUDIT.md:3805 | at_risk | Prototype hints "graduates into the Insights Engine" (schema.js:224) — related but NOT equivalent | Q4: aggregate impact stats vs single-win graduation |
| 61 | Results summary + edit-status summary (total types generated, per-status counts from usePageEditStates) | SchemaResultsSummary.tsx (summarizeSchemaResults, SchemaEditStatusSummary); SchemaSuggester.tsx:554-556,640-648 | improved | schema.js:210-215 4-stat summary strip | Prototype strip is richer (coverage %, published, missing) but drops edit-status breakdown |
| 62 | "How to use" footer explaining publish targets + never-touch-existing-code guarantee | SchemaSuggester.tsx:630-635 | preserved | schema.js:224 sc-grad footer (same guarantee text) | |

### H. Realtime, jobs, integrations (contracts)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 63 | WS events: `schema:snapshot_updated`, `schema:plan_updated`, `schema:plan_sent`, `schema:cms_mapping_updated` — admin invalidation registry + client dashboard handlers | server/ws-events.ts:68-71; src/hooks/useWsInvalidation.ts:47-51; src/components/ClientDashboard.tsx:429-433 | preserved | Rebuild must re-wire `useWorkspaceEvents` handlers per data-flow rule #2 | |
| 64 | Background job types `SCHEMA_GENERATOR` + `SCHEMA_PLAN_GENERATION` on the jobs platform (NotificationBell, cancel, findActiveJob attach) | shared/types/background-jobs.ts; useSchemaSuggesterGeneration.ts:47,153; SchemaPlanPanel.tsx:113-127 | preserved | Background-job platform unchanged | |
| 65 | MCP tools generate_schema / validate_schema / publish_schema share the same domain services (validate-first publish) | server/mcp/tools/schema-actions.ts:52-71; publish-schema-to-live.ts:1-30 | preserved | Server-side — unaffected | UI must not fork publish logic away from `publishSchemaToLive` |
| 66 | Competitor schema intelligence: crawl competitor domains, compare type coverage (`GET /api/competitor-schema/:workspaceId`); also feeds plan generation internally | server/routes/competitor-schema.ts:18-81; server/schema-plan.ts:123-128; FEATURE_AUDIT.md:4306 | at_risk | — | Endpoint has NO frontend consumer at HEAD (grep: zero src hits) — dark for UI but tested + used by plan gen (Q7) |
| 67 | Planned-page schema pre-generation queue (`pending_schemas` via `queueSchemaPreGeneration`; read by content-pipeline intelligence slice) | server/schema-queue.ts:68,167,232; webflow-schema.ts:654-657 | preserved | Server-side (Content Pipeline surface adjacency) | No UI at HEAD by design (W6.3 removed the endpoint) |
| 68 | Activity log types: schema_published, schema_plan_generated/sent/deleted, schema_mapping_updated, changes_requested (client feedback) | server/activity-log.ts:46-47,83; webflow-schema.ts:259-267,549,595; schema-plan-feedback.ts:73 | preserved | Server-side | |
| 69 | Orphaned `SchemaHealthDashboard` component (aggregated validation rows + re-validate) — defined + component-tested but mounted nowhere in the app | src/components/schema/SchemaHealthDashboard.tsx:139; grep: only tests/component/SchemaHealthDashboard.test.tsx imports it | at_risk (note) | — | Its data (validation records) IS surfaced via row-30 badges; likely dead code — confirm delete vs port (Q8) |

## Prototype coverage notes

**Demonstrated by `schema.js`** (all map to HEAD rows above): Generator/Guide sub-tabs, 5-step stepper, per-client page cards with expand, page-type select (regenerate-on-change), validation badge (valid/warnings/errors/none), Live/Sent/Draft pub tag, @graph type chips, JSON-LD preview, per-page Publish/Send/Copy JSON-LD/Regenerate, bulk bar (Publish all / Send to client), Re-generate all, Add a page (stub), 4-stat summary strip, "how to use" footer, workflow guide.

**NEW functionality proposed by the prototype (needs sign-off):**

1. **Coverage ring hero** — % of pages with schema, color-banded, with narrative headline ("N pages are invisible to rich results & AI") (schema.js:187-206). HEAD has no coverage % anywhere. Needs a metric definition (Q5).
2. **Summary strip stats**: pages-with-schema/total, distinct schema-type count, published count, **"Missing schema — from Site Audit"** (schema.js:210-215). The Site Audit-sourced count is a new data dependency (Q6).
3. **Pub-status tag on the collapsed card header** (Live/Sent/Draft) (schema.js:145). HEAD shows sent/published state only inside the expanded card — genuine improvement.
4. **Insights Engine graduation** — "a schema fix that wins a rich result or an AI citation graduates into the Insights Engine as a client win" (schema.js:224). New cross-system flow; HEAD's outcome-tracking on publish (row 41) is the natural producer but no graduation pipeline exists.
5. **Purple as the surface accent** (schema.js:10-11,34). Admin-only surface so purple is legal per the Four Laws, but HEAD's Schema is teal-accented; the rebuild kit's law says purple = admin-AI. Generation IS AI — acceptable, but flag for the design-system owner.

**Omitted by the prototype** (the at_risk inventory): everything in sections F (Schema Site Plan, 9 rows), the CMS pipeline (rows 35-36, 58), publish safety (rows 31, 33, 37-40), setup/context (rows 57, 59), measurement (row 60), review depth (rows 20-22, 24-26), approvals visibility (row 45), and recommendations wiring (row 8).

## Parity Ledger reconciliation

- **Schema row** (`home:'schema.js', to:'Schema', status:'improved'`): ledger funcs are "Generate structured data (Product, FAQ, LocalBusiness…)", "Per-page schema review + apply", "Schema error detection" — all three verified present at HEAD and demonstrated by the prototype. **No Gap/Partial rows exist for Schema in the ledger.** However, the ledger's three funcs describe only the generator core; the ledger row does NOT enumerate the plan/CMS/history/impact subsystems, so its "improved" verdict must not be read as covering them — this Phase 0 ledger is the authoritative capability inventory.
- **"Schema issues → present → at: Schema (deep-link)"** (Site Audit row): resolves. HEAD already has the sender (SeoAudit.tsx:551 tip; fixContext plumbing exists from Page Intelligence, and Site Audit's per-issue Fix routing includes seo-schema per the Site Audit surface ledger row 26). The prototype deepens it with the "Missing schema" stat (Q6).
- **Site Architecture row** ("Schema coverage per page" → moves to Links): belongs to the Links surface audit; noted here only because the coverage-% concept overlaps Q5.

## Trade-offs: quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Generator core | Ship the mockup's card list (publish/send/copy/regenerate + validation badge + pub tag) backed by existing endpoints | Add diff view, JSON editor, per-field findings drill-down, diagnostics, rich-results sections (rows 20-26) | Operators can publish AI schema they cannot inspect or correct — the Edit step of the stepper becomes a lie; edited-schema contract (`getEffectiveSchema`) silently drops |
| Coverage ring + summary strip | Compute client-side from the existing snapshot (existingSchemas + suggestedSchemas + publishDates) | Server-side coverage metric shared with Site Audit + Links (single definition), incl. the "missing from Site Audit" count | Two surfaces showing different "coverage" numbers violates the never-change-a-number rule; define once (Q5/Q6) |
| Publish safety rail | Keep the validation-gate + confirm step (server already enforces 422s) with mockup's one-click UI catching the 422 as an error toast | Carry confirm step, graph-validation chip + bulk gate, manual-delivery fallback, retract, history/rollback (rows 29-39) | A 422-toast-only flow strands manual-required pages (no paste instructions) and leaves no undo; retract/rollback loss is a hard regression for a publish-to-production tool |
| Schema Site Plan | Re-mount the existing `SchemaPlanPanel` unchanged inside the new shell (it is self-contained: own queries, own job wiring) | Redesign plan review as a first-class sub-view in the new design system | Visual inconsistency (old primitives inside new shell); acceptable as a bridge — invisible-by-omission is NOT acceptable (Q1) |
| CMS pipeline | Show CMS pages read-only ("publish unavailable") while shipping static-page publish first | Full mapping panel + cms-field publish + delivery statuses (rows 35-36, 58) | Sites whose money pages are CMS items (locations/services) lose ALL publish capability they have today — only safe if sequenced within one release train |
| Impact & completeness | Defer both panels; keep server endpoints warm | Rebuilt impact module (or Insights Engine graduation, if that is the signed-off replacement) + completeness deep-link widget | Impact is the only proof-of-value loop this surface has; losing it undercuts the agency's "schema worked" story (Q4) |
| Client plan review | Keep the unified-inbox `schema_plan` deliverable renderer exactly as-is (post-Reconcile, already live) | Client-dashboard rebuild decides its final form | None — do not touch; it is the newest part of the stack |

## Open questions (stop-and-ask — owner sign-off required)

- **Q1 — Schema Site Plan has no home in the prototype.** The entire plan subsystem (rows 47-55: generation, role editing, lifecycle, activate, client approval propagation) is absent from `schema.js`. Options: (a) re-mount `SchemaPlanPanel` in the rebuilt surface as a bridge, (b) design a plan sub-view into the new Schema surface, (c) intentionally retire (would be a functionality loss — hard stop without sign-off). The active plan also FEEDS generation and graph validation, so it cannot be silently dropped.
- **Q2 — CMS-field publishing pipeline home** (rows 35-36, 58): mapping panel + delivery statuses + cms-publish path are invisible in the mockup. Same-surface advanced panel, settings-level config, or sequenced later?
- **Q3 — Publish-safety affordances** (rows 31, 33, 37-40): graph-validation gate, manual-delivery fallback, retract, version history/rollback, site template. Confirm all five carry into the rebuilt page card / bulk bar; the mockup's one-click publish covers none of them.
- **Q4 — Impact measurement home** (row 60): does the prototype's "graduates into the Insights Engine" REPLACE the GSC before/after impact panel, or complement it? Graduation (single wins) and aggregate deltas are different capabilities; replacing one with the other loses the aggregate view.
- **Q5 — Coverage % definition** (new metric): pages with existing schema? generated? published? The mockup ring flips `val==='none'` → covered on regenerate, i.e. "generated" — but the summary card says "live in Webflow" for published. Client-facing numbers must have one signed-off definition.
- **Q6 — "Missing schema — from Site Audit" stat** (new data dependency): requires piping audit schema findings into this surface (or a shared coverage service). Confirm scope + owner; it is a data ticket, not a UI one.
- **Q7 — Competitor schema endpoint** (row 66): `GET /api/competitor-schema/:workspaceId` has zero UI consumers at HEAD (internally feeds plan generation). Surface it in the rebuild (Schema? Competitors?), or leave internal-only?
- **Q8 — Dead/orphaned components**: `SchemaHealthDashboard` (never mounted), `SchemaReviewTab`/`SchemaReviewModal` (route-orphaned since the unified inbox took over; legacy public feedback endpoint still shared via `respondToSchemaPlanFeedback`). OK to retire in the rebuild rather than port? (Deleting code is out of Phase 0 scope — this is a rebuild-plan decision.)
- **Q9 — Purple accent**: prototype styles Schema in purple (admin-AI law satisfied since generation is AI), but HEAD uses teal. Confirm the hue assignment with the design-system owner so the Four Laws mapping stays deliberate.
