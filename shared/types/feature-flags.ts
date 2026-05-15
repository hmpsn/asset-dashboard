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

  // Outcome Intelligence Engine
  'outcome-tracking': false,
  'outcome-dashboard': false,
  'outcome-ai-injection': false,
  'outcome-client-reporting': false,
  'outcome-external-detection': false,
  'outcome-playbooks': false,
  'outcome-predictive': false,

  // Unified Workspace Intelligence
  'intelligence-shadow-mode': false,

  // Intelligence Phase 2 — Event Bridges (all default OFF, individually toggleable)
  'bridge-outcome-reweight': false,
  'bridge-decay-suggested-brief': false,
  'bridge-strategy-invalidate': false,
  'bridge-insight-to-action': false,
  'bridge-page-analysis-invalidate': false,
  'bridge-action-auto-resolve': false,
  'bridge-content-to-insight': false,
  'bridge-schema-to-insight': false,
  'bridge-anomaly-boost': false,
  'bridge-settings-cascade': false,
  'bridge-audit-page-health': false,
  'bridge-action-annotation': false,
  'bridge-annotation-to-insight': false,
  'bridge-audit-site-health': false,
  'bridge-audit-auto-resolve': false,
  'bridge-briefing-candidate-refresh': false,
  'bridge-client-signal': false,

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

  // Client IA Redesign Phase 1 (PRs 1.2 + 1.3)
  'new-inbox-ia': false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export type FeatureFlagValueSource = 'db' | 'env' | 'default';

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
  'Outcome Intelligence Engine',
  'Copy & Brand Engine',
  'Self-Service Onboarding',
  'Team & Collaboration',
  'White-Label',
  'Workspace Intelligence Bridges',
  'Deep Diagnostics',
  'Platform Intelligence Enhancements',
  'Client Insights Briefing',
  'Client IA Redesign',
  'Schema AI',
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
  intelligence: 'legacy-workspace-intelligence',
  briefing: 'legacy-client-briefing-v2',
  deepDiagnostics: 'legacy-deep-diagnostics',
  schema: 'legacy-schema-ai',
  inboxIa: 'legacy-client-inbox-ia',
  platformIntelligenceEnhancements: 'legacy-platform-intelligence-enhancements',
} as const;

export const LEGACY_FEATURE_FLAG_ROADMAP_IDS = Object.values(LEGACY_ROADMAP) as readonly string[];

const REVIEWED_AT = '2026-05-15';

export const FEATURE_FLAG_CATALOG: Record<FeatureFlagKey, FeatureFlagCatalogEntry> = {
  'outcome-tracking': {
    label: 'Action tracking & measurement',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-03-10',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove after outcome tracking is default-on for all supported tiers for 2 releases.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-dashboard': {
    label: 'Outcomes admin dashboard',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-03-10',
      rolloutTarget: 'internal-operators',
      removalCondition: 'Remove once dashboard behaviors are stable and no rollback path depends on this gate.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-playbooks': {
    label: 'Playbook pattern detection',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-03-20',
      rolloutTarget: 'internal-operators',
      removalCondition: 'Remove after playbook scoring quality and DB migrations are fully settled.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-external-detection': {
    label: 'External change detection (weekly)',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-03-22',
      rolloutTarget: 'internal-operators',
      removalCondition: 'Remove when anomaly ingestion is production-hardened and independent kill-switch is unnecessary.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-ai-injection': {
    label: 'Inject outcomes into AI context',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-03-25',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove after AI prompts consistently consume outcomes context and no prompt rollback relies on the gate.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-client-reporting': {
    label: 'Client-facing outcome reporting',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-03-29',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once all supported client plans rely on the new reporting path by default.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'monthly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'outcome-predictive': {
    label: 'Predictive scoring (future)',
    group: 'Outcome Intelligence Engine',
    lifecycle: {
      owner: 'outcomes-roi',
      createdAt: '2026-04-02',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove if predictive scoring does not move to active implementation by the next architecture cycle.',
      linkedRoadmapItemId: LEGACY_ROADMAP.outcome,
      staleAuditCadence: 'quarterly',
      lastReviewedAt: REVIEWED_AT,
    },
  },

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

  'intelligence-shadow-mode': {
    label: 'Shadow-mode comparison logging',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-03-14',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after shadow/intelligence parity checks are complete and no longer needed for safe rollout.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-outcome-reweight': {
    label: '#1: Outcome → reweight insight scores',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #1 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-decay-suggested-brief': {
    label: '#2: Content decay → suggested brief',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #2 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-strategy-invalidate': {
    label: '#3: Strategy update → cache invalidation',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #3 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-insight-to-action': {
    label: '#4: Insight resolved → tracked action',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #4 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-page-analysis-invalidate': {
    label: '#5: Page analysis → cache invalidation',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #5 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-action-auto-resolve': {
    label: '#7: Action recorded → auto-resolve insights',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #7 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-content-to-insight': {
    label: '#8: Content published → staleness insight',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #8 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-schema-to-insight': {
    label: '#9: Schema validation → schema health insight',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'schema',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #9 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-anomaly-boost': {
    label: '#10: Anomaly → boost insight severity',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #10 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-settings-cascade': {
    label: '#11: Settings change → cascade invalidation',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'platform-foundation',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #11 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-audit-page-health': {
    label: '#12: Audit → page health insights',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'seo-health',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #12 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-action-annotation': {
    label: '#13: Action recorded → analytics annotation',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #13 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-annotation-to-insight': {
    label: '#14: Annotation → insight correlation',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #14 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-audit-site-health': {
    label: '#15: Audit → site health insight',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'seo-health',
      createdAt: '2026-04-05',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #15 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-audit-auto-resolve': {
    label: 'IG-4: Auto-resolve audit_finding insights on clean audit',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'seo-health',
      createdAt: '2026-04-12',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once IG-4 behavior is validated and no isolated switch is needed.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-briefing-candidate-refresh': {
    label: 'CB-1: Audit complete → briefing candidate-pool freshness',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'content-pipeline',
      createdAt: '2026-04-12',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once CB-1 behavior is validated and no isolated switch is needed.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
      lastReviewedAt: REVIEWED_AT,
    },
  },
  'bridge-client-signal': {
    label: '#16: Client feedback → signal insights',
    group: 'Workspace Intelligence Bridges',
    lifecycle: {
      owner: 'inbox',
      createdAt: '2026-04-12',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove once bridge execution #16 is validated in production and no independent switch is required.',
      linkedRoadmapItemId: LEGACY_ROADMAP.intelligence,
      staleAuditCadence: 'weekly',
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

  'new-inbox-ia': {
    label: 'New 3-section inbox layout (Decisions / Reviews / Conversations)',
    group: 'Client IA Redesign',
    lifecycle: {
      owner: 'inbox',
      createdAt: '2026-05-08',
      rolloutTarget: 'tiered-client-rollout',
      removalCondition: 'Remove once new inbox IA is the only maintained client inbox layout.',
      linkedRoadmapItemId: LEGACY_ROADMAP.inboxIa,
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
};

export const FEATURE_FLAG_GROUPS: Array<{ label: FeatureFlagGroupLabel; keys: FeatureFlagKey[] }> = [
  {
    label: 'Outcome Intelligence Engine',
    keys: [
      'outcome-tracking',
      'outcome-dashboard',
      'outcome-playbooks',
      'outcome-external-detection',
      'outcome-ai-injection',
      'outcome-client-reporting',
      'outcome-predictive',
    ],
  },
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
    label: 'Workspace Intelligence Bridges',
    keys: [
      'intelligence-shadow-mode',
      'bridge-outcome-reweight',
      'bridge-decay-suggested-brief',
      'bridge-strategy-invalidate',
      'bridge-insight-to-action',
      'bridge-page-analysis-invalidate',
      'bridge-action-auto-resolve',
      'bridge-content-to-insight',
      'bridge-schema-to-insight',
      'bridge-anomaly-boost',
      'bridge-settings-cascade',
      'bridge-audit-page-health',
      'bridge-action-annotation',
      'bridge-annotation-to-insight',
      'bridge-audit-site-health',
      'bridge-audit-auto-resolve',
      'bridge-briefing-candidate-refresh',
      'bridge-client-signal',
    ],
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
    label: 'Client IA Redesign',
    keys: ['new-inbox-ia'],
  },
  {
    label: 'Schema AI',
    keys: ['schema-ai-element-classifier'],
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
