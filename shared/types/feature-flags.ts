/**
 * Feature flags — controls which features are visible in production.
 *
 * Default value = false (dark-launched). Override per environment via env vars:
 *   Server: FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *   Frontend: VITE_FEATURE_<FLAG_NAME_UPPERCASED_WITH_UNDERSCORES>=true
 *
 * Example: to enable 'copy-engine' in production, set:
 *   FEATURE_COPY_ENGINE=true  (server)
 *   VITE_FEATURE_COPY_ENGINE=true  (Vite build)
 */
export const FEATURE_FLAGS = {
  // Copy & Brand Engine (3-phase feature)
  'copy-engine': false,
  'copy-engine-voice': false,
  'copy-engine-pipeline': false,

  // Self-service onboarding
  'self-service-onboarding': false,
  'self-service-gsc-ga4': false,

  // Team & Collaboration
  'team-collaboration': false,

  // White-label
  'white-label': false,

  // Platform Intelligence Enhancements
  'smart-placeholders': false,
  'client-brand-section': false,

  // Client Insights Briefing (5-phase feature)
  'client-briefing-v2': false,
  // Phase 2.5e — Premium-only AI polish (hero-headline punch + weekly opener).
  'client-briefing-v2-ai-polish': false,

  // Deep Diagnostics
  'deep-diagnostics': false,

  // Page-Element Catalog (schema AI extractors)
  'schema-ai-element-classifier': false,

  // Local SEO Visibility
  'local-seo-visibility': false,

  // SEO Generation Quality (multi-phase keyword-strategy + recommendation quality plan).
  // Umbrella kill-switch for the P1–P6 generation-quality work (universe assembler,
  // backfill floor, closed-set prompting, OV-derived tier, orphan-table recs). Dark by
  // default; per-phase sub-features stay flag-gated and roll out per-workspace via the
  // P0 per-workspace flag dimension. See docs/plans/2026-06-02-seo-generation-quality-plan.md.
  'seo-generation-quality': false,
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
  'Copy & Brand Engine',
  'Self-Service Onboarding',
  'Team & Collaboration',
  'White-Label',
  'Deep Diagnostics',
  'Platform Intelligence Enhancements',
  'Client Insights Briefing',
  'Local SEO',
  'Schema AI',
  'SEO Generation Quality',
] as const;

export type FeatureFlagGroupLabel = (typeof FEATURE_FLAG_GROUP_LABELS)[number];

export interface FeatureFlagCatalogEntry {
  label: string;
  group: FeatureFlagGroupLabel;
  lifecycle: FeatureFlagLifecycleMeta;
}

const LEGACY_ROADMAP = {
  copyEngine: 'legacy-copy-engine',
  selfServe: 'legacy-self-service-onboarding',
  team: 'legacy-team-collaboration',
  whiteLabel: 'legacy-white-label',
  outcome: 'legacy-outcome-intelligence',
  briefing: 'legacy-client-briefing-v2',
  deepDiagnostics: 'legacy-deep-diagnostics',
  schema: 'legacy-schema-ai',
  localSeo: 'intel-quality-local-pack-visibility-foundation',
  platformIntelligenceEnhancements: 'legacy-platform-intelligence-enhancements',
} as const;

export const LEGACY_FEATURE_FLAG_ROADMAP_IDS = Object.values(LEGACY_ROADMAP) as readonly string[];

const REVIEWED_AT = '2026-05-15';

export const FEATURE_FLAG_CATALOG: Record<FeatureFlagKey, FeatureFlagCatalogEntry> = {
  'copy-engine': {
    label: 'Copy Engine — core',
    group: 'Copy & Brand Engine',
    lifecycle: {
      owner: 'content-pipeline',
      createdAt: '2026-02-14',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Remove when Copy Engine core is stable and becomes the only production path.',
      linkedRoadmapItemId: LEGACY_ROADMAP.copyEngine,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'copy-engine-voice': {
    label: 'Copy Engine — voice calibration',
    group: 'Copy & Brand Engine',
    lifecycle: {
      owner: 'content-pipeline',
      createdAt: '2026-02-20',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Remove when voice calibration is permanently enabled for eligible workspaces.',
      linkedRoadmapItemId: LEGACY_ROADMAP.copyEngine,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'copy-engine-pipeline': {
    label: 'Copy Engine — pipeline',
    group: 'Copy & Brand Engine',
    lifecycle: {
      owner: 'content-pipeline',
      createdAt: '2026-02-27',
      rolloutTarget: 'pilot-clients',
      removalCondition: 'Remove once pipeline side-effects and rollback paths are fully validated.',
      linkedRoadmapItemId: LEGACY_ROADMAP.copyEngine,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

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

  'deep-diagnostics': {
    label: 'Deep diagnostics mode',
    group: 'Deep Diagnostics',
    lifecycle: {
      owner: 'seo-health',
      createdAt: '2026-04-19',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once deep diagnostics is generally available and rollback path no longer depends on a flag.',
      linkedRoadmapItemId: LEGACY_ROADMAP.deepDiagnostics,
      staleAuditCadence: 'monthly',
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
  'client-brand-section': {
    label: 'Client portal — Brand tab (business profile)',
    group: 'Platform Intelligence Enhancements',
    lifecycle: {
      owner: 'inbox',
      createdAt: '2026-05-06',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove when client Brand tab is default for all eligible workspaces with no split rendering path.',
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
  'local-seo-visibility': {
    label: 'Local SEO visibility',
    group: 'Local SEO',
    lifecycle: {
      owner: 'seo-health',
      createdAt: '2026-05-15',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once local SEO reporting is validated and the admin visibility foundation no longer needs a kill-switch.',
      linkedRoadmapItemId: LEGACY_ROADMAP.localSeo,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'schema-ai-element-classifier': {
    label: 'Schema AI — page-element role classifier',
    group: 'Schema AI',
    lifecycle: {
      owner: 'schema',
      createdAt: '2026-05-11',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once AI classifier quality is stable and schema extraction no longer needs a hard kill-switch.',
      linkedRoadmapItemId: LEGACY_ROADMAP.schema,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

  'seo-generation-quality': {
    label: 'SEO Generation Quality — umbrella (keyword-strategy + recommendation quality)',
    group: 'SEO Generation Quality',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-02',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after the P1–P6 generation-quality phases are validated per-workspace and become the only generation/ranking path (no flag-off legacy fallback).',
      linkedRoadmapItemId: 'seo-genquality-p0-harness',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-02',
    },
  },
};

export const FEATURE_FLAG_GROUPS: Array<{ label: FeatureFlagGroupLabel; keys: FeatureFlagKey[] }> = [
  {
    label: 'Copy & Brand Engine',
    keys: ['copy-engine', 'copy-engine-voice', 'copy-engine-pipeline'],
  },
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
    label: 'Deep Diagnostics',
    keys: ['deep-diagnostics'],
  },
  {
    label: 'Platform Intelligence Enhancements',
    keys: ['smart-placeholders', 'client-brand-section'],
  },
  {
    label: 'Client Insights Briefing',
    keys: ['client-briefing-v2', 'client-briefing-v2-ai-polish'],
  },
  {
    label: 'Local SEO',
    keys: ['local-seo-visibility'],
  },
  {
    label: 'Schema AI',
    keys: ['schema-ai-element-classifier'],
  },
  {
    label: 'SEO Generation Quality',
    keys: ['seo-generation-quality'],
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
