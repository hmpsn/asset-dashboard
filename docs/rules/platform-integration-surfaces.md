# Platform Integration Surfaces

Use this map when planning, reviewing, or assigning work across bounded contexts. `docs/rules/platform-organization.md` explains where code belongs; this document explains what tends to break together.

For new or substantially touched work, name the owning context and scan the matching surface list before choosing tests or PR readiness evidence.

## Workspace Command Center

- External APIs: Webflow/analytics providers only through downstream context reads.
- DB/storage: `workspaces`, workspace settings/config tables, reports, health snapshots, feature flag overrides.
- AI calls: Admin chat and summary generation only through platform AI helpers.
- Background jobs: Site analysis, audits, bulk workspace tasks surfaced through `/api/jobs`.
- WebSocket events: Workspace metadata, health, report, and job progress updates.
- React Query keys: Admin workspace, workspace overview, reports, health, and job/task keys.
- Surfaces: Admin workspace shell, overview, reports, settings, health cards.
- Public endpoints: Only client-safe workspace fields through public workspace serializers/routes.
- Activity types: Workspace setup, settings changes, report generation, health/audit actions.
- Docs: `docs/workflows/codebase-overview.md`, `docs/workflows/new-feature-checklist.md`, `docs/testing/platform-domain-smoke-matrix.md`.

## Client Portal

- External APIs: None directly; reads provider-derived data after server normalization.
- DB/storage: Client users, client tokens, public workspace view data, client signals, business priorities, client-visible activity.
- AI calls: Client advisor/chat and narrative summaries through approved AI dispatch paths.
- Background jobs: Visible job results only when domain-owned work exposes them to clients.
- WebSocket events: Workspace-scoped client data updates via `useWorkspaceEvents`.
- React Query keys: `client-*` portal, workspace, intelligence, inbox, analytics, and tier keys.
- Surfaces: `/client/:workspaceId/:tab?`, `/client/beta/:workspaceId/:tab?`, client auth, client dashboard sections.
- Public endpoints: `/api/public/*`, client auth endpoints, public workspace reads, public review/comment paths.
- Activity types: Client login/request/comment/approval/review actions that are safe for client activity feeds.
- Docs: `docs/workflows/client-debug.md`, `docs/rules/data-flow.md`, `docs/workflows/ui-vocabulary.md`.

## Inbox

- External APIs: Email/reminder providers if reminders are sent; otherwise internal workflow only.
- DB/storage: Approval batches/items, client actions, comments/notes, reminders, inbox routing state.
- AI calls: Optional review summaries or generated client-facing text through `callAI()`.
- Background jobs: Long-running send/review preparation if introduced; current flows should stay synchronous unless heavy.
- WebSocket events: Approval batch, client action, conversation/comment, and public review broadcasts.
- React Query keys: Admin approval/client-action keys and `client-*` inbox keys.
- Surfaces: Admin send-to-client flows, Client Inbox Decisions/Reviews/Conversations, decision modals/cards.
- Public endpoints: Public approval, client action, content review, post review, and copy review endpoints.
- Activity types: Send to client, approve, decline, request changes, comment, reminder, admin follow-up.
- Docs: `docs/rules/inbox-section-routing.md`, `docs/workflows/ui-vocabulary.md`, `docs/testing/platform-domain-smoke-matrix.md`.

## Content Pipeline

- External APIs: Webflow CMS, OpenAI/Anthropic through unified dispatch, optional research/provider data.
- DB/storage: Content briefs, posts, requests, subscriptions, templates, content matrices, publish metadata, review state.
- AI calls: Brief generation, post generation, copy review, content refresh, and factual grounding paths.
- Background jobs: Long post/brief generation, bulk content work, publish workflows that may outlive a request.
- WebSocket events: Content request/review/post/publish/job progress broadcasts.
- React Query keys: Content briefs, posts, requests, templates, plans, reviews, and background task keys.
- Surfaces: Admin Content, content plan/review, editors, public/client review flows.
- Public endpoints: Client content request/review/post review endpoints and public content plan/review reads.
- Activity types: Brief created, post generated, sent to client, approved, requested changes, published.
- Docs: `docs/rules/content-quality-grounding.md`, `docs/rules/rich-text-content.md`, `docs/workflows/wiring-patterns.md`.

## Schema

- External APIs: Webflow CMS, Google validation, Schema.org validation, AI schema generation.
- DB/storage: Schema site templates/plans, pending schemas, validation history, CMS field mappings, page elements.
- AI calls: Schema generation, semantic extraction, page/entity graph assistance through `callAI()`.
- Background jobs: Whole-site discovery, validation, bulk publish/generation, long CMS tasks.
- WebSocket events: Schema plan, validation, review, publish, and background job progress broadcasts.
- React Query keys: Schema plan, validation, reviews, CMS mappings, page elements, and background tasks.
- Surfaces: Admin Schema, Inbox schema review modal, public schema review paths.
- Public endpoints: Schema review/public plan endpoints that expose client-safe review data.
- Activity types: Schema generated, validated, sent to client, approved/requested changes, published.
- Docs: `docs/rules/workspace-intelligence.md`, `docs/rules/development-patterns.md`, `docs/rules/platform-organization.md`.

## SEO Health

- External APIs: Webflow, Google Search Console, GA4, SEMrush, DataForSEO, PageSpeed, AI providers.
- DB/storage: Audits, recommendations, tracked keywords, page keywords, PageSpeed snapshots, page identity/enrichment data.
- AI calls: SEO recommendations, rewrite suggestions, audit summaries, content decay/opportunity narratives.
- Background jobs: Bulk audits, bulk rewrites, provider refreshes, long page analysis work.
- WebSocket events: Audit, recommendation, tracked keyword, rewrite, provider refresh, and job broadcasts.
- React Query keys: SEO audit, recommendations, pages, keywords, PageSpeed, provider metrics, background tasks.
- Surfaces: Admin SEO/audit/recommendations/page intelligence/rewrite tools.
- Public endpoints: Client-safe health/recommendation summaries where exposed through the Client Portal.
- Activity types: Audit run, recommendation created/resolved, keyword tracked, rewrite saved/published.
- Docs: `docs/rules/analytics-insights.md`, `docs/workflows/wiring-patterns.md`, `docs/testing/platform-domain-smoke-matrix.md`.

## Analytics Intelligence

- External APIs: Google Search Console, GA4, SEMrush/DataForSEO where normalized into insight inputs, AI providers.
- DB/storage: Analytics insights, annotations, anomaly trackers, intelligence cache/profile tables, client signals, metrics snapshots.
- AI calls: Insight generation, narrative summaries, workspace intelligence context, anomaly digest copy.
- Background jobs: Scheduled anomaly scans, intelligence refreshes, analytics imports, digest generation.
- WebSocket events: Insight created/updated/resolved, annotation, intelligence cache, client signal broadcasts.
- React Query keys: Insights, analytics, intelligence, annotations, client intelligence, workspace intelligence keys.
- Surfaces: Admin analytics/intelligence, client intelligence/insights, advisor context.
- Public endpoints: Client intelligence and public/client insight reads.
- Activity types: Insight surfaced, resolved, annotation created, signal captured, briefing generated.
- Docs: `docs/rules/analytics-insights.md`, `docs/rules/workspace-intelligence.md`, `docs/testing-plan.md`.

## Brand Engine

- External APIs: OpenAI/Anthropic through `callAI()` and direct provider helpers only where explicitly allowed.
- DB/storage: Brand identity, brandscript, voice calibration feedback/profiles, copy pipeline, copy review data.
- AI calls: Voice calibration, prompt assembly, brand/copy generation, creative prose, copy review.
- Background jobs: Long copy generation or bulk copy refresh if work continues after response.
- WebSocket events: Brand identity, voice profile, copy review, copy pipeline, and job broadcasts.
- React Query keys: Brand identity, brandscript, voice profile, copy pipeline/review keys.
- Surfaces: Admin Brand, copy tools, client-visible copy review where routed through Inbox.
- Public endpoints: Public copy review/client review endpoints only when client-visible.
- Activity types: Brand updated, voice calibrated, copy generated, sent to client, reviewed.
- Docs: `docs/rules/brand-engine.md`, `docs/rules/content-quality-grounding.md`, `docs/workflows/wiring-patterns.md`.

## Outcomes / ROI

- External APIs: Analytics/provider reads only through normalized metrics and attribution inputs.
- DB/storage: Outcome tracking, tracked actions, attribution, learnings, early signals, work/action playbooks.
- AI calls: Learnings summaries, outcome narratives, recommendation-to-outcome interpretation.
- Background jobs: Periodic outcome measurement or attribution refresh if scheduled.
- WebSocket events: Outcome, tracked action, action playbook, and learnings updates.
- React Query keys: Outcomes, ROI, tracked actions, action playbooks, learnings.
- Surfaces: Admin outcome/ROI surfaces, client-visible wins/learnings where enabled.
- Public endpoints: Client-safe outcome summaries when exposed to Client Portal.
- Activity types: Action tracked, outcome recorded, attribution updated, learning generated, playbook resolved.
- Docs: `docs/rules/platform-organization.md`, `docs/workflows/feature-integration.md`, `docs/testing/platform-domain-smoke-matrix.md`.

## Billing / Monetization

- External APIs: Stripe Checkout, Stripe webhooks, optional email/provider notifications.
- DB/storage: Stripe config, checkout sessions, subscriptions, trials, usage, tier/entitlement state, encrypted config.
- AI calls: None for billing decisions; AI may only assist admin copy/docs outside billing state.
- Background jobs: Usage aggregation or billing sync if introduced; webhooks remain idempotent.
- WebSocket events: Workspace billing/tier/entitlement updates.
- React Query keys: Billing, usage, tier, checkout, workspace entitlement keys.
- Surfaces: Admin billing/config, client tier gates, checkout/upgrade flows.
- Public endpoints: Checkout/session and client-safe tier/entitlement reads.
- Activity types: Checkout started, subscription updated, trial started/ended, tier changed, usage recorded.
- Docs: `MONETIZATION.md`, `docs/workflows/stripe-integration.md`, `docs/workflows/staging-environment.md`.

## Integrations

- External APIs: Webflow, Google Search Console, GA4, SEMrush, DataForSEO, Stripe, OpenAI, Anthropic, email providers.
- DB/storage: Provider configs, OAuth/token material, provider cache tables, CMS mappings, sync metadata, encrypted config.
- AI calls: Provider-derived summarization only through owning product contexts.
- Background jobs: Provider syncs, CMS writes, bulk imports, validation and refresh jobs.
- WebSocket events: Provider status, sync progress, CMS write, import, and job progress updates.
- React Query keys: Provider config/status, Webflow, Google, SEMrush/DataForSEO, CMS mapping, integration sync keys.
- Surfaces: Admin integration settings, provider diagnostics, CMS publish flows.
- Public endpoints: None unless a domain-specific public view exposes normalized provider data.
- Activity types: Integration connected/disconnected, sync started/completed/failed, CMS write succeeded/failed.
- Docs: `docs/workflows/wiring-patterns.md`, `docs/workflows/deploy.md`, `docs/rules/development-patterns.md`.

## Platform Foundation

- External APIs: Sentry/log drains, Turnstile, deployment platform, and provider SDKs used by infrastructure.
- DB/storage: Jobs, auth/session state, migrations, generated rule metadata, logs/config where persisted.
- AI calls: Shared AI dispatcher and provider helpers; product contexts own prompt semantics.
- Background jobs: Core job platform, progress/result storage, cancellation, recovery.
- WebSocket events: Shared event bus, workspace subscriptions, job progress, global admin events.
- React Query keys: Background tasks, auth/session, workspace events, platform verification/support keys.
- Surfaces: Auth, middleware, validation, logging, jobs/task panel, pr-check, rules generation.
- Public endpoints: Health/auth/public support endpoints where intentionally exposed.
- Activity types: Infrastructure activity only when meaningful to a workspace audit trail.
- Docs: `CLAUDE.md`, `docs/PLAN_WRITING_GUIDE.md`, `docs/rules/automated-rules.md`, `docs/rules/background-generation.md`.

## Review Use

Before opening a PR, confirm that the touched context's DB/storage, events, query keys, public endpoints, and activity types have either been updated or explicitly marked not applicable in the PR notes. This is advisory guidance, not a new `pr-check` rule.
