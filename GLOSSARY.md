# GLOSSARY

Developer reference for domain-specific terms used in the hmpsn.studio codebase.

---

**Activity Log** — A chronological audit trail of significant platform operations, recorded via `addActivity()` in `server/activity-log.ts`. Covers audits, metadata changes, approvals, brief generation, schema publishing, and more. Distinct from the application error log (Pino/Sentry). Accessible in both admin and client portals. WS event: `WS_EVENTS.ACTIVITY_NEW`.

**Admin Events** — WebSocket events broadcast to all connected admin sessions (site-wide fanout), defined in `ADMIN_EVENTS` in `server/ws-events.ts`. Distinct from workspace-scoped events. Examples: `workspace:created`, `queue:update`. Frontend handlers must use `useGlobalAdminEvents`, not `useWorkspaceEvents`.

**Annotation** — A date-label marker placed on an analytics chart to correlate traffic changes with known events (e.g., "Launched new homepage"). Stored in `analytics_annotations` / `annotations` tables. Surfaced in the `OperationalSlice` of workspace intelligence and injected into AI prompt context.

**Approval Batch** — A named collection of `ApprovalItem` records sent to a client for review before changes are published to Webflow. Defined in `shared/types/approvals.ts`. Batch status progresses through `pending → partial → approved/rejected → applied`. Created by the SEO Editor, Schema Generator, and CMS Editor. WS event: `WS_EVENTS.APPROVAL_UPDATE`.

**Approval Item** — A single proposed change within an `ApprovalBatch` (e.g., a proposed SEO title or schema). Fields include `currentValue`, `proposedValue`, `clientValue` (client edit), and `status` (`pending | approved | rejected | applied`). See `shared/types/approvals.ts`.

**Audit Snapshot** — A persisted record of a site SEO audit run, saved to disk and the `audit_snapshots` table. Snapshots enable historical score comparison and feed bridge callbacks (e.g., `bridge-audit-page-health`, `bridge-audit-site-health`). "Auto-restore" on mount loads the latest snapshot without re-running the audit.

**Blueprint** — A page strategy entry in the Copy & Brand Engine (Phase 2). Maps a page to its copy structure, sections, and content goals. Stored in the `blueprints` table. WS event: `WS_EVENTS.BLUEPRINT_UPDATED`.

**Brand Identity** — AI-generated brand deliverables (manifesto, elevator pitch, positioning statement, etc.) produced from brandscript sections and voice profile data. Managed by the Copy & Brand Engine Phase 1. WS event: `WS_EVENTS.BRAND_IDENTITY_UPDATED`.

**Brandscript** — A structured brand narrative modeled on the StoryBrand framework. Sections (hero, problem, guide, plan, CTA, etc.) are stored in the `brandscript_sections` table. Feeds voice calibration and brand identity generation. WS event: `WS_EVENTS.BRANDSCRIPT_UPDATED`. See `server/brandscript.ts`.

**Bridge** — A server-side callback registered via `executeBridge()` in `server/bridge-infrastructure.ts` that reacts to an insight or platform event and cross-links state across modules. Each bridge is gated by a feature flag (e.g., `bridge-audit-page-health`). Bridges never throw — errors are logged and swallowed to protect the triggering mutation. A bridge callback must return `{ modified: N }` and never manually broadcast; the infrastructure handles the `INSIGHT_BRIDGE_UPDATED` broadcast automatically when `modified > 0`. Full authoring rules: `docs/rules/bridge-authoring.md`.

**Broadcast** — A workspace-scoped WebSocket push sent via `broadcastToWorkspace(workspaceId, event, payload)` in `server/broadcast.ts`. Every mutation that changes workspace-visible data must call this. The frontend handles broadcasts via `useWorkspaceEvents(workspaceId, ...)`, which invalidates the relevant React Query caches. All event name constants live in `WS_EVENTS` in `server/ws-events.ts`.

**`buildSystemPrompt()`** — The Layer 2 prompt assembly function in `server/prompt-assembly.ts`. When a workspace's voice profile is `calibrated`, it injects voice DNA and guardrails into the system message of every AI call. Callers must not manually inline the same DNA — that causes redundant injection. See also: **Voice Profile**.

**Client Intelligence** — A scrubbed, tier-gated view of `WorkspaceIntelligence` for client portal consumption. Defined in `shared/types/intelligence.ts` as `ClientIntelligence`. Never exposes: knowledge base, raw brand voice, churn risk, impact scores, the operational slice, or admin-only insight types (e.g., `strategy_alignment`).

**Client Session** — The authentication mechanism for the client portal: an HMAC cookie named `client_session_<wsId>`. Distinct from JWT-based user accounts. Managed by `requireClientPortalAuth()` middleware and the public portal auth flow.

**ClientSignalsSlice** — The workspace intelligence slice that captures client engagement and feedback signals: keyword feedback votes, content gap votes, business priorities, approval patterns, chat topics, churn risk, intent signals, and ROI estimates. Assembled by `server/workspace-intelligence.ts`. The relevant slice for wiring new client-facing engagement data into the AI context.

**Content Matrix** — A planning grid that generates content cells from configurable dimensions (e.g., service × location). Each cell has a `targetKeyword`, a `plannedUrl`, and a `MatrixCellStatus` that progresses through seven states: `planned → keyword_validated → brief_generated → draft → review → approved → published`. Defined in `shared/types/content.ts`.

**Copy Pipeline** — The Phase 3 component of the Copy & Brand Engine. Handles AI copy generation for blueprint sections, client review workflows, approval tracking, and export. Generates copy per section using voice profile + brandscript context. WS events: `WS_EVENTS.COPY_SECTION_UPDATED`, `COPY_BATCH_COMPLETE`, etc.

**Deep Diagnostics** — An on-demand AI investigation triggered for a specific anomaly or insight. Runs a structured root-cause analysis and stores results as a `diagnostic_reports` record. Gated by the `deep-diagnostics` feature flag. WS events: `WS_EVENTS.DIAGNOSTIC_COMPLETE`, `DIAGNOSTIC_FAILED`.

**Discovery** — Source ingestion for the Copy & Brand Engine (Phase 1). Ingests transcripts, brand documents, and competitor analysis to build the brandscript and feed voice calibration. Processed by `server/discovery-ingestion.ts`. WS event: `WS_EVENTS.DISCOVERY_UPDATED`.

**Feature Flag** — A compile-time-keyed toggle defined in `shared/types/feature-flags.ts` as `FEATURE_FLAGS`. Controls which features are dark-launched or enabled per environment. Checked at runtime via `isFeatureEnabled(flag)` (server) or `hasFeatureFlag(ws, flag)` (workspace-scoped). The type `FeatureFlagKey` is the union of all valid flag names. Default value is `false` (dark-launched). Override via env vars: `FEATURE_<FLAG_NAME_UPPERCASED>=true` (server) / `VITE_FEATURE_<FLAG_NAME_UPPERCASED>=true` (Vite build).

**Impact Score** — A numeric ranking field on `AnalyticsInsight` used to sort the priority feed. Higher scores surface an insight earlier. Computed at insight-store time from severity, traffic volume, and other signals. Stored as `impact_score` in `analytics_insights`.

**Insight** — An AI-generated finding stored in the `analytics_insights` table. Each insight has a typed `InsightType` discriminator (see `shared/types/analytics.ts`), a typed `data` payload keyed by `InsightDataMap`, and optional enrichment fields (page title, strategy alignment, pipeline status, audit issues). Generated by `server/analytics-intelligence.ts`. Resolution states: `in_progress | resolved | null`. The `bridgeSource` field, when non-null, marks an insight as bridge-authored and grants it immunity from stale cleanup.

**InsightDataMap** — A discriminated-union map in `shared/types/analytics.ts` that provides type-safe access to an insight's `data` payload by `InsightType`. Every new insight type must add both a typed `XData` interface and an `InsightDataMap` entry — never `Record<string, unknown>`.

**InsightType** — The string literal union in `shared/types/analytics.ts` enumerating all valid insight categories: `page_health`, `ranking_opportunity`, `content_decay`, `cannibalization`, `keyword_cluster`, `competitor_gap`, `conversion_attribution`, `ranking_mover`, `ctr_opportunity`, `serp_opportunity`, `strategy_alignment`, `anomaly_digest`, `audit_finding`, `site_health`. New values require registration in all four mandatory locations — see `docs/rules/analytics-insights.md`.

**Intelligence** — The assembled `WorkspaceIntelligence` object produced by `server/workspace-intelligence.ts` at query time. Contains typed slices (`seoContext`, `insights`, `learnings`, `pageProfile`, `contentPipeline`, `siteHealth`, `clientSignals`, `operational`). Fed into AI prompts, AdminChat, and the recommendations engine. Callers can request specific slices via `IntelligenceOptions.slices`.

**Intent Signal** — A signal detected in client chat indicating a service or content interest (types: `service_interest | content_interest`). Stored in the `client_signals` table and surfaced in `ClientSignalsSlice.intentSignals`. Wired by bridge `bridge-client-signal`.

**`parseJsonSafe` / `parseJsonSafeArray`** — DB-boundary validation utilities in `server/db/json-validation.ts`. `parseJsonSafe` validates a JSON column against a Zod schema and returns a fallback on parse failure (never throws). `parseJsonSafeArray` validates items individually and filters out bad items rather than dropping the whole array. Required pattern for all JSON column reads — bare `JSON.parse` on DB columns is forbidden by pr-check.

**Page Intelligence** — Per-page SEO analysis persisted in the `page_analyses` table. Includes primary keyword, optimization score, content gaps, audit issues, rank history, schema status, and link health. Assembled into `PageProfileSlice` when a `pagePath` is provided to `assembleWorkspaceIntelligence`. Feeds the Schema Generator, Content Briefs, and the SEO rewriter.

**Probe** — A read-only diagnostic endpoint used for health checks and integration testing. Referenced in pr-check escape-hatch rules; a route annotated as a probe is exempt from the `addActivity()` requirement.

**`requireWorkspaceAccess`** — Express middleware that verifies a caller has access to the workspace identified in the URL's `:id` parameter. Safe for all routes — explicitly passes through when no JWT user is present (admin HMAC users are covered by the global `APP_PASSWORD` gate). Does NOT verify that nested path parameters (e.g., `:userId`) belong to that workspace; use `assertUserInWorkspace()` for cross-object ownership checks.

**`rowToX()` mapper** — The convention for transforming a raw SQLite row object into a typed domain object. Every table has a corresponding mapper (e.g., `rowToWorkspace`, `rowToInsight`, `rowToBatch`). Adding columns to a table requires updating the mapper in the same commit. TypeScript does not catch a mapper that silently ignores a new column.

**Slice** — A named component of the `WorkspaceIntelligence` assembly. Each slice is an interface in `shared/types/intelligence.ts` and is assembled by a corresponding `assemble*` function in `server/workspace-intelligence.ts`. Slice names: `seoContext`, `insights`, `learnings`, `pageProfile`, `contentPipeline`, `siteHealth`, `clientSignals`, `operational`. New data sources must be wired into the appropriate slice to be visible to AI prompts and AdminChat.

**`stmts()` / `createStmtCache()`** — The lazy prepared-statement pattern from `server/db/stmt-cache.ts`. Statements are compiled once on first use and reused thereafter. All new DB code must use this pattern — local `let stmt` caching and bare `db.prepare()` at module scope are both forbidden by pr-check.

**Suggested Brief** — An AI-inferred content brief recommendation derived from ranking opportunities or content decay insights. Stored in the `suggested_briefs` table. Defined in `shared/types/intelligence.ts` as `SuggestedBrief`. Surfaced in the Content Pipeline and generated by the insight feedback loop (`server/insight-feedback.ts`). WS event: `WS_EVENTS.SUGGESTED_BRIEF_UPDATED`.

**TierGate** — A UI primitive (`src/components/ui/TierGate.tsx`) that soft-gates features behind subscription tiers. Shows an upgrade prompt rather than hard-blocking. Features must be wrapped at the narrowest possible scope — never wrap a composite parent component. Tiers: `free`, `growth`, `premium`.

**Usage Tracking** — Per-workspace, per-calendar-month quota enforcement for specific features. Tracked in `server/usage-tracking.ts`. Current tracked features: `ai_chats` (3 / 50 / unlimited by tier) and `strategy_generations` (0 / 3 / unlimited). Content briefs and posts are paid add-ons, not tracked here.

**Voice Profile** — A workspace-specific AI voice configuration managed by the Copy & Brand Engine. States: `draft → calibrating → calibrated`. When `calibrated`, `buildSystemPrompt()` automatically injects the voice DNA, writing samples, and guardrails into the system message of every AI call. The pre-formatted prompt block for voice context is `SeoContextSlice.effectiveBrandVoiceBlock` — inject this directly; never use the raw `brandVoice` field or a format helper. WS event: `WS_EVENTS.VOICE_PROFILE_UPDATED`.

**Workspace** — The primary multi-tenant unit of the platform. One workspace corresponds to one client site. Every resource (insights, audits, briefs, approvals, activity, users) is scoped to a `workspaceId`. Workspace-level settings include tier, integrations (Webflow, GSC, GA4, SEMRush), and feature flags. The workspace record lives in the `workspaces` table.

**`useWorkspaceEvents`** — The frontend React hook for receiving workspace-scoped WebSocket broadcasts. Must be used (not `useGlobalAdminEvents`) for all events emitted via `broadcastToWorkspace()`. The hook sends a `subscribe` action to the server so the workspace filter routes the message to the correct connection. `useGlobalAdminEvents` does not subscribe and will silently miss workspace-scoped events.

**Work Order** — A billable deliverable unit associated with a workspace and optionally a Stripe payment. Tracked in the `work_orders` table. Active work orders are surfaced in `ContentPipelineSlice.workOrders`. WS event: `WS_EVENTS.WORK_ORDER_UPDATE`.

**`WS_EVENTS`** — The canonical registry of all workspace-scoped WebSocket event name constants, defined in `server/ws-events.ts`. Import from here instead of using string literals. Every new feature that emits real-time events must add its constants here.
