/**
 * Feature flags — controls which features are visible in production.
 *
 * Default value = false (dark-launched). Override per environment via env vars:
 *   Server: FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *   Frontend: VITE_FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *
 * Example: to enable 'national-serp-tracking' in production, set:
 *   FEATURE_NATIONAL_SERP_TRACKING=true  (server)
 *   VITE_FEATURE_NATIONAL_SERP_TRACKING=true  (Vite build)
 */
export const FEATURE_FLAGS = {
  // MCP deliverable generation program. Reserved in P0 so the rollout contract exists before
  // any paid-run start gate or product UI is wired. Correctness, authorization, CAS, and failure
  // truth remain unflagged; these flags will gate only paid generation starts in their owner phases.
  'content-matrix-generation': false,
  'brand-deliverable-generation': false,

  // Client Insights Briefing (5-phase feature)
  // NOTE: the CLIENT magazine overview variant (InsightsBriefingPage + sub-components)
  // was removed (2026-06-20). These flags are RETAINED because the SERVER briefing
  // pipeline they gate (briefing-cron, briefing routes, admin BriefingReviewQueue) is
  // shared infrastructure: it feeds the intelligence ClientSignalsSlice, the public-portal
  // projection, and strategy-issue-cron (The Issue). See controller-review note in the
  // teardown PR before retiring these flags or the server briefing system.
  'client-briefing-v2': false,
  // Phase 2.5e — Premium-only AI polish (hero-headline punch + weekly opener).
  'client-briefing-v2-ai-polish': false,
  // R2-B: Agency-at-work transparency feed (live jobs + recent activity with narrative labels).
  'client-work-feed': false,

  // Keyword Hub (Wave 4). The `keyword-hub` umbrella flag was RETIRED at the Phase C
  // cutover (2026-06-11): the Hub is now the only keyword surface (KCC + Rank Tracker
  // deleted, seo-ranks redirected), so no kill-switch remains. The keyword universe
  // coverage overhaul (`keyword-universe-full`) and geo-targeting (`geo-targeting`) were
  // retired in flag-sunset Wave 2b (2026-07-02): both were globally ON in prod, so their
  // gates are now unconditional (byte-identical behavior, dead OFF-branch code deleted).

  // SEO Decision Engine P6: national-serp-tracking — first PAID Group C phase. Adds a true
  // advanced-SERP rank + SERP-feature (AI Overview / featured snippet) time series per tracked
  // keyword (serp_snapshots), an AI-Overview citation badge in the keyword drawer, and the
  // serp_feature_opportunity insight. Growth+Premium only; budget observe-only; no backfill.
  // OFF = no national-SERP fetch, no new UI, no insight (byte-identical to today).
  'national-serp-tracking': false,

  // SEO Decision Engine P7: local-gbp — gates the PAID half of the GBP + reviews local layer:
  // business_listings_search fetch, the local-gbp-refresh job/route, business_listing_snapshots,
  // the GBP/reviews admin panel, and the review-gap / GBP-completeness recommendations. Growth+
  // only; budget observe-only. OFF = byte-identical PAID surface. (The FREE half — local_pack
  // rating extraction — ships UNFLAGGED, P3 precedent.)
  'local-gbp': false,

  // GBP OAuth Phase 2A — first-party Google Business Profile connection + account/location
  // mapping. Separate from `local-gbp`, which remains the DataForSEO aggregate competitor/
  // review benchmark layer. OFF = no authenticated GBP connection UI.
  'gbp-auth-connection': false,

  // GBP OAuth Phase 2B — authenticated review sync + per-location read model. Separate from
  // `local-gbp` aggregate competitor benchmarks and from Phase 2C reply publishing.
  // OFF = no raw authenticated review sync/read UI.
  'gbp-auth-reviews': false,

  // GBP OAuth Phase 2C — review response drafting, explicit approval, and Google reply publishing.
  // Separate from authenticated review sync; OFF = no draft/reply workflow and no Google writes.
  'gbp-review-responses': false,

  // SEO Decision Engine P8 (FINAL): ai-visibility — the LLM-citation measurement layer. Reads
  // DataForSEO's LLM-mentions database for the client's domain → an AI-visibility KPI (share-of-
  // voice vs co-mentioned competitors + mention volume + before/after trend + source domains LLMs
  // cite) on the admin panel. KPI-only (no new rec/insight). Growth+; budget observe-only.
  // Retired in flag-sunset Wave 2b (2026-07-02): was globally ON in prod, so the fetch/snapshot/UI
  // are now unconditional (byte-identical behavior, dead OFF-branch code deleted).

  // Strategy v2 "SEO command center" — decision-first IA (Orient → Act → Evidence) + interior
  // tabs. Dark-launches the rebuilt admin Strategy page; replaces the retired decision-bands
  // layout. OFF = the legacy sequential layout, byte-identical.
  // See docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md.
  'strategy-command-center': false,
  // Reconcile R4-PR1 — deliverable divergence sweep child flag. Dark-launches the READ-ONLY
  // runDeliverableDivergenceSweep cron pass that compares each rec's clientStatus against its
  // recommendation:<id> deliverable mirror and reports pairs that DISAGREE (the two named
  // divergence-by-construction paths). OFF = no sweep. It mutates NOTHING — reporting only.
  'strategy-divergence-sweep': false,
  // Strategy redesign (child flags under strategy-command-center) — declared once in the P2
  // pre-commit, activated in later phases. P3 activates managed-set; P4 activates the other two.
  // Strategy redesign — managed keyword working set (add/remove/keep/replenish). Activated P3.
  'strategy-keywords-managed-set': false,
  // Strategy redesign — competitor RecType send-to-client. Activated P4.
  'strategy-competitor-send': false,
  // Strategy redesign — fold Intelligence Signals into the cockpit as real recs. Activated P4.
  'strategy-signal-fold': false,
  // The Issue — system-drafted curated POV cockpit (admin) + evergreen content-led V2 client
  // feed. Master flag for the reimagined Strategy surface; composes with strategy-command-center
  // (theIssueEnabled = commandCenterEnabled && this). OFF = the current command-center cockpit,
  // byte-identical. See docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md.
  'strategy-the-issue': false,
  // The Issue — child flag gating the trust-ladder AUTO-SEND leg (per-archetype auto-send during the
  // weekly cron). OFF by default and dark-launched: the audit found auto-send fired in the same tick
  // that rings the operator doorbell (no review window). With this OFF, the cron still pushes + rings
  // the doorbell but never auto-sends — nothing reaches a client without a manual operator send.
  'strategy-trust-ladder-autosend': false,

  // The Issue (Client) — P0 master flag for the verdict-first trust spine on GA4 estimates.
  // OFF = today's TheIssueClientPage (ring headline, plan-as-hero, collapsed proof) byte-identical.
  // Every new field is additive/optional and unread on the OFF path; computeROI omits outcomeVerdict
  // and toPublicWorkspaceView omits segmentProfile when OFF.
  // See docs/superpowers/specs/2026-06-20-the-issue-client-redesign-design.md.
  'the-issue-client-spine': false,
  // P1a — website-native MEASURED outcome capture: operator-pinned typed GA4 key-events + Webflow
  // form capture (signed webhook) → measured_action provenance. OFF = P0 estimate-only spine,
  // byte-identical (computeROI selects estimate_ga4, the webhook receiver 404s, no reconciliation).
  'the-issue-client-measured-capture': false,
  // P1 children — DECLARED OFF + unread in P0 so the flag family/group is stable. Do not start P1
  // until P0 is merged + green on staging.
  // P1: event-driven SMS/email push + forwardable one-pager export (the return hook).
  'the-issue-client-return-hook': false,
  // P1: "next bets" $-forecast reframe from existing recommendation estimatedGain.
  'the-issue-client-next-bets': false,
  // Client IA v2 — master flag for the verdict-first Overview reframe (P1) → 4-tab shell (P2+).
  // Gates every new IA-v2 render; flag-OFF the client dashboard is byte-identical to today's spine.
  'client-ia-v2': false,

  // UI Rebuild F4 — DS-native admin shell chrome. Additive/pilot-mounted only:
  // App.tsx stays on the legacy shell, and rebuilt surfaces opt into
  // RebuiltAppChrome at their own mount point. OFF = today's admin chrome.
  'ui-rebuild-shell': false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export type FeatureFlagValueSource = 'db' | 'env' | 'default';

/**
 * Source of a flag's resolved value in a PER-WORKSPACE context.
 *
 * Adds a `'workspace'` source on top of the global `FeatureFlagValueSource`
 * chain: when a per-workspace override row exists in
 * `feature_flag_workspace_overrides`, the value came from `'workspace'`;
 * otherwise it falls back to the existing global chain (`'db' | 'env' | 'default'`).
 *
 * Precedence (highest → lowest), mirroring `isFeatureEnabled(flag, workspaceId)`:
 *   workspace → db (global override) → env → default
 */
export type WorkspaceFeatureFlagValueSource = FeatureFlagValueSource | 'workspace';

export const FEATURE_FLAG_ROLLOUT_TARGETS = [
  'staging-validation',
  'internal-operators',
  'pilot-clients',
  'tiered-client-rollout',
  'all-clients',
] as const;

export type FeatureFlagRolloutTarget = (typeof FEATURE_FLAG_ROLLOUT_TARGETS)[number];

export const FEATURE_FLAG_AUDIT_CADENCES = ['weekly', 'monthly', 'quarterly'] as const;

export type FeatureFlagAuditCadence = (typeof FEATURE_FLAG_AUDIT_CADENCES)[number];

export interface FeatureFlagLifecycleMeta {
  owner: string;
  /** 'reserved' = catalog entry pre-registered for an in-progress/deferred feature whose gating
   *  code is not wired yet (intentionally unwired, NOT a phantom flag). The lifecycle verifier
   *  exempts reserved flags from the stale/review-due nag so genuine phantoms stay distinguishable.
   *  Omit (or 'active') for normally-wired flags. Flip to active/omit once the gating code ships. */
  status?: 'active' | 'reserved';
  createdAt: string;
  rolloutTarget: FeatureFlagRolloutTarget;
  removalCondition: string;
  linkedRoadmapItemId: string;
  staleAuditCadence: FeatureFlagAuditCadence;
  lastReviewedAt: string;
}

export const FEATURE_FLAG_GROUP_LABELS = [
  'Platform Intelligence Enhancements',
  'Client Insights Briefing',
  'Keyword Hub',
  'SEO Decision Engine',
  'Strategy',
  'The Issue (Client)',
  'UI Rebuild',
] as const;

export type FeatureFlagGroupLabel = (typeof FEATURE_FLAG_GROUP_LABELS)[number];

export interface FeatureFlagCatalogEntry {
  label: string;
  group: FeatureFlagGroupLabel;
  lifecycle: FeatureFlagLifecycleMeta;
}

const LEGACY_ROADMAP = {
  briefing: 'legacy-client-briefing-v2',
  platformIntelligenceEnhancements: 'legacy-platform-intelligence-enhancements',
} as const;

export const LEGACY_FEATURE_FLAG_ROADMAP_IDS = Object.values(LEGACY_ROADMAP) as readonly string[];

const REVIEWED_AT = '2026-05-15';

export const FEATURE_FLAG_CATALOG: Record<FeatureFlagKey, FeatureFlagCatalogEntry> = {
  'content-matrix-generation': {
    label: 'Content matrix — grounded page-set generation',
    group: 'Platform Intelligence Enhancements',
    lifecycle: {
      owner: 'content-pipeline',
      status: 'reserved',
      createdAt: '2026-07-13',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Re-audit by 2026-08-03; if the paid matrix-run start gate is still unwired, remove the reservation. Once active, retire after the matrix generation workflow is staging-validated and the guarded path is the supported default.',
      linkedRoadmapItemId: 'mcp-content-matrix-generation',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-07-13',
    },
  },
  'brand-deliverable-generation': {
    label: 'Brand intake — reviewed deliverable generation',
    group: 'Platform Intelligence Enhancements',
    lifecycle: {
      owner: 'brand-engine',
      status: 'reserved',
      createdAt: '2026-07-13',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Re-audit by 2026-08-03; if the paid brand-run start gate is still unwired, remove the reservation. Once active, retire after the brand generation workflow is staging-validated and the guarded path is the supported default.',
      linkedRoadmapItemId: 'mcp-brand-deliverable-generation',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-07-13',
    },
  },
  'client-briefing-v2': {
    label: 'Client insights briefing — v2 layout',
    group: 'Client Insights Briefing',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-28',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once briefing v2 becomes the only supported overview experience.',
      linkedRoadmapItemId: LEGACY_ROADMAP.briefing,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'client-briefing-v2-ai-polish': {
    label: 'Client briefing — AI headline polish (premium only)',
    group: 'Client Insights Briefing',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-05-10',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once AI polish is production-ready as default for premium plans without fallback logic.',
      linkedRoadmapItemId: LEGACY_ROADMAP.briefing,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'client-work-feed': {
    label: 'Client dashboard — agency-at-work transparency feed',
    group: 'Client Insights Briefing',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-12',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once agency work feed is validated on staging and shipped as default client overview experience.',
      linkedRoadmapItemId: 'cda-sc5-work-feed',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-12',
    },
  },
  'national-serp-tracking': {
    label: 'National SERP rank tracking — keyword position + SERP features in target market',
    group: 'SEO Decision Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-24',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once national SERP snapshots + serp_feature_opportunity insights are validated on staging and per-workspace cost is acceptable; the flag is then removed and the refresh runs for all Growth+ workspaces.',
      linkedRoadmapItemId: 'seo-engine-p6-national-serp-rank-ai-overview',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-24',
    },
  },
  'local-gbp': {
    label: 'Local GBP + reviews — profile health + review-gap vs local competitors',
    group: 'SEO Decision Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-24',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once business_listings GBP + review snapshots and review-gap/GBP-completeness recommendations are validated on staging and per-workspace cost is acceptable; the flag is then removed and the refresh runs for all Growth+ workspaces.',
      linkedRoadmapItemId: 'seo-engine-p7-gbp-reviews-local-layer',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-24',
    },
  },
  'gbp-auth-connection': {
    label: 'Google Business Profile — authenticated connection + location mapping',
    group: 'SEO Decision Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-29',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once authenticated GBP OAuth, discovery, and workspace-location mapping are validated on staging; then remove the flag before review sync phases depend on it.',
      linkedRoadmapItemId: 'integrations-gbp-direct-oauth',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-29',
    },
  },
  'gbp-auth-reviews': {
    label: 'Google Business Profile — authenticated review sync',
    group: 'SEO Decision Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-29',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once authenticated GBP review sync and per-location read models are validated on staging with Google API approval; then remove before Phase 2C reply workflows depend on it.',
      linkedRoadmapItemId: 'gbp-reviews-read-model-phase-2b',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-29',
    },
  },
  'gbp-review-responses': {
    label: 'Google Business Profile — review response approval + publishing',
    group: 'SEO Decision Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-29',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once reply drafting, client/admin approval, and Google reply publishing are validated on staging with Google API approval; then remove after authenticated GBP workflows are default-on.',
      linkedRoadmapItemId: 'gbp-review-response-approval-phase-2c',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-29',
    },
  },
  'strategy-command-center': {
    label: 'Strategy v2 — SEO command center (Orient/Act/Evidence + interior tabs)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-17',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the v2 command-center IA is validated on staging and becomes the default; the legacy sequential Strategy layout is then deleted.',
      linkedRoadmapItemId: 'strategy-redesign-v2-command-center',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-17',
    },
  },
  'strategy-divergence-sweep': {
    label: 'Reconcile R4 — rec↔deliverable divergence sweep (read-only report cron)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      // Historical alignment note: this flag was reviewed against the 2026-06-29 lifecycle anchor.
      // The lifecycle-meaningful field is the removalCondition ("Re-audit by 2026-10-02"), which is
      // unaffected by the slightly earlier createdAt.
      createdAt: '2026-06-29',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after the R4-PR2 DB trigger makes struck≠completed + rec↔mirror lockstep UNbypassable AND a full staging soak shows the sweep reports zero divergent pairs; the read-only sweep then runs unconditionally in the 24h outcome tick (or is retired once the trigger guarantees zero drift). Re-audit by 2026-10-02.',
      linkedRoadmapItemId: 'strategy-v3-curation-cockpit',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-29',
    },
  },
  'strategy-keywords-managed-set': {
    label: 'Strategy redesign — managed keyword working set (add/remove/keep/replenish)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the dedicated strategy_keyword_set table, reconciler, and managed-set UI are validated on staging.',
      linkedRoadmapItemId: 'strategy-redesign-phase-3-managed-set',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-competitor-send': {
    label: 'Strategy redesign — competitor RecType send-to-client (Phase 4)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once competitor client renderer + send spine are validated on staging.',
      linkedRoadmapItemId: 'strategy-redesign-phase-4-competitor-send',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-signal-fold': {
    label: 'Strategy redesign — fold Intelligence Signals into cockpit as real recs at gen time (Phase 4)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once mintSignalRecs + carry-over perf audit are validated on staging and the standalone IntelligenceSignals card is deleted.',
      linkedRoadmapItemId: 'strategy-redesign-phase-4-signal-fold',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-the-issue': {
    label: 'The Issue — curated POV cockpit + evergreen V2 client feed',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the Issue cockpit + client feed + closed loop are validated on staging; the prior command-center cockpit layout is then retired.',
      linkedRoadmapItemId: 'strategy-the-issue',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-trust-ladder-autosend': {
    label: 'The Issue — trust-ladder auto-send (dark-launched OFF)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Enable per-workspace only after a decoupled-tick auto-send with an operator veto/review window ships; until then the weekly cron never auto-sends (manual operator send only).',
      linkedRoadmapItemId: 'strategy-the-issue',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'the-issue-client-spine': {
    label: 'The Issue (Client) — verdict-first trust spine (P0, GA4 estimates)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-20',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Promote to default once the verdict-first spine is validated with pilot clients on staging; the legacy ring-headline / plan-as-hero TheIssueClientPage layout is then deleted.',
      linkedRoadmapItemId: 'the-issue-client-redesign-p0',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-20',
    },
  },
  'the-issue-client-measured-capture': {
    label: 'The Issue (Client) — website-native measured outcome capture (P1a, measured_action)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-20',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Promote once GA4 measured-action selection + Webflow form-capture named-lead path is validated with pilot clients on staging.',
      linkedRoadmapItemId: 'the-issue-client-redesign-p1a-measured-capture',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-20',
    },
  },
  'the-issue-client-return-hook': {
    label: 'The Issue (Client) — push/export return hook (P1)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-20',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the event-driven push + forwardable one-pager export delivery cost is validated on staging.',
      linkedRoadmapItemId: 'the-issue-client-redesign-p1-return-hook',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-20',
    },
  },
  'the-issue-client-next-bets': {
    label: 'The Issue (Client) — next-bets $-forecast (P1)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-20',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Promote to default once the next-bets $-forecast reframe from recommendation estimatedGain is validated with pilot clients on staging.',
      linkedRoadmapItemId: 'the-issue-client-redesign-p1-next-bets',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-29',
    },
  },
  'client-ia-v2': {
    label: 'Client dashboard — IA v2 (verdict-first Overview reframe → 4-tab shell)',
    group: 'The Issue (Client)',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-20',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once client IA v2 (P1 Overview reframe through P4) is validated on staging and shipped as the default client dashboard.',
      linkedRoadmapItemId: 'client-dashboard-ia-restructure',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-20',
    },
  },
  'ui-rebuild-shell': {
    label: 'UI rebuild — DS-native admin shell chrome',
    group: 'UI Rebuild',
    lifecycle: {
      owner: 'ui-platform',
      createdAt: '2026-07-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Retire once the rebuilt admin shell ships unflagged after the Keywords pilot and Phase A admin fan-out validate the shell chrome.',
      linkedRoadmapItemId: 'ui-rebuild-f4-shell',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-07-05',
    },
  },
};

export const FEATURE_FLAG_GROUPS: Array<{ label: FeatureFlagGroupLabel; keys: FeatureFlagKey[] }> = [
  {
    label: 'Platform Intelligence Enhancements',
    keys: ['content-matrix-generation', 'brand-deliverable-generation'],
  },
  {
    label: 'Client Insights Briefing',
    keys: ['client-briefing-v2', 'client-briefing-v2-ai-polish', 'client-work-feed'],
  },
  {
    label: 'Keyword Hub',
    keys: [],
  },
  {
    label: 'SEO Decision Engine',
    keys: ['national-serp-tracking', 'local-gbp', 'gbp-auth-connection', 'gbp-auth-reviews', 'gbp-review-responses'],
  },
  {
    label: 'Strategy',
    keys: ['strategy-command-center', 'strategy-divergence-sweep', 'strategy-keywords-managed-set', 'strategy-competitor-send', 'strategy-signal-fold', 'strategy-the-issue', 'strategy-trust-ladder-autosend'],
  },
  {
    label: 'The Issue (Client)',
    keys: ['the-issue-client-spine', 'the-issue-client-measured-capture', 'the-issue-client-return-hook', 'the-issue-client-next-bets', 'client-ia-v2'],
  },
  {
    label: 'UI Rebuild',
    keys: ['ui-rebuild-shell'],
  },
];

export interface FeatureFlagAdminMeta {
  key: FeatureFlagKey;
  enabled: boolean;
  source: FeatureFlagValueSource;
  default: boolean;
  label: string;
  group: FeatureFlagGroupLabel;
  lifecycle: FeatureFlagLifecycleMeta;
}

/**
 * Per-workspace flag metadata for the per-workspace admin override UI.
 *
 * Like `FeatureFlagAdminMeta`, but the resolution is workspace-scoped:
 *   - `enabled` is the value resolved for THIS workspace
 *     (`isFeatureEnabled(flag, workspaceId)`).
 *   - `source` is `'workspace'` when a per-workspace override row exists, else
 *     the global chain (`'db' | 'env' | 'default'`).
 *   - `inheritedEnabled` is the value the workspace WOULD resolve to with no
 *     per-workspace override (`isFeatureEnabled(flag)` — the global chain),
 *     i.e. what "clear override" reverts to. Always present so the UI can show
 *     what inherited/global state a clear would fall back to.
 *   - `inheritedSource` is the source of `inheritedEnabled` (the global chain
 *     source: `'db' | 'env' | 'default'`).
 */
export interface WorkspaceFeatureFlagMeta {
  key: FeatureFlagKey;
  enabled: boolean;
  source: WorkspaceFeatureFlagValueSource;
  /** Resolved value with NO per-workspace override (global → env → default). What "clear" reverts to. */
  inheritedEnabled: boolean;
  /** Source of `inheritedEnabled` — always a global-chain source (never 'workspace'). */
  inheritedSource: FeatureFlagValueSource;
  /** The hardcoded compile-time default in FEATURE_FLAGS. */
  default: boolean;
  label: string;
  group: FeatureFlagGroupLabel;
  lifecycle: FeatureFlagLifecycleMeta;
}

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

function assertFeatureFlagGroupingConsistency(): void {
  const seen = new Set<FeatureFlagKey>();

  for (const group of FEATURE_FLAG_GROUPS) {
    for (const key of group.keys) {
      if (!(key in FEATURE_FLAG_CATALOG)) {
        throw new Error(`feature-flag grouping references unknown key: ${key}`);
      }
      const expectedGroup = FEATURE_FLAG_CATALOG[key].group;
      if (expectedGroup !== group.label) {
        throw new Error(`feature-flag grouping mismatch for ${key}: group list=${group.label}, catalog=${expectedGroup}`);
      }
      if (seen.has(key)) {
        throw new Error(`feature-flag grouping duplicate key: ${key}`);
      }
      seen.add(key);
    }
  }

  for (const key of FEATURE_FLAG_KEYS) {
    if (!seen.has(key)) {
      throw new Error(`feature-flag grouping missing key: ${key}`);
    }
  }
}

assertFeatureFlagGroupingConsistency();
