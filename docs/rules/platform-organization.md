# Platform Organization

This document is the Wave 1 operating model for bounded-context ownership. Its purpose is placement and coordination clarity: when a feature is touched, everyone should know which context owns the change, which files are coordination points, and which adjacent surfaces must be checked before merging.

This is a forward-looking map, not permission for repo churn.

## Wave 1 Scope

Wave 1 defines ownership. It does **not** authorize:

- runtime behavior changes,
- repo-wide file moves,
- route or URL changes,
- DB migrations,
- `pr-check` enforcement changes,
- shared-type renames for cosmetic organization,
- or broad "clean up the tree" refactors.

If a context map entry mentions a preferred future landing spot such as `server/domains/<domain>/`, treat that as placement guidance for new adjacent work or behavior-preserving extraction only.

## Canonical Bounded Contexts

Every meaningful feature should name one primary owner from this list:

- `workspace-command-center`
- `client-portal`
- `inbox`
- `content-pipeline`
- `schema`
- `seo-health`
- `analytics-intelligence`
- `brand-engine`
- `outcomes-roi`
- `billing-monetization`
- `integrations`
- `platform-foundation`

Cross-context work must still declare one primary owner plus secondary integrations.

Related confidence maps:

- `docs/rules/platform-integration-surfaces.md` names the external APIs, DB/storage, AI calls, jobs, events, query keys, surfaces, public endpoints, and activity types that tend to break together by context.
- `docs/testing/platform-domain-smoke-matrix.md` names the fast smoke signal for each context.
- `docs/workflows/feature-class-definition-of-done.md` lists completion gates by feature class.

## Shared Coordination Files

These files are shared coordination points, not context-owned implementation homes:

- `server/app.ts` and `server/index.ts` for route registration and process wiring
- `server/ws-events.ts` for workspace/global event constants
- `server/broadcast.ts`, `server/websocket.ts`, and `src/lib/wsEvents.ts` for event transport
- `src/routes.ts` and `src/lib/client-dashboard-tab.ts` for route/tab contracts
- `src/lib/queryKeys.ts` and `src/lib/queryClient.ts` for cache-key and stale-time policy
- `shared/types/index.ts` and other shared-type barrels
- `server/middleware/validate.ts`, `server/auth.ts`, `server/middleware.ts`, `server/state-machines.ts`
- `server/jobs.ts` and `shared/types/background-jobs.ts` for background job platform contracts
- `docs/PLAN_WRITING_GUIDE.md`, `docs/rules/development-patterns.md`, and this file for operating model guidance

Touch these deliberately. Changes here almost always affect multiple contexts.

## Placement Convention For New Or Adjacent Work

Prefer this shape when adding new capability or extracting logic from an overloaded module:

```txt
shared/types/<domain>.ts
src/api/<domain>.ts
src/hooks/admin/use<Domain>.ts
src/hooks/client/useClient<Domain>.ts
src/components/<domain>/
server/routes/<domain>.ts
server/domains/<domain>/     # preferred future home for reusable business logic
tests/integration/<domain>.test.ts
tests/contract/<domain>.test.ts
docs/rules/<domain>.md
```

This is a convention for new and touched work. It is not a mandate to move old files just to make names line up.

## Ownership Map

Each context below lists practical ownership anchors for Wave 1: major route/modules, frontend surfaces, shared contracts, events, tests/docs, and coordination files that usually move with it.

### `workspace-command-center`

Owns the admin workspace shell, overview surfaces, and cross-workspace operator workflows that are not primarily inbox, schema, content, analytics, or billing features.

- Owned routes/modules:
  `server/routes/workspaces.ts`, `server/routes/workspace-home.ts`, `server/routes/workspace-badges.ts`, `server/routes/activity.ts`, `server/routes/reports.ts`, `server/routes/roadmap.ts`, `server/workspaces.ts`, `server/activity-log.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/WorkspaceHome.tsx`, `src/components/WorkspaceOverview.tsx`, `src/components/workspace-home/`, `src/components/NotificationBell.tsx`, `src/components/TaskPanel.tsx`, `src/hooks/admin/useWorkspaceHome.ts`, `src/hooks/admin/useWorkspaceOverview.ts`, `src/hooks/admin/useNotifications.ts`, `src/hooks/admin/useWorkspaces.ts`, `src/api/workspaces.ts`, `shared/types/workspace.ts`, `shared/types/features.ts`, `shared/types/roadmap.ts`
- WebSocket/events:
  `WS_EVENTS.WORKSPACE_UPDATED`, `WS_EVENTS.ACTIVITY_NEW`, admin-global workspace events when changes fan out across the admin shell
- Tests/docs:
  workspace overview contract tests, task panel/background task wiring tests, admin-shell component coverage, `docs/workflows/codebase-overview.md`
- Coordination files:
  `src/routes.ts`, `src/components/layout/Sidebar.tsx`, `src/components/SettingsPanel.tsx`, `server/app.ts`

### `client-portal`

Owns the authenticated client dashboard experience outside inbox-specific decision/review flows.

- Owned routes/modules:
  `server/routes/public-portal.ts`, `server/routes/public-auth.ts`, `server/routes/public-analytics.ts`, `server/routes/client-intelligence.ts`, `server/routes/client-signals.ts`, `server/routes/public-chat.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/client/` except inbox-specific review/decision ownership called out below, `src/components/client/Briefing/`, `src/hooks/client/useClientQueries.ts`, `useClientInsights.ts`, `useClientIntelligence.ts`, `useClientGA4.ts`, `useClientSearch.ts`, `useClientBriefing.ts`, `useMonthlyDigest.ts`, `src/api/analytics.ts`, `src/api/intelligence.ts`, `src/api/workspaces.ts`, `shared/types/client-signals.ts`, `shared/types/intelligence.ts`, `shared/types/insights.ts`, `shared/types/briefing.ts`
- WebSocket/events:
  consumes workspace-scoped events that refresh client portal read models, especially `content:updated`, `strategy:updated`, `recommendations:updated`, `intelligence:*`, `workspace:updated`
- Tests/docs:
  `tests/e2e/client-login.spec.ts`, `tests/client-intelligence-route.test.ts`, client dashboard auth/component tests, public serialization contract tests, `docs/workflows/client-debug.md`
- Coordination files:
  `src/routes.ts`, `src/lib/client-dashboard-tab.ts`, `src/components/client/ClientAuthGate.tsx`, `server/middleware.ts`

### `inbox`

Owns decision, conversation, approval, and review flows shared between admin and client, including deep-link and routing rules for Inbox sections.

- Owned routes/modules:
  `server/routes/approvals.ts`, `server/routes/client-actions.ts`, `server/routes/requests.ts`, `server/routes/public-requests.ts`, `server/approvals.ts`, `server/client-actions.ts`, `server/requests.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/admin/AdminInbox.tsx`, `src/components/admin/ActionQueue.tsx`, `src/components/admin/BriefingReviewQueue.tsx`, `src/components/client/InboxTab.tsx`, `DecisionCard.tsx`, `DecisionDetailModal.tsx`, `ApprovalBatchCard.tsx`, `PriorityStrip.tsx`, `SchemaReviewModal.tsx`, `ClientActionDetailModal.tsx`, `src/hooks/admin/useActionQueue.ts`, `useQueue.ts`, `src/api/clientActions.ts`, `shared/types/approvals.ts`, `shared/types/client-actions.ts`, `shared/types/decision.ts`, `shared/types/requests.ts`
- WebSocket/events:
  `WS_EVENTS.APPROVAL_UPDATE`, `WS_EVENTS.APPROVAL_APPLIED`, `WS_EVENTS.CLIENT_ACTION_UPDATE`, `WS_EVENTS.REQUEST_CREATED`, `WS_EVENTS.REQUEST_UPDATE`
- Tests/docs:
  `tests/e2e/approval-workflow.spec.ts`, approval/client-action contract tests, tab deep-link contract coverage, `docs/rules/inbox-section-routing.md`
- Coordination files:
  `src/routes.ts`, `src/lib/decision-adapters.ts`, `server/state-machines.ts`, `src/hooks/useWorkspaceEvents` consumers, `server/ws-events.ts`

### `content-pipeline`

Owns content planning, briefs, matrices, post generation/review/publish, copy pipeline, and content-plan client/admin surfaces.

- Owned routes/modules:
  `server/routes/content-briefs.ts`, `content-posts.ts`, `content-requests.ts`, `content-plan-review.ts`, `content-publish.ts`, `content-templates.ts`, `content-matrices.ts`, `copy-pipeline.ts`, `content-subscriptions.ts`, `server/content-brief.ts`, `server/content-posts.ts`, `server/content-posts-db.ts`, `server/content-requests.ts`, `server/content-templates.ts`, `server/content-matrices.ts`, `server/copy-generation.ts`, `server/copy-review.ts`, `server/copy-export.ts`, `server/copy-intelligence.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/ContentPipeline.tsx`, `ContentPlanner.tsx`, `ContentCalendar.tsx`, `ContentBriefs.tsx`, `PostEditor.tsx`, `src/components/briefs/`, `src/components/matrix/`, `src/components/post-editor/`, `src/components/pipeline/`, `src/hooks/admin/useAdminBriefs.ts`, `useAdminPosts.ts`, `useContentPipeline.ts`, `useContentCalendar.ts`, `useCopyPipeline.ts`, `src/api/content.ts`, `src/api/briefing.ts`, `shared/types/content.ts`, `shared/types/copy-pipeline.ts`
- WebSocket/events:
  `WS_EVENTS.CONTENT_UPDATED`, `WS_EVENTS.CONTENT_PUBLISHED`, `WS_EVENTS.POST_UPDATED`, copy pipeline progress/completion events
- Tests/docs:
  `tests/assemble-content-pipeline.test.ts`, copy-pipeline query-key contracts, post editor/rich-text tests, client content-plan serialization coverage, `docs/rules/rich-text-content.md`
- Coordination files:
  `src/lib/queryKeys.ts`, `server/jobs.ts` for long-running generation, `shared/types/background-jobs.ts`, `server/routes/public-content.ts`

### `schema`

Owns schema generation, validation, plan/review/publish flows, CMS field mapping for schema delivery, and schema-related AI/data extraction.

- Owned routes/modules:
  `server/routes/webflow-schema.ts`, `server/routes/competitor-schema.ts`, `server/schema-store.ts`, `server/schema-plan.ts`, `server/schema-validator.ts`, `server/schema-suggester.ts`, `server/schema-generation-job.ts`, `server/schema-queue.ts`, `server/helpers.ts:buildSchemaContext`, `server/schema/`
- Owned components/hooks/API wrappers/shared types:
  `src/components/SchemaSuggester.tsx`, `src/components/schema/`, `src/hooks/admin/useSchemaValidation.ts`, `src/components/client/SchemaReviewTab.tsx`, `src/components/client/SchemaReviewModal.tsx`, `src/api/seo.ts` for current schema-facing wrappers, `shared/types/schema-generation.ts`, `shared/types/schema-plan.ts`, `shared/types/schema-validation.ts`, `shared/types/site-inventory.ts`, `shared/types/page-elements.ts`
- WebSocket/events:
  `WS_EVENTS.SCHEMA_PLAN_SENT`, `WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED`, `WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED`
- Tests/docs:
  `tests/unit/schema/`, schema component coverage, schema background-job contracts, schema public/client review read-path tests, `docs/rules/workspace-intelligence.md` for schema-context slice usage
- Coordination files:
  `server/routes/webflow-cms.ts`, `server/routes/webflow.ts`, `server/jobs.ts`, `src/routes.ts` for schema review deep links

### `seo-health`

Owns SEO audit, SEO editor, page/site health workflows, diagnostics rooted in page optimization, and operational page tooling that is not primarily analytics-intelligence.

- Owned routes/modules:
  `server/routes/webflow-seo-audit.ts`, `webflow-seo-suggestions.ts`, `webflow-seo-rewrite.ts`, `webflow-seo-bulk-rewrite.ts`, `webflow-seo-bulk-rewrite-job.ts`, `webflow-seo-jobs.ts`, `webflow-seo-page-tools.ts`, `webflow-pagespeed.ts`, `webflow-analysis.ts`, `webflow-audit.ts`, `site-architecture.ts`, `backlinks.ts`, `rank-tracking.ts`, `server/seo-audit.ts`, `server/seo-audit-cwv.ts`, `server/pagespeed.ts`, `server/internal-links.ts`, `server/redirect-scanner.ts`, `server/site-architecture.ts`, `server/page-analysis-job.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/SeoAudit.tsx`, `SeoEditor.tsx`, `SeoEditorWrapper.tsx`, `src/components/editor/`, `src/components/audit/`, `src/components/PageSpeedPanel.tsx`, `LinkChecker.tsx`, `RedirectManager.tsx`, `InternalLinks.tsx`, `RankTracker.tsx`, `SiteArchitecture.tsx`, `src/components/page-intelligence/`, `src/hooks/admin/useAdminSeo.ts`, `useSeoEditor.ts`, `useHealthCheck.ts`, `usePageJoin.ts`, `src/api/seo.ts`, `shared/types/diagnostics.ts`, `shared/types/page-join.ts`, `shared/types/page-strategy.ts`, `shared/types/page-address.ts`, `shared/types/recommendations.ts`
- WebSocket/events:
  `WS_EVENTS.AUDIT_COMPLETE`, bulk operation progress/failure events, `WS_EVENTS.PAGE_STATE_UPDATED`, `WS_EVENTS.RECOMMENDATIONS_UPDATED`
- Tests/docs:
  SEO editor extraction contracts, diagnostic invalidation tests, audit component coverage, page identity contracts, `docs/rules/ai-dispatch-patterns.md` where rewrite/analyze jobs touch AI write paths
- Coordination files:
  `server/routes/diagnostics.ts`, `server/routes/recommendations.ts`, `src/lib/pathUtils.ts`, `server/ws-events.ts`

### `analytics-intelligence`

Owns insight generation/hydration, intelligence slices, anomaly/recommendation engines, briefing narratives, search/analytics read models, and admin/client intelligence surfaces.

- Owned routes/modules:
  `server/routes/intelligence.ts`, `insights.ts`, `anomalies.ts`, `recommendations.ts`, `briefing.ts`, `suggested-briefs.ts`, `analytics.ts`-adjacent read routes such as `public-analytics.ts` and `client-intelligence.ts`, `server/analytics-intelligence.ts`, `server/analytics-insights-store.ts`, `server/workspace-intelligence.ts`, `server/intelligence/`, `server/churn-signals.ts`, `server/quick-wins.ts`, `server/briefing-*`, `server/insight-feedback.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/AnalyticsHub.tsx`, `AnalyticsOverview.tsx`, `AnalyticsAnnotations.tsx`, `KeywordAnalysis.tsx`, `SearchDetail.tsx`, `TrafficDetail.tsx`, `src/components/insights/`, `src/components/client/InsightsDigest.tsx`, `InsightCards.tsx`, `IntelligenceSummaryCard.tsx`, `src/hooks/admin/useInsightFeed.ts`, `useAnalyticsOverview.ts`, `useAnomalyAlerts.ts`, `useIntelligenceSignals.ts`, `useWorkspaceIntelligence.ts`, `src/hooks/client/useClientInsights.ts`, `useClientIntelligence.ts`, `src/api/analytics.ts`, `src/api/intelligence.ts`, `shared/types/analytics.ts`, `shared/types/intelligence.ts`, `shared/types/insights.ts`, `shared/types/briefing.ts`, `shared/types/client-signals.ts`, `shared/types/narrative.ts`
- WebSocket/events:
  `WS_EVENTS.ANOMALIES_UPDATE`, `WS_EVENTS.INSIGHT_RESOLVED`, `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED`, `WS_EVENTS.INTELLIGENCE_CACHE_UPDATED`, `WS_EVENTS.SUGGESTED_BRIEF_UPDATED`, `WS_EVENTS.INSIGHT_BRIDGE_UPDATED`, client-signal events
- Tests/docs:
  intelligence assembler tests, client intelligence tier/read-path tests, briefing contracts, insight renderer tests, `docs/rules/analytics-insights.md`, `docs/rules/workspace-intelligence.md`, `docs/rules/bridge-authoring.md`
- Coordination files:
  `server/bridge-infrastructure.ts`, `server/routes/activity.ts`, `src/lib/queryKeys.ts`, `src/hooks/useWorkspaceEvents` invalidation handlers

### `brand-engine`

Owns discovery, voice calibration, brand identity, brandscripts, page strategy/blueprints, and copy/brand steering experiences.

- Owned routes/modules:
  `server/routes/brandscript.ts`, `brand-identity.ts`, `voice-calibration.ts`, `brand-docs.ts`, `page-strategy.ts`, `rewrite-chat.ts`, `aeo-review.ts`, `server/brandscript.ts`, `server/voice-calibration.ts`, `server/page-strategy.ts`, `server/prompt-assembly.ts`, `server/prompt-rich-blocks.ts`, `server/meeting-brief-generator.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/BrandHub.tsx`, `src/components/brand/`, `src/components/brand/voice-tab/`, `src/components/PageRewriteChat.tsx`, `src/hooks/admin/useBlueprints.ts`, `useBriefingDrafts.ts`, `src/api/brand-engine.ts`, `shared/types/brand-engine.ts`, `shared/types/page-strategy.ts`, `shared/types/briefing.ts`, `shared/types/aeo.ts`
- WebSocket/events:
  `WS_EVENTS.BRANDSCRIPT_UPDATED`, `WS_EVENTS.DISCOVERY_UPDATED`, `WS_EVENTS.VOICE_PROFILE_UPDATED`, `WS_EVENTS.BRAND_IDENTITY_UPDATED`, `WS_EVENTS.BLUEPRINT_UPDATED`, `WS_EVENTS.BLUEPRINT_GENERATED`, copy-section/copy-metadata events when brand-owned copy workflows emit them
- Tests/docs:
  voice-tab contract tests, brand-engine query-key contracts, rewrite output contracts, `docs/rules/brand-engine.md`
- Coordination files:
  `server/ai.ts`, `server/openai-helpers.ts`, `server/anthropic-helpers.ts`, `server/workspace-intelligence.ts` when prompt context depends on slices

### `outcomes-roi`

Owns outcome tracking, attribution, scorecards, playbooks, ROI dashboards, and win/loss learning loops.

- Owned routes/modules:
  `server/routes/outcomes.ts`, `revenue.ts`, `server/roi.ts`, `server/roi-attribution.ts`, `server/outcome-measurement.ts`, `server/outcome-playbooks.ts`, `server/outcome-backfill.ts`, `server/outcome-crons.ts`, `server/outcome-scoring-defaults.ts`, `server/workspace-learnings.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/RevenueDashboard.tsx`, `src/components/admin/outcomes/`, `src/components/client/ROIDashboard.tsx`, `OutcomeSummary.tsx`, `src/hooks/admin/useOutcomes.ts`, `useAdminROI.ts`, `src/hooks/client/useClientOutcomes.ts`, `src/api/outcomes.ts`, `shared/types/outcome-tracking.ts`
- WebSocket/events:
  `WS_EVENTS.OUTCOME_ACTION_RECORDED`, `WS_EVENTS.OUTCOME_SCORED`, `WS_EVENTS.OUTCOME_EXTERNAL_DETECTED`, `WS_EVENTS.OUTCOME_LEARNINGS_UPDATED`, `WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED`
- Tests/docs:
  outcomes dashboard component tests, outcome scoring/backfill coverage, ROI attribution tests, `docs/rules/outcome-engine-stubs.md`
- Coordination files:
  `server/routes/activity.ts`, `shared/types/intelligence.ts` when outcomes feed client/admin intelligence summaries

### `billing-monetization`

Owns Stripe configuration, plans, tier gating, purchases, subscriptions, and monetization UX.

- Owned routes/modules:
  `server/routes/stripe.ts`, `server/routes/content-subscriptions.ts`, `server/payments.ts`, `server/stripe.ts`, `server/stripe-config.ts`, `server/usage-tracking.ts`, `server/trial-reminders.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/StripeSettings.tsx`, `src/components/client/TierGate` consumers, `UpgradeModal.tsx`, `SeoCart.tsx`, `PricingConfirmationModal.tsx`, `EmailCaptureGate.tsx`, `OrderStatus.tsx`, `src/api/workspaces.ts` and `src/api/content.ts` for plan/purchase surfaces, `shared/types/payments.ts`, `shared/types/features.ts`
- WebSocket/events:
  usually coordinates through `WS_EVENTS.WORKSPACE_UPDATED` for tier/config visibility rather than a separate billing event namespace
- Tests/docs:
  tier-gate contract tests, Stripe mock-backed integration tests, `docs/workflows/stripe-integration.md`, `MONETIZATION.md`
- Coordination files:
  `src/components/ui/TierGate.tsx`, `server/constants.ts`, `src/constants.ts`, `server/routes/public-portal.ts`

### `integrations`

Owns external provider boundaries, provider config/status, ingestion sync points, and external-service adapters used by multiple product contexts.

- Owned routes/modules:
  `server/routes/google.ts`, `semrush.ts`, `webflow.ts`, `webflow-cms.ts`, `webflow-cms-images.ts`, `discovery-ingestion.ts`, `llms-txt.ts`, `server/webflow-client.ts`, `server/webflow.ts`, `server/webflow-pages.ts`, `server/webflow-assets.ts`, `server/webflow-cms.ts`, `server/google-analytics.ts`, `server/semrush.ts`, `server/seo-data-provider.ts`, `server/seo-provider-signals.ts`, `server/discovery-ingestion.ts`, `server/email.ts`, `server/email-queue.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/settings/ConnectionsTab.tsx`, `src/components/assets/`, `src/hooks/admin/useAdminAssets.ts`, `useAdminGA4.ts`, `useAdminSearch.ts`, `src/api/seo.ts`, `src/api/analytics.ts`, `shared/types/cms-images.ts`, provider-facing portions of `shared/types/workspace.ts`
- WebSocket/events:
  no single integration namespace today; integration-owned writes usually emit downstream domain events such as `workspace:updated`, `schema:*`, `content:*`, or `diagnostic:*`
- Tests/docs:
  provider mock suites in `tests/mocks/`, integration route tests, `docs/workflows/auth-system.md` and provider-specific workflow docs when setup impacts runtime behavior
- Coordination files:
  `server/auth.ts`, `server/middleware.ts`, `server/data-dir.ts`, `server/studio-config.ts`, settings screens that expose connection health

### `platform-foundation`

Owns cross-cutting runtime infrastructure: auth, validation, jobs, feature flags, logging, error handling, shared UI primitives, and platform-wide operational contracts.

- Owned routes/modules:
  `server/routes/auth.ts`, `users.ts`, `health.ts`, `features.ts`, `jobs.ts`, `debug.ts`, `data-export.ts`, `settings.ts`, plus `server/auth.ts`, `server/middleware/`, `server/jobs.ts`, `server/logger.ts`, `server/errors.ts`, `server/feature-flags.ts`, `server/sentry.ts`, `server/db/`, `server/startup.ts`
- Owned components/hooks/API wrappers/shared types:
  `src/components/ui/`, `src/components/layout/`, `src/components/LoginScreen.tsx`, `src/components/MobileGuard.tsx`, `src/components/Toast.tsx`, `src/hooks/shared/`, `src/api/client.ts`, `src/api/index.ts`, `src/lib/queryClient.ts`, `src/lib/queryKeys.ts`, `shared/types/background-jobs.ts`, `shared/types/feature-flags.ts`, `shared/types/users.ts`
- WebSocket/events:
  ownership of the transport and contracts in `server/ws-events.ts`, `src/lib/wsEvents.ts`, `server/websocket.ts`; some event names belong to product contexts, but transport policy belongs here
- Tests/docs:
  auth guard tests, background-job task-panel contracts, `tests/pr-check.test.ts`, `docs/rules/development-patterns.md`, `docs/rules/background-generation.md`, `docs/rules/multi-agent-coordination.md`
- Coordination files:
  nearly every context touches this one indirectly; treat it as the infra owner, not the dumping ground for feature logic

## Route-To-Service Extraction Guidance

Route files should trend toward HTTP adapter responsibilities only:

- auth,
- validation,
- request parsing,
- response shaping,
- activity logging,
- and broadcast calls.

Reusable business behavior should move into `server/domains/<domain>/` or an established adjacent module for the owning context. Extraction work in Wave 1 must preserve existing URLs, response shapes, status codes, broadcasts, activity logs, query keys, and tests.

## Frontend Decomposition Guidance

Large page or tab components should decompose into:

- route/page shells,
- React Query hooks and mutations,
- section/view-model helpers,
- repeated section components,
- modal/drawer components,
- and shared UI primitives only when at least two call sites need the pattern.

Do not pair structural extraction with a broad visual redesign unless the roadmap item explicitly calls for both.

## Big-Bang Reorganization Prohibition

Avoid whole-repo feature-folder migrations in Wave 1. They create review noise and break invisible contracts across:

- public/client endpoint serialization,
- React Query keys,
- WebSocket invalidation,
- feature flags,
- activity logging,
- AI prompt/rendering contracts,
- and test wiring.

Any broader migration belongs to a later, explicitly planned phase with:

- a pre-plan audit,
- dependency graph,
- exclusive file ownership,
- compatibility strategy,
- one PR per phase,
- and verification gates at each phase boundary.
