// ── Lexicon registry (root vocabulary contract) ─────────────────────────────
//
// Machine-readable companion to GLOSSARY.md. This registry promotes the glossary
// from a reference document into an ENFORCED contract: `scripts/lexicon-registry.ts`
// (run as `npm run verify:lexicon`) asserts registry ↔ GLOSSARY parity in both
// directions and enforces the duplicate-exported-name allowlist.
//
// Modeled on FEATURE_FLAG_CATALOG (shared/types/feature-flags.ts): a single typed
// array of entries plus a companion allowlist, verified by a pure report builder.
//
// This registry POINTS AT owning files (state-machines.ts, activity-log.ts,
// ws-events.ts, stripe.ts, …). It never re-declares a union or enum — the owning
// module stays the single source of truth for values; the lexicon is the source of
// truth for *word classes* and *duplicate-name governance*.
//
// Word classes (aligned with docs/rules/deprecation-lifecycle.md — 'historical' is
// the write-time-frozen tier that predates but does not conflict with that taxonomy):
//   - canonical           — a core domain term the platform owns and defines.
//   - externally-mirrored — a word whose spelling/values are dictated by a third
//                            party (Stripe, Google Business Profile, Webflow). We
//                            mirror it verbatim; renaming it would break the
//                            integration. Tagged with `externalSource`.
//   - historical          — an append-only / write-time-frozen value (e.g. ActivityType
//                            members already persisted in activity_log rows). Renderers
//                            must tolerate retired words; the value is never renamed.
//   - proposed            — vocabulary snapshotted from the (untracked) redesign mockup.
//                            PROPOSED-only intake: no live identifier is renamed and no
//                            type is reserved. Carries `resolvingTicket` for the ticket
//                            that will either promote it to canonical or drop it.
//
// See docs/rules/lexicon.md for the full contract, PROPOSED intake process, and the
// allowlist burn-down rule.

export const LEXICON_WORD_CLASSES = [
  'canonical',
  'externally-mirrored',
  'historical',
  'proposed',
] as const;

export type LexiconWordClass = (typeof LEXICON_WORD_CLASSES)[number];

/**
 * Valid `resolvingTicket` shapes (verified by `scripts/lexicon-registry.ts`):
 *   - `R\d+`          — a Reconcile ticket that burns the entry down (e.g. `R2`).
 *   - `reconcile-P\d+` — a Reconcile *phase* that promotes/drops a proposed term (e.g. `reconcile-P2`).
 *   - `permanent`     — a by-design duplicate/mirror that is never removed.
 * A typo (`permanant`, `R2x`, `reconcile-2`) or a free-form string fails the verifier.
 * Kept as a regex rather than a closed union so new ticket numbers/phases don't
 * require a type edit; the shape is still strictly enforced.
 */
export const LEXICON_TICKET_PATTERN = /^(?:R\d+|reconcile-P\d+|permanent)$/;

export function isValidLexiconTicket(ticket: string): boolean {
  return LEXICON_TICKET_PATTERN.test(ticket);
}

export interface LexiconEntry {
  /** The term as written in GLOSSARY.md (backticks/`()` are normalized during parity). */
  term: string;
  wordClass: LexiconWordClass;
  /** One-line definition pointer (the full prose lives in GLOSSARY.md). */
  definition: string;
  /** For canonical terms that map to a TypeScript type/union, the type name. */
  canonicalType?: string;
  /** Owning file(s) where the term's values are declared (source of truth). */
  declarationSites?: string[];
  /** For externally-mirrored terms: 'stripe' | 'gbp' | 'webflow'. */
  externalSource?: string;
  /**
   * For proposed (and burn-down) terms: the ticket that will resolve them.
   * Must match `LEXICON_TICKET_PATTERN` (`R\d+` | `reconcile-P\d+` | `permanent`).
   * Required on every `proposed` entry (enforced by the verifier).
   */
  resolvingTicket?: string;
}

/**
 * A grandfathered duplicate exported type/interface name. The pre-plan census
 * (docs/superpowers/audits/2026-07-01-reconcile-plan-audit-inventories.json §R1)
 * verified 30 names declared in exactly two files across shared/ + server/.
 *
 * Every entry carries a `resolvingTicket`:
 *   - `R2`        — the two brand-artifact Deliverable* names, resolved by the R2
 *                   rename (BrandDeliverableType/Status). Removed from the allowlist
 *                   when R2 lands (burn-down rule).
 *   - `permanent` — mirror/twin pairs that are intentionally duplicated by design
 *                   (server data-fetcher shapes mirrored into shared/types for the
 *                   client; server-internal near-duplicates). Consolidating them is a
 *                   separate ticket with its own read-path risk; the allowlist keeps
 *                   the name-collision rule green without forcing a merge.
 */
export interface DuplicateNameAllowEntry {
  /** The exported type/interface name that collides. */
  name: string;
  /** The two (or more) files that declare it. */
  files: string[];
  /**
   * Ticket that resolves the duplicate, or 'permanent' for by-design mirrors.
   * Must match `LEXICON_TICKET_PATTERN` (`R\d+` | `reconcile-P\d+` | `permanent`).
   */
  resolvingTicket: string;
  /** Why the duplicate exists / why it is permanent. */
  rationale?: string;
}

// ── Canonical domain terms (mirror GLOSSARY.md §canonical) ───────────────────

const CANONICAL: readonly LexiconEntry[] = [
  {
    term: 'Action Catalog',
    wordClass: 'canonical',
    definition: 'Read-only metadata registry keyed by (context, action), importing the five action/status unions.',
    canonicalType: 'ActionCatalogEntry',
    declarationSites: ['shared/types/action-catalog.ts'],
  },
  {
    term: 'ActionPlaybook',
    wordClass: 'canonical',
    definition: 'Detected pattern of high-win-rate actions surfaced in LearningsSlice.playbooks.',
    declarationSites: ['server/outcome-playbooks.ts'],
  },
  {
    term: 'Activity Log',
    wordClass: 'canonical',
    definition: 'Chronological audit trail of significant platform operations via addActivity().',
    declarationSites: ['server/activity-log.ts'],
  },
  {
    term: 'Admin Events',
    wordClass: 'canonical',
    definition: 'Site-wide-fanout WebSocket events in ADMIN_EVENTS; handled via useGlobalAdminEvents.',
    declarationSites: ['server/ws-events.ts'],
  },
  {
    term: 'Annotation',
    wordClass: 'canonical',
    definition: 'Date-label marker on an analytics chart correlating traffic changes with known events.',
    declarationSites: ['server/annotations.ts', 'server/analytics-annotations.ts'],
  },
  {
    term: 'Approval Batch',
    wordClass: 'canonical',
    definition: 'Named collection of ApprovalItem records sent to a client for review.',
    canonicalType: 'ApprovalBatch',
    declarationSites: ['shared/types/approvals.ts'],
  },
  {
    term: 'Approval Item',
    wordClass: 'canonical',
    definition: 'A single proposed change within an ApprovalBatch.',
    canonicalType: 'ApprovalItem',
    declarationSites: ['shared/types/approvals.ts'],
  },
  {
    term: 'Audit Snapshot',
    wordClass: 'canonical',
    definition: 'Persisted record of a site SEO audit run (audit_snapshots table).',
    declarationSites: ['server/audit-snapshots-store.ts'],
  },
  {
    term: 'Blueprint',
    wordClass: 'canonical',
    definition: 'Page strategy entry in the Copy & Brand Engine mapping a page to its copy structure.',
    declarationSites: ['server/page-strategy.ts'],
  },
  {
    term: 'Brand Identity',
    wordClass: 'canonical',
    definition: 'AI-generated brand deliverables produced from brandscript + voice profile.',
    declarationSites: ['server/brand-identity.ts'],
  },
  {
    term: 'Brandscript',
    wordClass: 'canonical',
    definition: 'Structured brand narrative modeled on StoryBrand (brandscript_sections table).',
    declarationSites: ['server/brandscript.ts'],
  },
  {
    term: 'Bridge',
    wordClass: 'canonical',
    definition: 'Server-side callback that reacts to an insight/event and cross-links module state.',
    declarationSites: ['server/bridge-infrastructure.ts'],
  },
  {
    term: 'Broadcast',
    wordClass: 'canonical',
    definition: 'Workspace-scoped WebSocket push via broadcastToWorkspace().',
    declarationSites: ['server/broadcast.ts'],
  },
  {
    term: 'buildSystemPrompt()',
    wordClass: 'canonical',
    definition: 'Layer-2 prompt assembly that injects voice DNA when a profile is calibrated.',
    declarationSites: ['server/prompt-assembly.ts'],
  },
  {
    term: 'Client Intelligence',
    wordClass: 'canonical',
    definition: 'Scrubbed, tier-gated view of WorkspaceIntelligence for the client portal.',
    canonicalType: 'ClientIntelligence',
    declarationSites: ['shared/types/intelligence.ts'],
  },
  {
    term: 'Client Session',
    wordClass: 'canonical',
    definition: 'Client-portal auth mechanism: an HMAC cookie named client_session_<wsId>.',
    declarationSites: ['server/public-portal.ts'],
  },
  {
    term: 'ClientSignalsSlice',
    wordClass: 'canonical',
    definition: 'Workspace intelligence slice capturing client engagement and feedback signals.',
    canonicalType: 'ClientSignalsSlice',
    declarationSites: ['server/intelligence/client-signals-slice.ts'],
  },
  {
    term: 'Content Matrix',
    wordClass: 'canonical',
    definition: 'Planning grid generating content cells from configurable dimensions.',
    declarationSites: ['shared/types/content.ts'],
  },
  {
    term: 'Copy Pipeline',
    wordClass: 'canonical',
    definition: 'Phase-3 Copy & Brand Engine: AI copy generation for blueprint sections.',
    declarationSites: ['shared/types/copy-pipeline.ts'],
  },
  {
    term: 'Deep Diagnostics',
    wordClass: 'canonical',
    definition: 'On-demand AI investigation of a specific anomaly/insight (diagnostic_reports).',
    declarationSites: ['server/diagnostic-store.ts'],
  },
  {
    term: 'DecisionDetailModal',
    wordClass: 'canonical',
    definition: 'Full-screen client inbox modal for a NormalizedDecision with isSingleAction:false.',
    declarationSites: ['src/components/client/DecisionDetailModal.tsx'],
  },
  {
    term: 'Discovery',
    wordClass: 'canonical',
    definition: 'Source ingestion for the Copy & Brand Engine (transcripts, brand docs, competitors).',
    declarationSites: ['server/discovery-ingestion.ts'],
  },
  {
    term: 'Feature Flag',
    wordClass: 'canonical',
    definition: 'Compile-time-keyed toggle in FEATURE_FLAGS controlling dark-launch/enablement.',
    canonicalType: 'FeatureFlagKey',
    declarationSites: ['shared/types/feature-flags.ts'],
  },
  {
    term: 'GBP Review Response lifecycle',
    wordClass: 'canonical',
    // Canonical, NOT externally-mirrored: the GBP_REVIEW_RESPONSE_STATUSES values
    // (draft/awaiting_client/changes_requested/declined/approved/publishing/published/
    // publish_failed/cancelled) are the platform's OWN send-to-client approval lifecycle —
    // Google's review-reply API does not dictate them. Only GBP_REVIEW_RATINGS is mirrored.
    definition:
      'The platform-owned draft…published/publish_failed send-to-client approval lifecycle for GBP review replies (Google’s reply API dictates no status vocabulary).',
    canonicalType: 'GbpReviewResponseStateStatus',
    declarationSites: ['server/state-machines.ts', 'shared/types/google-business-profile.ts'],
  },
  {
    term: 'Impact Score',
    wordClass: 'canonical',
    definition: 'Numeric ranking field on AnalyticsInsight used to sort the priority feed.',
    declarationSites: ['shared/types/analytics.ts'],
  },
  {
    term: 'InboxFilter',
    wordClass: 'canonical',
    definition: 'Discriminated union controlling the visible client inbox section (decisions|reviews|conversations).',
    canonicalType: 'InboxFilter',
    declarationSites: ['shared/types/inbox.ts'],
  },
  {
    term: 'InboxSection',
    wordClass: 'canonical',
    definition: 'One of three logical inbox regions: Decisions, Reviews, Conversations.',
    declarationSites: ['docs/rules/inbox-section-routing.md'],
  },
  {
    term: 'Insight',
    wordClass: 'canonical',
    definition: 'AI-generated finding stored in analytics_insights with a typed InsightType.',
    canonicalType: 'AnalyticsInsight',
    declarationSites: ['shared/types/analytics.ts'],
  },
  {
    term: 'InsightDataMap',
    wordClass: 'canonical',
    definition: 'Discriminated-union map giving type-safe access to an insight data payload by type.',
    canonicalType: 'InsightDataMap',
    declarationSites: ['shared/types/analytics.ts'],
  },
  {
    term: 'InsightType',
    wordClass: 'canonical',
    definition: 'String-literal union enumerating all valid insight categories.',
    canonicalType: 'InsightType',
    declarationSites: ['shared/types/analytics.ts'],
  },
  {
    term: 'Intelligence',
    wordClass: 'canonical',
    definition: 'Assembled WorkspaceIntelligence object produced at query time by the facade.',
    canonicalType: 'WorkspaceIntelligence',
    declarationSites: ['server/workspace-intelligence.ts'],
  },
  {
    term: 'Intent Signal',
    wordClass: 'canonical',
    definition: 'Signal detected in client chat indicating a service or content interest.',
    declarationSites: ['server/client-signals-store.ts'],
  },
  {
    term: 'parseJsonSafe / parseJsonSafeArray / parseJsonFallback',
    wordClass: 'canonical',
    definition: 'DB-boundary JSON validation utilities; bare JSON.parse on columns is forbidden.',
    declarationSites: ['server/db/json-validation.ts'],
  },
  {
    term: 'Page Intelligence',
    wordClass: 'canonical',
    definition: 'Per-page SEO analysis persisted in page_analyses, assembled into PageProfileSlice.',
    declarationSites: ['server/page-strategy.ts'],
  },
  {
    term: 'NormalizedDecision',
    wordClass: 'canonical',
    definition: 'Unified inbox item interface flattening ClientAction and ApprovalBatch.',
    canonicalType: 'NormalizedDecision',
    declarationSites: ['shared/types/decision.ts'],
  },
  {
    term: 'Probe',
    wordClass: 'canonical',
    definition: 'Read-only diagnostic endpoint for health checks; exempt from addActivity().',
    declarationSites: ['scripts/pr-check.ts'],
  },
  {
    term: 'requireWorkspaceAccess',
    wordClass: 'canonical',
    definition: 'Express middleware verifying caller access to the URL :id workspace.',
    declarationSites: ['server/middleware.ts'],
  },
  {
    term: 'rowToX() mapper',
    wordClass: 'canonical',
    definition: 'Convention transforming a raw SQLite row into a typed domain object.',
    declarationSites: ['server/db/'],
  },
  {
    term: 'Slice',
    wordClass: 'canonical',
    definition: 'Named component of WorkspaceIntelligence assembly; each has an assemble* function.',
    declarationSites: ['server/intelligence/'],
  },
  {
    term: 'stmts() / createStmtCache()',
    wordClass: 'canonical',
    definition: 'Lazy prepared-statement pattern; module-scope db.prepare() is forbidden.',
    declarationSites: ['server/db/stmt-cache.ts'],
  },
  {
    term: 'Suggested Brief',
    wordClass: 'canonical',
    definition: 'AI-inferred content brief recommendation from ranking/decay insights.',
    canonicalType: 'SuggestedBrief',
    declarationSites: ['shared/types/intelligence.ts'],
  },
  {
    term: 'TierGate',
    wordClass: 'canonical',
    definition: 'UI primitive soft-gating features behind subscription tiers.',
    declarationSites: ['src/components/ui/TierGate.tsx'],
  },
  {
    term: 'Tracked Action',
    wordClass: 'canonical',
    definition: 'A tracked_actions row recorded via recordAction(); keep-marker types are live producers, not scored outcomes.',
    canonicalType: 'ActionType',
    declarationSites: ['shared/types/outcome-tracking.ts', 'server/outcome-tracking.ts'],
  },
  {
    term: 'Usage Tracking',
    wordClass: 'canonical',
    definition: 'Per-workspace, per-month quota enforcement for specific features.',
    declarationSites: ['server/usage-tracking.ts'],
  },
  {
    term: 'Voice Profile',
    wordClass: 'canonical',
    definition: 'Workspace-specific AI voice configuration (draft → calibrating → calibrated).',
    declarationSites: ['server/voice-calibration.ts'],
  },
  {
    term: 'Workspace',
    wordClass: 'canonical',
    definition: 'Primary multi-tenant unit; one workspace = one client site.',
    canonicalType: 'Workspace',
    declarationSites: ['shared/types/workspace.ts'],
  },
  {
    term: 'useWorkspaceEvents',
    wordClass: 'canonical',
    definition: 'Frontend hook for workspace-scoped WebSocket broadcasts (subscribes, unlike global).',
    declarationSites: ['src/hooks/useWorkspaceEvents.ts'],
  },
  {
    term: 'WinsSurface',
    wordClass: 'canonical',
    definition: 'Client-facing curated feed of verified positive outcomes from outcome_tracking.',
    declarationSites: ['src/components/client/wins/'],
  },
  {
    term: 'Work Order',
    wordClass: 'canonical',
    definition: 'Billable deliverable unit associated with a workspace and optional Stripe payment.',
    declarationSites: ['shared/types/workspace.ts'],
  },
  {
    term: 'WS_EVENTS',
    wordClass: 'canonical',
    definition: 'Canonical registry of workspace-scoped WebSocket event name constants.',
    declarationSites: ['server/ws-events.ts'],
  },
];

// ── Externally-mirrored terms (spelling dictated by a third party) ───────────

const EXTERNALLY_MIRRORED: readonly LexiconEntry[] = [
  {
    term: 'ContentSubStatus (past_due)',
    wordClass: 'externally-mirrored',
    definition: "Content subscription status; 'past_due' mirrors Stripe's subscription status word.",
    externalSource: 'stripe',
    canonicalType: 'ContentSubStatus',
    declarationSites: ['server/state-machines.ts', 'server/stripe.ts'],
  },
  {
    term: 'GBP_REVIEW_RATINGS',
    wordClass: 'externally-mirrored',
    definition: 'Google Business Profile star-rating enum (ONE…FIVE) mirrored from the GBP reviews API.',
    externalSource: 'gbp',
    canonicalType: 'GbpReviewRating',
    declarationSites: ['shared/types/google-business-profile.ts'],
  },
  {
    term: 'Webflow publish state (isDraft / isArchived / lastPublished)',
    wordClass: 'externally-mirrored',
    definition: 'Webflow CMS/page publish-state field names mirrored from the Webflow API.',
    externalSource: 'webflow',
    declarationSites: ['server/webflow-cms.ts', 'server/webflow-pages.ts'],
  },
];

// ── Historical terms (write-time-frozen, append-only) ────────────────────────

const HISTORICAL: readonly LexiconEntry[] = [
  {
    term: 'ActivityType',
    wordClass: 'historical',
    definition:
      'The ~133-member append-only union of activity-log action words. Values persisted in activity_log rows are never renamed; renderers must tolerate retired words. New members require a lexicon registry entry (enforced by the ActivityType minting guard).',
    canonicalType: 'ActivityType',
    declarationSites: ['server/activity-log.ts'],
  },
];

// ── Proposed terms (snapshotted from the untracked redesign mockup) ──────────
// PROPOSED-only intake (owner-ratified): definitions are snapshotted here because the
// source folder (the untracked redesign "Design System/mockup/" folder) is not in version
// control. No live identifier is renamed and no type is reserved. Each resolves via the
// redesign P2 phase. See GLOSSARY.md §proposed + docs/rules/lexicon.md for the full paths.

const PROPOSED: readonly LexiconEntry[] = [
  {
    term: 'thread kind: request',
    wordClass: 'proposed',
    definition:
      'A client-thread message the client sent back that is PROMOTABLE into a strategy signal (→ Insights Engine) rather than just a task. Mockup store.js kind union.',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'thread kind: instruction',
    wordClass: 'proposed',
    definition: 'A client-thread "do-this" message that becomes a task and stays a task (not promotable). Mockup store.js.',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'thread kind: approval',
    wordClass: 'proposed',
    definition: 'A client-thread message where the client accepted; informational, logged as a proof point. Mockup store.js.',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'promotable',
    wordClass: 'proposed',
    definition: 'Boolean marking a client request as eligible to be promoted into a strategy signal / backing move. Mockup store.js.',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'thread status: new | ack | handled',
    wordClass: 'proposed',
    definition: 'Operator-side lifecycle of a client-thread message. new→ack→handled. Mockup store.js / requests.js.',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'Cockpit rail: From {client}',
    wordClass: 'proposed',
    definition: 'Right-rail (co-rail) section surfacing replies from a client’s portal — "a human is waiting". Mockup cockpit.js (ck-from).',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'Cockpit rail: Technicals & optimization',
    wordClass: 'proposed',
    definition: 'Cockpit rail for site-health fixes that "stay in the cockpit" and only graduate into the Insights Engine as proof points. Mockup cockpit.js (ck-tech).',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'Cockpit rail: Keyword position',
    wordClass: 'proposed',
    definition: 'Cockpit rail listing tracked keyword terms for the active client. Mockup cockpit.js (ck-kw).',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'Cockpit rail: Content in flight',
    wordClass: 'proposed',
    definition: 'Cockpit rail tracking content from Recommendation → published. Mockup cockpit.js (co-flight).',
    resolvingTicket: 'reconcile-P2',
  },
  {
    term: 'promote to strategy signal',
    wordClass: 'proposed',
    definition: 'Operator action turning a promotable client request into a "backing move" in the Insights Engine, with a projected outcome. Mockup requests.js.',
    resolvingTicket: 'reconcile-P2',
  },
];

export const LEXICON: readonly LexiconEntry[] = [
  ...CANONICAL,
  ...EXTERNALLY_MIRRORED,
  ...HISTORICAL,
  ...PROPOSED,
];

// ── Duplicate-exported-name allowlist (30 verified collisions) ───────────────
// Census: `grep -rhnE '^export (type|interface) NAME' shared/types server` → 30
// names each declared in exactly 2 files. Verified 2026-07-01 against the code
// (the inventories JSON is the map; the grep is the territory).

const ANALYTICS_MIRROR = 'server/google-analytics.ts + server/search-console.ts ↔ shared/types/analytics.ts';
const ANALYTICS_MIRROR_RATIONALE =
  'Server data-fetcher shape mirrored into shared/types for the client. The 18-name GA4/GSC + PerformanceTrend block is intentionally duplicated by design; consolidating is a separate ticket with its own read-path risk (audit risk #3).';

export const DUPLICATE_NAME_ALLOWLIST: readonly DuplicateNameAllowEntry[] = [
  // ── Deliverable* — resolved by R2 (rename to BrandDeliverable*) ──
  {
    name: 'DeliverableType',
    files: ['shared/types/brand-engine.ts', 'shared/types/client-deliverable.ts'],
    resolvingTicket: 'R2',
    rationale:
      'brand-engine (brand-artifact context) collides with the client-deliverable send-to-client spine. R2 renames the brand-engine pair to BrandDeliverableType and burns this entry off the allowlist. Barrel exports brand-engine but NOT client-deliverable, so barrel importers silently get the brand shape (core rationale for the name-collision rule).',
  },
  {
    name: 'DeliverableStatus',
    files: ['shared/types/brand-engine.ts', 'shared/types/client-deliverable.ts'],
    resolvingTicket: 'R2',
    rationale: 'See DeliverableType. R2 renames the brand-engine pair to BrandDeliverableStatus.',
  },
  // ── GA4/GSC analytics mirror block (18) — permanent by design ──
  { name: 'GA4Overview', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4OrganicOverview', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4Event', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4EventTrend', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4EventPageBreakdown', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4DailyTrend', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4DeviceBreakdown', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4CountryBreakdown', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4NewVsReturning', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4ConversionSummary', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4LandingPage', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4TopPage', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'GA4TopSource', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'SearchQuery', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'SearchPage', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'SearchOverview', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'SearchTypeBreakdown', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  { name: 'PerformanceTrend', files: [ANALYTICS_MIRROR], resolvingTicket: 'permanent', rationale: ANALYTICS_MIRROR_RATIONALE },
  // ── Other shared↔server twins — permanent mirror pairs ──
  {
    name: 'ROIData',
    files: ['server/roi.ts', 'shared/types/roi.ts'],
    resolvingTicket: 'permanent',
    rationale: 'ROI computation shape (server) mirrored into shared/types for client rendering.',
  },
  {
    name: 'PageROI',
    files: ['server/roi.ts', 'shared/types/roi.ts'],
    resolvingTicket: 'permanent',
    rationale: 'See ROIData — the same server↔shared ROI mirror pair.',
  },
  {
    name: 'ContentItemROI',
    files: ['server/roi.ts', 'shared/types/roi.ts'],
    resolvingTicket: 'permanent',
    rationale: 'See ROIData — the same server↔shared ROI mirror pair.',
  },
  {
    name: 'BackgroundJobStatus',
    files: ['server/state-machines.ts', 'shared/types/background-jobs.ts'],
    resolvingTicket: 'permanent',
    rationale: 'The state-machine transition-map status type mirrors the shared background-job status union; both are value-equivalent by design.',
  },
  {
    name: 'ActivityEntry',
    files: ['server/activity-log.ts', 'shared/types/diagnostics.ts'],
    resolvingTicket: 'permanent',
    rationale: 'activity-log ActivityEntry vs the diagnostics view-model ActivityEntry are distinct concepts that happen to share a name.',
  },
  // ── Server-internal near-duplicate pairs — permanent ──
  {
    name: 'Severity',
    files: ['server/audit-page.ts', 'server/sales-audit.ts'],
    resolvingTicket: 'permanent',
    rationale: 'Two audit contexts (page audit vs sales audit) each own a local Severity union.',
  },
  {
    name: 'CheckCategory',
    files: ['server/audit-page.ts', 'server/sales-audit.ts'],
    resolvingTicket: 'permanent',
    rationale: 'See Severity — page vs sales audit local check-category unions.',
  },
  {
    name: 'KeywordStrategyKeywordPool',
    files: ['server/keyword-strategy-universe.ts', 'server/keyword-strategy-synthesis/types.ts'],
    resolvingTicket: 'permanent',
    rationale: 'Universe vs synthesis stages of keyword strategy each declare a local pool shape.',
  },
  {
    name: 'Annotation',
    files: ['server/annotations.ts', 'server/analytics-annotations.ts'],
    resolvingTicket: 'permanent',
    rationale: 'Generic annotations store vs analytics-chart annotations store; distinct concepts, shared name.',
  },
  // ── Shared-internal — permanent ──
  {
    name: 'KeywordCandidate',
    files: ['shared/types/content.ts', 'shared/types/keyword-universe.ts'],
    resolvingTicket: 'permanent',
    rationale: 'Content-planning keyword candidate vs keyword-universe candidate; distinct shapes, shared name.',
  },
];
