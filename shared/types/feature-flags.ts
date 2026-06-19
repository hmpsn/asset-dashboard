/**
 * Feature flags — controls which features are visible in production.
 *
 * Default value = false (dark-launched). Override per environment via env vars:
 *   Server: FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *   Frontend: VITE_FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *
 * Example: to enable 'keyword-universe-full' in production, set:
 *   FEATURE_KEYWORD_UNIVERSE_FULL=true  (server)
 *   VITE_FEATURE_KEYWORD_UNIVERSE_FULL=true  (Vite build)
 */
export const FEATURE_FLAGS = {
  // Self-service onboarding
  'self-service-onboarding': false,
  'self-service-gsc-ga4': false,

  // Team & Collaboration
  'team-collaboration': false,

  // White-label
  'white-label': false,

  // Platform Intelligence Enhancements
  'smart-placeholders': false,

  // Client Insights Briefing (5-phase feature)
  'client-briefing-v2': false,
  // Phase 2.5e — Premium-only AI polish (hero-headline punch + weekly opener).
  'client-briefing-v2-ai-polish': false,
  // R2-B: Agency-at-work transparency feed (live jobs + recent activity with narrative labels).
  'client-work-feed': false,

  // Keyword Hub (Wave 4). The `keyword-hub` umbrella flag was RETIRED at the Phase C
  // cutover (2026-06-11): the Hub is now the only keyword surface (KCC + Rank Tracker
  // deleted, seo-ranks redirected), so no kill-switch remains. The two sub-flags below
  // gate independent coverage/scoring overhauls and keep their own removal conditions.
  // Keyword universe overhaul: gates the COVERAGE EXPANSION — remove the row caps,
  // include every GSC-clicked/impressed query (full ranking coverage), keep all
  // not-yet-ranking discovery — behind a flag so old-vs-new is comparable on
  // staging and rollback is one switch. Junk gate + sort + window fixes ship
  // unflagged. OFF = today's capped behavior, byte-identical.
  // See docs/superpowers/plans/2026-06-05-keyword-universe-overhaul.md.
  'keyword-universe-full': false,
  // Keyword Value Scoring: replaces the Hub's crude volume×ease opportunity sort
  // with a value-first, posture-driven keyword value score (commercial intent + CPC
  // + local relevance multiplier). Also gates the content-gap opportunity spine.
  // OFF = byte-identical to today. See docs/superpowers/plans/2026-06-05-keyword-value-scoring.md.
  'keyword-value-scoring': false,

  // Phase 5: automated signal recompute — the daily activity-gated cron + the on-mutation enqueues
  // that refresh analytics insights. OFF = signals refresh only on view (24h-throttled) + the manual
  // "Recompute now" button. Dark-launched so the per-workspace GSC/GA4 cost is watched on staging first.
  'signal-auto-recompute': false,

  // Strategy v2 "SEO command center" — decision-first IA (Orient → Act → Evidence) + interior
  // tabs. Dark-launches the rebuilt admin Strategy page; replaces the retired decision-bands
  // layout. OFF = the legacy sequential layout, byte-identical.
  // See docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md.
  'strategy-command-center': false,
  // Strategy v3 — staleness scan child flag. Dark-launches the runSentRecStalenessScan cron
  // pass (sent-rec "no response 14d" nudges + supersession flags). OFF = no nudge engine.
  'strategy-staleness-scan': false,
  // Strategy v3 — DEFERRED paid-topic monetization spine (generic strategy_addon SKU +
  // rec→cart bridge for keyword/topic rec types). OFF until the roadmap item lands; v3 renders
  // Add-to-plan ONLY where rec.productType already resolves a SKU (decision 1 / spec §2 / §11).
  'strategy-paid-topics': false,
  // Strategy redesign (child flags under strategy-command-center) — declared once in the P2
  // pre-commit, activated in later phases. P3 activates managed-set; P4 activates the other two.
  // Strategy redesign — managed keyword working set (add/remove/keep/replenish). Activated P3.
  'strategy-keywords-managed-set': false,
  // Strategy redesign — competitor RecType send-to-client. Activated P4.
  'strategy-competitor-send': false,
  // Strategy redesign — fold Intelligence Signals into the cockpit as real recs. Activated P4.
  'strategy-signal-fold': false,
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
  createdAt: string;
  rolloutTarget: FeatureFlagRolloutTarget;
  removalCondition: string;
  linkedRoadmapItemId: string;
  staleAuditCadence: FeatureFlagAuditCadence;
  lastReviewedAt: string;
}

export const FEATURE_FLAG_GROUP_LABELS = [
  'Self-Service Onboarding',
  'Team & Collaboration',
  'White-Label',
  'Platform Intelligence Enhancements',
  'Client Insights Briefing',
  'Keyword Hub',
  'Strategy',
] as const;

export type FeatureFlagGroupLabel = (typeof FEATURE_FLAG_GROUP_LABELS)[number];

export interface FeatureFlagCatalogEntry {
  label: string;
  group: FeatureFlagGroupLabel;
  lifecycle: FeatureFlagLifecycleMeta;
}

const LEGACY_ROADMAP = {
  selfServe: 'legacy-self-service-onboarding',
  team: 'legacy-team-collaboration',
  whiteLabel: 'legacy-white-label',
  outcome: 'legacy-outcome-intelligence',
  briefing: 'legacy-client-briefing-v2',
  schema: 'legacy-schema-ai',
  platformIntelligenceEnhancements: 'legacy-platform-intelligence-enhancements',
} as const;

export const LEGACY_FEATURE_FLAG_ROADMAP_IDS = Object.values(LEGACY_ROADMAP) as readonly string[];

const REVIEWED_AT = '2026-05-15';

export const FEATURE_FLAG_CATALOG: Record<FeatureFlagKey, FeatureFlagCatalogEntry> = {
  'self-service-onboarding': {
    label: 'Self-service Webflow onboarding',
    group: 'Self-Service Onboarding',
    lifecycle: {
      owner: 'integrations',
      createdAt: '2026-02-01',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Remove when the self-service onboarding flow is default for all eligible workspaces.',
      linkedRoadmapItemId: LEGACY_ROADMAP.selfServe,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'self-service-gsc-ga4': {
    label: 'Self-service GSC / GA4 connection',
    group: 'Self-Service Onboarding',
    lifecycle: {
      owner: 'integrations',
      createdAt: '2026-02-03',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Remove once self-serve provider connection reliability meets release thresholds for 2 consecutive releases.',
      linkedRoadmapItemId: LEGACY_ROADMAP.selfServe,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

  'team-collaboration': {
    label: 'Team management',
    group: 'Team & Collaboration',
    lifecycle: {
      owner: 'workspace-command-center',
      createdAt: '2026-01-18',
      rolloutTarget: 'internal-operators',
      removalCondition: 'Remove when team collaboration permissions are stable and no staged fallback is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.team,
      staleAuditCadence: 'quarterly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

  'white-label': {
    label: 'White-label domains',
    group: 'White-Label',
    lifecycle: {
      owner: 'billing-monetization',
      createdAt: '2026-01-25',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove when white-label setup is generalized and no compatibility fallback is needed.',
      linkedRoadmapItemId: LEGACY_ROADMAP.whiteLabel,
      staleAuditCadence: 'quarterly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

  'smart-placeholders': {
    label: 'Smart placeholders (admin chips + client ghost text)',
    group: 'Platform Intelligence Enhancements',
    lifecycle: {
      owner: 'platform-foundation',
      createdAt: '2026-05-06',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove when placeholder behavior has no fallback branch and is default-on for all supported paths.',
      linkedRoadmapItemId: LEGACY_ROADMAP.platformIntelligenceEnhancements,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
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
  'keyword-universe-full': {
    label: 'Keyword Universe — full coverage (uncap, all GSC-clicked/impressed + discovery)',
    group: 'Keyword Hub',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-02',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after the full keyword universe (uncapped coverage + junk gate) is validated on staging and becomes the default; the cap-based path is then deleted.',
      linkedRoadmapItemId: 'keyword-universe-overhaul',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-02',
    },
  },
  'keyword-value-scoring': {
    label: 'Keyword Hub — value-first opportunity scoring (commercial intent + CPC + posture-driven local)',
    group: 'Keyword Hub',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-02',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after value-first scoring is validated on staging and becomes the default; the crude computeOpportunityScore Hub path is then deleted.',
      linkedRoadmapItemId: 'keyword-value-scoring',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-02',
    },
  },
  'signal-auto-recompute': {
    label: 'Strategy signals — automated recompute (daily cron + on-mutation)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-17',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the daily-cron + on-mutation provider (GSC/GA4) cost is validated acceptable on staging; the flag is then removed and the recompute paths run unconditionally.',
      linkedRoadmapItemId: 'strategy-redesign-phase-5c-auto-recompute',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-17',
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
  'strategy-staleness-scan': {
    label: 'Strategy v3 — sent-rec staleness scan (nudge + supersession cron)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-17',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the on-read throttle resurface + nudge cron cost is validated on staging; flag removed and the scan runs unconditionally in the 24h outcome tick.',
      linkedRoadmapItemId: 'strategy-v3-curation-cockpit',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-17',
    },
  },
  'strategy-paid-topics': {
    label: 'Strategy v3 — paid-topic monetization spine (DEFERRED roadmap)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-17',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Enable + remove once the generic strategy_addon SKU + rec→cart bridge + keyword/topic product map ship (deferred roadmap item D8). Until then v3 renders Add-to-plan only where rec.productType already resolves.',
      linkedRoadmapItemId: 'strategy-paid-topic-monetization-spine',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-17',
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
};

export const FEATURE_FLAG_GROUPS: Array<{ label: FeatureFlagGroupLabel; keys: FeatureFlagKey[] }> = [
  {
    label: 'Self-Service Onboarding',
    keys: ['self-service-onboarding', 'self-service-gsc-ga4'],
  },
  {
    label: 'Team & Collaboration',
    keys: ['team-collaboration'],
  },
  {
    label: 'White-Label',
    keys: ['white-label'],
  },
  {
    label: 'Platform Intelligence Enhancements',
    keys: ['smart-placeholders'],
  },
  {
    label: 'Client Insights Briefing',
    keys: ['client-briefing-v2', 'client-briefing-v2-ai-polish', 'client-work-feed'],
  },
  {
    label: 'Keyword Hub',
    keys: ['keyword-universe-full', 'keyword-value-scoring'],
  },
  {
    label: 'Strategy',
    keys: ['signal-auto-recompute', 'strategy-command-center', 'strategy-staleness-scan', 'strategy-paid-topics', 'strategy-keywords-managed-set', 'strategy-competitor-send', 'strategy-signal-fold'],
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
