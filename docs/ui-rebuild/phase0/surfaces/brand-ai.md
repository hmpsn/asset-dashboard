# Phase 0 Additive-Parity Audit — Brand & AI (zone: Optimization)

**Surface:** admin Page `'brand'` — "Brand & AI" (Copy & Brand Engine: context, brandscript, discovery, voice, identity, page strategy + copy pipeline, business footprint, E-E-A-T, intelligence profile)
**HEAD entry point:** `src/routes.ts:8` (`'brand'` in `Page` union) · `src/lib/navRegistry.tsx:149` (group `optimization`, `needsSite: true`) · `src/App.tsx:415` (mounts `BrandHub`)
**Prototype views:** `hmpsn studio Design System/mockup/brand.js`, `brand-flows.js`, `brand-modal.js`
**Audited at:** branch `ui-rebuild-phase-0` (== post-Reconcile `origin/staging` HEAD), 2026-07-03. Read-only audit; statuses follow the additive-only mandate (uncertain ⇒ `at_risk`, never `preserved`).

Status legend: **preserved** (obvious same-or-better home) · **improved** (prototype upgrades it) · **new_proposed** (prototype-only, needs sign-off) · **at_risk** (exists at HEAD, no visible home in the prototype).

---

## 1. Capability table

### 1.1 Shell, routing, deep links

| # | Capability | Evidence (file:line) | Status | Home in new IA | Notes |
|---|------------|----------------------|--------|----------------|-------|
| 1 | Admin page `'brand'` in nav (Optimization group, needsSite) | `src/routes.ts:8`; `src/lib/navRegistry.tsx:149`; `src/App.tsx:415` | preserved | Brand & AI (Optimization zone per Handoff Brief surface map) | Handoff Brief lists Brand & AI under Optimization. |
| 2 | 9 tabs: overview · context · brandscript · discovery · voice · identity · business-footprint · eeat-assets · intelligence-profile | `src/components/BrandHub.tsx:67-68,503-517` | improved | Prototype collapses 9 tabs → Overview cockpit + 4 groups (Voice & Messaging / Knowledge / Audience / Business Facts & Trust) — `brand.js:1-6,153-162` | Regrouping is fine per mandate **if** every tab's contents land somewhere (see at_risk rows below). |
| 3 | `?tab=` deep-link two-halves contract incl. reactive updates on param change | `src/components/BrandHub.tsx:237-247,331-339` | at_risk | No URL/deep-link model in prototype | Contract test + pr-check enforce this; the rebuild must define `?tab=`/anchor equivalents for the 4 groups. |
| 4 | Legacy tab aliases `business-profile`→`business-footprint`, `locations`→`business-footprint` (+ legacy scroll-to-section) | `src/components/BrandHub.tsx:69-72,239-240`; `src/components/settings/BusinessFootprintTab.tsx:58-69` | at_risk | not shown | Old bookmarks and helper links depend on these (FEATURE_AUDIT §66a). |
| 5 | `&focus=` deep-link targets (`business-profile-section`, `locations-section`) used by **other surfaces**: Schema setup, GBP mapping, Local SEO market drawer, Local Presence page | `src/components/schema/SchemaGeneratorSetup.tsx:46`; `src/components/google-business-profile/GbpMappingStatusBlock.tsx:46`; `src/components/local-seo/LocalSeoMarketSetupDrawer.tsx:150`; `src/components/local-seo/LocalPresencePage.tsx:172`; `useDeepLinkFocus` at `BusinessFootprintTab.tsx:52` | at_risk | not shown | Cross-surface contract — 4 inbound senders break silently if the receiver half is dropped. |

### 1.2 Overview tab

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 6 | 4 snapshot cards (Current Context, Intelligence Profile, Business Profile, Locations) with configured badges, presence notes, local-SEO location counts (confirmed/needs-review), and deep links into tabs | `src/components/brand/BrandOverviewTab.tsx:72-163` | improved | Overview cockpit: overall % + per-group completeness bars, click-to-scroll (`brand.js:303-329`) | Prototype upgrade replaces booleans with % scores — see stop-and-ask Q7 (metric semantics undefined). |

### 1.3 Context tab (brand voice · knowledge base · personas · page strategy mount)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 7 | Brand voice rich-text editor (TipTap `RichTextEditor`) with markdown↔HTML round-trip + legacy "Preview" block stripping; Save | `src/components/BrandHub.tsx:90-231,264-281,445-452,566-610` | at_risk | Prototype shows a snippet row opening the generic modal with a plain `<textarea>` (`brand-modal.js:128-132`) | Rich-text editing (headings/lists/links) is a capability, not a style; a plain textarea would be a downgrade. |
| 8 | Brand voice "Generate from Website" — background job `brand-voice-generation`, disabled without `webflowSiteId`, ProgressIndicator, ErrorState + retry, NextStepsCard on completion, toast with pages-scraped count | `src/components/BrandHub.tsx:454-476,611-636,373-397`; `shared/types/background-jobs.ts:17` | preserved | Generator modal "Generate" lifecycle (`brand-modal.js:114-118,177-178`); rail note "Generate from website … you review before it saves" (`brand.js:408`) | Prototype keeps generate-then-review semantics. |
| 9 | Background-job recovery: job IDs persisted in `sessionStorage` per workspace+type; re-attach on remount/workspace switch; handles done/error/cancelled | `src/components/BrandHub.tsx:74-88,341-370,373-443` | at_risk | not shown | Applies to voice/KB/persona jobs. Behavior contract, invisible in a static mock — must be carried explicitly. |
| 10 | Knowledge base rich-text editor + Save (disabled when unchanged) + "Unsaved changes" indicator + "Generate from Website" (`knowledge-base-generation` job) | `src/components/BrandHub.tsx:643-712,478-491,284-291`; `shared/types/background-jobs.ts:16` | preserved | Knowledge group "Knowledge base" row (`brand.js:184-190`); regenerate via Discovery flow (`brand-flows.js:322-326,458-459`) | Same rich-text caveat as row 7. |
| 11 | Audience personas: collapsed summary chips (name · buyingStage); expanded manager with add/edit/delete (delete confirm), fields name/description/painPoints/goals/objections/preferredContentFormat/buyingStage; Save Personas; "Generate from Website" (`persona-generation` job); count display | `src/components/BrandHub.tsx:714-977,1019-1030`; `shared/types/background-jobs.ts:18` | improved | Audience group: persona cards (avatar, stage pill, description) + "Add persona" + empty state "Generate personas from site" (`brand.js:362-375,90-104`) | Prototype shows only name/stage/description — the 4 structured edit fields (pain points, goals, objections, preferred format) have no visible editor. Treat the editor detail as at_risk until specified. |
| 12 | "How it works" info footer (context sources → all AI outputs) | `src/components/BrandHub.tsx:1004-1014` | improved | Right rail "How this context is used" (4 consumer rows) + per-group "Feeds …" captions (`brand.js:399-409,153-162`) | Prototype strengthens the provenance story. |
| 13 | Brand docs folder ingestion: server API `GET/POST/DELETE /api/brand-docs/:workspaceId` (.txt/.md, max 10); docs injected into AI prompts (`brand-docs/`, `knowledge-docs/` read at 4000-char cap) | `server/routes/brand-docs.ts:26,54,92`; `server/intelligence/seo-context-source.ts:25,51`; UI mention only at `src/components/BrandHub.tsx:637-639,707-710` | at_risk | not shown | At HEAD there is **no admin UI** for this API (FEATURE_AUDIT §123 describes one that no longer exists in `BrandHub.tsx`) — grep finds only the textual hint. Rebuild should decide: give it a home (Discovery dropzone is the natural one) or record as intentionally headless. |

### 1.4 Brandscript tab

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 14 | List brandscripts (name, framework, section count) + empty state + create form (name + framework template from `GET /api/brandscript-templates`) | `src/components/brand/BrandscriptTab.tsx:27-103,472-599,612-616` | at_risk | Prototype models **one** implicit StoryBrand script per client (`brand-flows.js:179-204,331-360`) | Multi-brandscript (list/create/select/custom-blank vs template) has no home. |
| 15 | Import brandscript from raw text (auto section detection), both as new script and into an existing one (mode toggle) | `BrandscriptTab.tsx:113-190,384-436`; `src/api/brand-engine.ts:32-33` | at_risk | not shown | |
| 16 | Delete brandscript (confirm dialog) | `BrandscriptTab.tsx:478-489,585-596` | at_risk | not shown | |
| 17 | Per-section expand/edit/save with dirty tracking, external-update sync (`lastSyncedRef`), sort by `sortOrder` | `BrandscriptTab.tsx:199-297,444-453` | preserved | Flow modal: 7 StoryBrand rows with per-section value/placeholder + Redo/AI-complete (`brand-flows.js:335-346`) | Prototype shows 7 sections; HEAD template is 8 canonical types (FEATURE_AUDIT §307). Count comes from the template — verify template parity. |
| 18 | Optimistic concurrency on section save (`expectedUpdatedAt` → 409 → "updated by another session" toast) | `BrandscriptTab.tsx:229-243,326-340`; `src/api/brand-engine.ts:29-30` | at_risk | not shown | Behavior contract; must survive the flow-modal rebuild. |
| 19 | AI "Complete N empty sections" (server `POST …/:id/complete`) | `BrandscriptTab.tsx:342-353,415-427`; `src/api/brand-engine.ts:34-35` | improved | Per-section "AI-complete"/"Redo" + footer "AI-complete N empty" with sequential shimmer (`brand-flows.js:341-346,355,462-470`) | Prototype adds per-section regenerate (HEAD is all-empty batch only) — additive. |
| 20 | Questionnaire → brandscript auto-population (idempotent, server-side) | FEATURE_AUDIT §288; `server/brandscript.ts` | preserved | server behavior, UI-agnostic | No UI dependency; note so the single-script rebuild doesn't break idempotency assumptions. |

### 1.5 Discovery tab

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 21 | Sources list (filename, type badge, upload date, Processed badge) + empty state | `src/components/brand/DiscoveryTab.tsx:559-636,746-767` | preserved | Flow modal "Uploaded documents" list (`brand-flows.js:299-317`) | Prototype shows PDF/DOCX/XLSX examples; HEAD only accepts .txt/.md (`DiscoveryTab.tsx:434-446`) — richer formats would be new_proposed backend work. |
| 22 | Upload files (multi, drag-drop + browse, .txt/.md validation, per-batch source type) and paste-text source (filename/type/content) | `DiscoveryTab.tsx:419-545,321-417`; `src/api/brand-engine.ts:43-50` | preserved | Dropzone in flow (`brand-flows.js:318-319,456-457`) | Source-type selector (transcript/brand_doc/competitor/existing_copy) not visible in prototype — carry it. |
| 23 | Delete source (confirm; cascades extractions) | `DiscoveryTab.tsx:733-744,813-824` | at_risk | not shown | |
| 24 | Process source → AI extraction (with distinct "already processed" error; auto-navigate to extractions) | `DiscoveryTab.tsx:716-731,602-615`; `src/api/brand-engine.ts:52-53` | at_risk | not shown | The prototype's Discovery flow goes docs → "Regenerate Knowledge Base"; the per-source Process step disappears. |
| 25 | Extraction review panel: status filter tabs (pending/accepted/dismissed/all), pending count, accept/dismiss (dismiss confirm), confidence badge (high/med/low), category, `routedTo` destination label (Voice Profile / Brandscript / Brand Identity), source quote | `DiscoveryTab.tsx:204-318,78-192,40-59` | **at_risk** | **no home in prototype** | The whole human-review loop for extractions (the core of feature §308) is absent from `brand-flows.js`. Hard stop if dropped. |
| 26 | Extraction update API supports `content` edit + `routedTo` re-routing | `src/api/brand-engine.ts:57-58` | at_risk | not shown | UI at HEAD only sends status; API capability should not be regressed server-side. |

### 1.6 Voice tab (voice calibration workspace)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 27 | Voice profile create (explicit empty state → `POST /api/voice/:wsId`, 409-guarded), loading skeleton | `src/components/brand/VoiceTab.tsx:21-62`; `voice-tab/useVoiceTabShell.ts:21-35`; `src/api/brand-engine.ts:64-67` | at_risk | Prototype: single "Voice calibration" row with a status snippet, opening the generic modal (`brand.js:179-180`) | The four-section workspace below has **no designed home**. |
| 28 | Samples: add (content + context tag of 7: headline/body/cta/about/service/social/seo), delete (confirm), tag color badges, empty state | `voice-tab/SamplesSection.tsx:24-196`; `voiceTabModel.ts:4-12,27-35` | **at_risk** | not shown | |
| 29 | Voice DNA editor: personality traits add/remove (normalized dedupe), 3 tone-spectrum sliders (formal↔casual, serious↔playful, technical↔accessible, 1–10), sentence style, vocabulary level, humor style; Save | `voice-tab/DNASection.tsx:15-190`; `voiceTabModel.ts:37-43,60-75` | **at_risk** | not shown | |
| 30 | Guardrails editor: forbiddenWords, requiredTerminology (use/insteadOf pairs), toneBoundaries, antiPatterns — add/remove each, dedupe, Save | `voice-tab/GuardrailsSection.tsx:30-286`; `voiceTabModel.ts:45-50,77-99` | **at_risk** | not shown | Guardrails are also the target of Copy Intelligence promotion (row 45). |
| 31 | Calibration loop: prompt-type select (8 types), generate 3 variations, rate each (on-brand/close/wrong), per-variation feedback save (`POST …/calibration-feedback`), refine with direction (auto-picks best-rated), save variation as voice sample (`source: 'calibration_loop'`, context tag mapped from prompt type) | `voice-tab/useVoiceCalibrationWorkflow.ts:22-133`; `voice-tab/CalibrationSection.tsx` (rate/feedback/refine rows 50-216); `voiceTabModel.ts:14-25`; `src/api/brand-engine.ts:72-78` | **at_risk** | not shown | Prototype invents a "92% on-brand similarity" readout instead (`brand.js:180`) — no such metric exists at HEAD. |
| 32 | Approved copy → voice samples auto-feed (FIFO cap 3 per context tag) | FEATURE_AUDIT §286; `server/copy-review.ts` | preserved | server behavior | Depends on copy approval surviving (row 42). |

### 1.7 Identity tab (17 brand deliverables)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 33 | 17 deliverable types grouped in 3 tiers (Essentials/Professional/Premium) | `src/components/brand/IdentityTab.tsx:13-45,303-334,477-487` | improved | Regrouped: per-group "Brand identity generators" disclosure, each row keeps a tier tag (ess/pro/prem) and set/part/empty dot (`brand.js:264-301`) | Regrouping by feed-target instead of tier is additive as long as all 17 appear (prototype maps all 17: `brand.js:265-271`). |
| 34 | Per-deliverable: Generate (empty) / Regenerate / Refine with direction / manual Edit (textarea, dirty-guarded save) / Approve⇄back-to-draft toggle; Draft/Approved badge; markdown render | `IdentityTab.tsx:56-302` | preserved | Canonical generator modal: Generate → Refine → Edit → Approve lifecycle with same pill states (`brand-modal.js:1-5,114-193`) | Modal adds "Paste existing" entry path for empty items (`brand-modal.js:120-127,184-187`) — additive. |
| 35 | Export All approved deliverables → markdown download (count badge, disabled at 0 approved); server supports `?tier=` filter (unexposed in UI) | `IdentityTab.tsx:368-385,459-475`; `src/api/brand-engine.ts:98-101` | at_risk | Prototype modal has **per-item** Export (`brand-modal.js:144,191`) but no visible Export-All | Per-item export is new_proposed (no single-item export endpoint at HEAD); Export All must not be dropped. |
| 36 | Empty state ("Generate Mission" bootstrap), loading skeletons, error + retry | `IdentityTab.tsx:400-455` | preserved | Modal empty phase (`brand-modal.js:119-127`); generating shimmer (`114-118`) | |
| 37 | Deliverable version history table + steering-note accumulation (server) | FEATURE_AUDIT §310 (`brand_identity_versions`); `server/brand-identity.ts` | at_risk | Modal shows only latest content | No version-history affordance in the modal. HEAD UI exposure is minimal, but the data contract exists; confirm intended exposure. |
| 38 | MCP tools `get_brand_identity` / `update_brand_deliverable` with `expectedVersion` optimistic concurrency; edits reset status to draft | `server/mcp/tools/brand.ts:31-49,108` | preserved | server/MCP — UI-agnostic | Rebuild must keep deliverable IDs/versioning intact. |

### 1.8 Page Strategy (blueprints) — mounted inside Context tab at HEAD

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 39 | Blueprint list (name, version, status, industry) + create empty (name + industry) + AI generate (background job `blueprint-generation` via Task Panel) + delete (confirm) | `src/components/brand/PageStrategyTab.tsx:18-253`; `shared/types/background-jobs.ts:27`; mount at `BrandHub.tsx:979-1002` | **at_risk** | Prototype right rail: "Page Strategy lives with Content Pipeline" (`brand.js:414`) — but `pipeline.js` contains **zero** blueprint/copy content (grep: no matches) | Entire subsystem relocated by pointer with no designed destination. Hard stop until it has a home. |
| 40 | Blueprint detail — Pages tab: add page (name + page type), scope toggle Included⇄Upsell, remove entry (confirm), expand section plan (numbered sections, narrative role [purple, admin-only], word-count target, brand note, SEO note), CMS + primary-keyword badges, Save Version | `src/components/brand/BlueprintDetail.tsx:100-291,361-537,550-684` | **at_risk** | none | Includes entry-level fields (secondaryKeywords, keywordSource, templateId, matrixId, briefId, notes) writable via API (`src/api/brand-engine.ts:127-158`). Entries `reorder` endpoint exists with no UI at HEAD (`brand-engine.ts:157-158`). |
| 41 | Blueprint version history: list versions, expand snapshot (entries, per-entry section counts, change notes) | `src/components/brand/BlueprintVersionHistory.tsx:12-106`; `src/api/brand-engine.ts:161-170` | **at_risk** | none | |

### 1.9 Copy Pipeline (inside blueprint detail → "Copy Pipeline" tab + per-entry actions)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 42 | Per-entry copy generation (async job via `useGenerateCopy`), copy-status badge on entry cards (overall status + approved/total counts), Review Copy inline panel toggle | `BlueprintDetail.tsx:63-124,167-169,264-288`; `src/hooks/admin/useCopyPipeline.ts:88-107`; `src/api/brand-engine.ts:174-186` | **at_risk** | none (see row 39) | |
| 43 | Copy review: per-section cards with status badge, quality flags (error/warning), AI annotation, client suggestions display (status/timestamps/original/suggested/review note), inline text edit (auto-resets to draft server-side), Approve, Send-to-Client-Review (per section + all-drafts bulk), Regenerate with steering note (Cmd+Enter), Regenerate All, approval progress bar, SEO title in header, loading/error/empty states | `src/components/brand/CopyReviewPanel.tsx:74-543`; `src/api/brand-engine.ts:188-215` | **at_risk** | none | Feeds the client copy-review portal (`ClientCopyReview`, public routes — FEATURE_AUDIT §285) and the unified-inbox projected review (§474); both halves must stay wired. |
| 44 | Batch generation: entry multi-select with live copy-status badges, select/deselect all, mode picker (Review Inbox vs Iterative), batch size 1–20, start via `/api/jobs` (`copy-batch-generation`), live progress bar (generated/reviewed/approved, StatusBadge, failed/complete coloring) | `src/components/brand/BatchGenerationPanel.tsx:127-359`; `src/api/brand-engine.ts:217-225`; `shared/types/background-jobs.ts:15` | **at_risk** | none | |
| 45 | Copy export: formats CSV (formula-injection-escaped) / Copy Deck (markdown) / Webflow CMS (visible but disabled — "Requires Webflow connection"); scope all/selected/single; browser download | `src/components/brand/CopyExportPanel.tsx:36-120+`; `src/api/brand-engine.ts:227-233`; FEATURE_AUDIT §283 | **at_risk** | none | Preserve the disabled Webflow option as a visible affordance (deliberate roadmap signal). |
| 46 | Copy intelligence: learned patterns grouped by 4 types (terminology/tone/structure/keyword_usage), toggle active, inline edit, delete; "Ready to Promote" (frequency ≥ 3) section with **deliberately disabled** "Promote to Guardrail" button ("Coming soon — Tier 2"); `extract` endpoint | `src/components/brand/CopyIntelligenceManager.tsx:42-405` (disabled promote: 288-298); `src/api/brand-engine.ts:235-252` | **at_risk** | none | FEATURE_AUDIT §284 describes promotion as built; the shipped UI locks it. Preserve the locked state or get sign-off to implement (Q10). |
| 47 | `SteeringChat` component (refine chat + version list) — **exported but unmounted at HEAD (dead code)** | `src/components/brand/SteeringChat.tsx:17`; grep: no importers | at_risk (dead) | Generator modal's refine bar is the moral equivalent (`brand-modal.js:136-139`) | Not a parity obligation; flag for owner: delete or revive (Q11). |
| 48 | Content decay → copy refresh recommendations (server, per-section rewrite/update/keep) | FEATURE_AUDIT §290; `server/copy-refresh.ts` | preserved | server behavior | Consumer surface is Content Health / Pipeline; noted for cross-surface wiring. |

### 1.10 Business Footprint / E-E-A-T / Intelligence Profile tabs

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 49 | Business Footprint composite: BusinessProfileTab (schema/contact authority) + TargetGeoEditor + LocationsTab (local-SEO match authority) + GbpLocationMappingPanel behind `gbp-auth-connection` flag; explanatory dual-authority copy | `src/components/settings/BusinessFootprintTab.tsx:71-137` | preserved | "Business Facts & Trust" group rows (`brand.js:196-205`) + Locations bespoke flow (`brand-flows.js:394-425`) | Sub-component internals are owned by Business/Local surface audits; the **mount + dual-authority contract + flag gate** belong here. |
| 50 | Locations flow parity: primary + service areas, Confirmed/Needs-review badges, confirm action, add location | `brand-flows.js:394-425,478-482` vs `LocationsTab` (mounted `BusinessFootprintTab.tsx:123-129`) | improved | Locations flow modal | Only-confirmed-geos-rank framing matches HEAD local-SEO contract. |
| 51 | E-E-A-T assets: CRUD of 8 asset types (testimonial, case study, credential, before/after gallery, team bio, award, research, client logo) with structured metadata (attribution name/role, credential issuer, expertise areas, service types, locations, metric label/value); AI "Auto-fill from existing data"; loading/error states | `src/components/settings/EeatAssetsTab.tsx:49-58,85-98,122,202-289`; FEATURE_AUDIT §465 | at_risk | Prototype reframes as 4 pillars (Experience/Expertise/Authoritativeness/Trust) with boolean signals + AI "Add" (`brand-flows.js:206-250,363-391`) | Pillar view is a nice lens, but 8 typed assets + metadata don't map 1:1 to pillar signals. Mapping is undefined (Q5). |
| 52 | Intelligence profile: industry / goals (comma list) / target audience edit + Save (`PUT /api/workspaces/:id/intelligence-profile`) + AI "Auto-fill from site data" (`POST …/autofill`, inline error) | `src/components/settings/IntelligenceProfileTab.tsx:35-74,95-107` | preserved | Knowledge group "Industry & goals" row (`brand.js:189-190,219-220`) | Prototype folds it into Knowledge — fine; keep autofill. |

### 1.11 Cross-cutting (events, jobs, consumers)

| # | Capability | Evidence | Status | Home in new IA | Notes |
|---|------------|----------|--------|----------------|-------|
| 53 | WS events: `brandscript:updated`, `discovery:updated`, `voice:updated`, `brand-identity:updated`, `blueprint:updated`, `blueprint:generated`, `copy:section_updated` → frontend invalidation registry | `server/ws-events.ts:120-133`; `src/hooks/useWsInvalidation.ts:87-90` | at_risk | invisible in prototype | Both-halves contract (CLAUDE.md data-flow rule 1–2) must be re-verified per rebuilt surface. |
| 54 | Background job types owned by this surface: `brand-voice-generation`, `knowledge-base-generation`, `persona-generation`, `blueprint-generation`, `copy-batch-generation` (+ per-entry copy generation job) | `shared/types/background-jobs.ts:15-27` | preserved | Task Panel / NotificationBell platform | |
| 55 | Downstream consumers of this surface's data: prompt assembly Layer-2 voice DNA injection when `status === 'calibrated'`; intelligence slices read brand voice/KB/brand-docs; both Insights chatbots; schema KB enrichment | `server/prompt-assembly.ts` (per CLAUDE.md brand-engine rules); `server/intelligence/seo-context-source.ts:25,51`; FEATURE_AUDIT §2 (schema KB integration) | preserved | server contracts | The rebuild changes the editor, not the store — keep field/status semantics identical. |
| 56 | Brand intelligence slice + MCP `get_brand_identity`/`update_brand_deliverable` | memory: brand-slice P1 merged (PR #1392); `server/mcp/tools/brand.ts:31-49` | preserved | server/MCP | |

**Capability count: 56** (rows above; sub-bullets counted with their parent row).

---

## 2. Prototype coverage notes

**What the prototype demonstrates well**
- The 4-group + Overview-cockpit IA with per-group "feeds …" provenance and a "how this context is used" rail (`brand.js:153-162,399-409`).
- The canonical generator-modal lifecycle (Generate → Refine → Edit → Approve → Export) unifying the 17 deliverables, voice, KB, and personas (`brand-modal.js:1-5`).
- Four bespoke flows (Discovery, Brandscript, E-E-A-T, Locations) as structured modals with completeness strips (`brand-flows.js:1-5`).
- Moved-pointers: AI Visibility → Search & Site Health; Page Strategy → Content Pipeline (`brand.js:412-415`).

**What the prototype omits (drives the at_risk rows)**
- The entire **voice calibration workspace** (samples/DNA/guardrails/3-variation calibration loop) — reduced to one row + an invented "92% similarity" stat.
- The entire **Page Strategy + Copy Pipeline subsystem** — relocated by a one-line pointer; `pipeline.js` has no blueprint/copy content.
- Discovery **process → extraction review** loop (accept/dismiss, confidence, routing, status filters).
- Multi-brandscript management (list/create/import/delete/templates); brandscript optimistic-concurrency behavior.
- Rich-text editing for brand voice / KB (modal uses a plain textarea).
- Export All deliverables; deliverable version history.
- E-E-A-T typed assets + metadata + autofill (replaced by a pillar/signal lens).
- URL deep links (`?tab=`, `&focus=`) and background-job recovery semantics.

**NEW functionality the prototype proposes (needs sign-off)**
1. Overview completeness scoring — overall % + per-group % with Ready/Partial/Needs-setup thresholds (`brand.js:303-317`). No such metric exists at HEAD.
2. Founder interview Q&A inside Discovery, with AI-draft answers from uploaded docs (`brand-flows.js:296-327,441,454-455`). No backing store at HEAD.
3. One-click "Regenerate Knowledge Base" from all discovery sources (`brand-flows.js:322-326,458-459`). HEAD generates KB from a website crawl, not from discovery sources.
4. Brandscript "Approve script" status (`brand-flows.js:358,471`) — no brandscript approval state at HEAD.
5. Per-section brandscript "Redo" regeneration (HEAD: batch complete-empty only).
6. Per-deliverable Export in the generator modal (`brand-modal.js:144,191`) — HEAD exports all approved at once.
7. "Paste existing" manual entry path in the generator modal for any empty item (`brand-modal.js:125,184-187`) — HEAD has manual edit only for deliverables after generation; KB/voice always editable.
8. Voice-calibration "% on-brand similarity" metric (`brand.js:180,236`) — invented.
9. Discovery doc types beyond .txt/.md (PDF/DOCX/XLSX examples, `brand-flows.js:148-169`).
10. E-E-A-T pillar-grouped signal view with AI "Add" per signal (`brand-flows.js:363-391`).

---

## 3. Parity Ledger reconciliation

The Platform Parity Ledger's **Brand & AI** row (`Platform Parity Ledger.html:316-325`) marks the surface **improved** with all 8 tool rows **present** ("Deep parity pass already done"). This audit **disagrees at tool granularity**:

| Ledger row | Ledger status | This audit |
|---|---|---|
| Brand voice + knowledge base → "KB core" | present | Present but rich-text editing + generate-job recovery unmodeled (rows 7, 9, 10). |
| Mission / Vision / Values generators → "generators" | present | Confirmed (rows 33–36); Export All + version history unresolved (rows 35, 37). |
| Brandscript builder → "flow" | present | Flow exists, but multi-script/import/delete/409-concurrency absent (rows 14–18). |
| E-E-A-T assets → "trust assets" | present | Reframed as pillars; 8-type+metadata mapping undefined (row 51). |
| Personas + locations → "audience" | present | Personas grid confirmed; structured persona edit fields unspecified (row 11). Locations confirmed (row 50). |
| Discovery interview → regen KB → "flow" | present | The **interview + regen** are NEW; the ledger row silently substitutes them for HEAD's process→extraction-review, which is missing (rows 24–26). |
| AeoReview / LlmsTxtGenerator → "AI Visibility" | present | Moved out of Brand & AI (prototype: Search & Site Health, `brand.js:414`); belongs to the AI Visibility surface audit (`docs/ui-rebuild/phase0/surfaces/ai-visibility.md`). |

**Ledger gaps (rows the ledger never had):**
- **No row anywhere for Page Strategy blueprints** (list/detail/entries/versions/AI generation) — grep of the ledger finds no `blueprint`/`page strategy` tool row.
- **No row anywhere for the Copy Pipeline** (per-entry generation, review & steering, batch generation, export, copy intelligence, send-to-client-review).
- **No row for the Voice calibration workspace** (samples/DNA/guardrails/calibration loop) — the ledger's "Brand voice + knowledge base" row does not cover `VoiceTab`.
- No row for brand-docs API, intelligence profile autofill, or blueprint entry reorder endpoint (minor).

None of the ledger's Gap/Partial rows belong to this surface (its only row is status `improved`), so **nothing resolves**; instead this audit adds the four missing-row findings above to the gap list.

---

## 4. Trade-offs — quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|---|---|---|---|
| Voice calibration workspace | Keep HEAD `VoiceTab` (4 sections) mounted as a drill-in behind the "Voice calibration" row in Voice & Messaging, restyled with system tokens only | Redesign samples/DNA/guardrails/calibration-loop into the new component system with the generator-modal language | Quick win is visually inconsistent with the 4-group IA but loses zero capability; full version is a multi-week design effort with a high omission risk (4 editors + a rating loop) |
| Page Strategy + Copy Pipeline | Relocate wholesale as its own tab/route under Content Pipeline, unchanged (BlueprintDetail + panels as-is) | Redesign as a pipeline-integrated planning surface (blueprint board + copy lifecycle merged into the pipeline lifecycle board) | Quick win keeps 8 heavy components alive but ports the old look into the new shell; full version risks dropping batch modes / export / intelligence (all invisible in mockups today) |
| Overview cockpit % scores | Client-side boolean-derived completeness (each item set/part/empty from field presence — same logic as `BrandOverviewTab` notes), label as qualitative (Ready/Partial/Needs setup) without inventing % semantics | Server-computed completeness contract (typed slice field, weighted per group, tested) | Quick win's ad-hoc percentages become a trusted number with no defined meaning; the "92% on-brand" similarity stat must be cut or defined — it cannot be derived from anything at HEAD |
| Generator modal scope | Use the canonical modal for the 17 deliverables only (matches HEAD lifecycle 1:1) | Extend to voice/KB/personas with per-item export, rich-text body, structured persona fields | Modal-izing voice/KB/personas silently downgrades RichTextEditor → textarea and drops the persona structured editor |
| Discovery | Keep HEAD process→extraction review as a drill-in step of the new Discovery flow (docs → process → review extractions), defer interview Q&A | Interview Q&A store + AI-draft answers + regen-KB-from-sources as designed | Shipping the prototype flow as-is replaces a working review loop with an unbuilt interview feature — a net capability loss dressed as a redesign |
| Brandscript | Single-script flow modal backed by the existing multi-script API (auto-select the newest script), keep import/delete in an overflow menu | Full multi-script management redesigned | Quick win hides (but doesn't delete) multi-script; if the overflow menu is skipped, create/import/delete are lost |
| E-E-A-T | Keep the 8-type asset CRUD + autofill; add the pillar view as a read-only lens computed from asset types | Pillar-native data model with signal-level AI drafting | Pillar-only quick win with no CRUD would orphan existing `eeat_assets` rows and the §465 autofill |

---

## 5. Open questions (stop-and-ask — owner sign-off required)

1. **Voice calibration workspace home** — The prototype reduces `VoiceTab` (samples, DNA, guardrails, 3-variation calibration loop, calibration feedback) to a single row opening the generic modal. Where does the workspace live in the new IA? Options: (a) drill-in surface behind the row, (b) fold into the generator modal as a multi-pane flow, (c) dedicated sub-route.
2. **Page Strategy + Copy Pipeline destination** — `brand.js:414` says it "lives with Content Pipeline" but `pipeline.js` contains none of it. Where do blueprints (CRUD, entries, versions, AI generation) and the copy pipeline (generation, review/steering, batch, export, intelligence) actually land? Options: (a) new tab in Content Pipeline reusing HEAD components, (b) keep in Brand & AI for now, (c) design a new pipeline-integrated surface (separate ticket).
3. **Discovery extraction review** — Keep the process→accept/dismiss/confidence/routing loop? Options: (a) drill-in step inside the new Discovery flow, (b) auto-accept high-confidence and review the rest, (c) drop (violates additive mandate — not recommendable).
4. **Founder interview Q&A** (new) — Needs a data model + storage + AI-draft endpoint. Build in rebuild scope, or defer and ship the flow without the interview section?
5. **E-E-A-T mapping** — How do the 8 typed assets + structured metadata map onto the prototype's 4 pillars/signals? Is a "signal" an asset, an asset-derived boolean, or a new entity?
6. **Brandscript multiplicity** — Prototype models one StoryBrand script; HEAD supports many (create/from-template/custom/import/delete). Keep multi-script (hidden behind an overflow/list) or officially collapse to one-per-workspace (a data-model decision, not a UI one)?
7. **Completeness metrics semantics** — Define the % scores (what counts, what weights) or replace with qualitative states; and cut or define the "92% on-brand similarity" claim (nothing at HEAD computes it).
8. **Per-deliverable export** (new) — modal Export per item vs HEAD Export-All (+ server `?tier=` filter). Scope: add single-item export endpoint, or keep Export All only?
9. **Brand-docs upload UI** — the `GET/POST/DELETE /api/brand-docs` API is headless at HEAD (FEATURE_AUDIT §123's UI no longer exists in `BrandHub.tsx`). Give it a home in the new Discovery dropzone, or record as intentionally API-only?
10. **Promote-to-Guardrail** — shipped deliberately disabled ("Coming soon — Tier 2", `CopyIntelligenceManager.tsx:288-298`). Preserve the locked affordance, or use the rebuild to implement it?
11. **`SteeringChat` dead code** — exported, never mounted. Delete in a cleanup PR or revive inside the generator modal's refine loop?
12. **Deliverable version history exposure** — `brand_identity_versions` exists server-side; the modal shows only latest. Expose history in the modal, or leave server-only?
13. **Deep-link contract for the new IA** — `?tab=` (9 values + 2 legacy aliases) and `&focus=` targets have 4+ external senders (Schema, GBP, Local SEO ×2). What are the new URL equivalents, and do old URLs redirect?

---

*Audit method: every capability verified by reading HEAD source (file:line cited); prototype claims verified by reading the three mockup JS modules raw; ledger claims verified against `Platform Parity Ledger.html` source rows 316–325; FEATURE_AUDIT.md cross-checked via grep for §§2, 39–40, 62, 65–66a, 68, 123, 280–291, 307–312, 374–375, 465, 474.*
