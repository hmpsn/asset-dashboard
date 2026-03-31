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
  'outcome-adaptive-pipeline': false,
  'outcome-playbooks': false,
  'outcome-predictive': false,

  // Unified Workspace Intelligence
  'intelligence-shadow-mode': false,

  // Event bridges (Phase 2 — all dark-launched, enable per bridge)
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
  'bridge-client-signal': false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
