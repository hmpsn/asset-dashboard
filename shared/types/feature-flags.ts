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

  // Intelligence Phase 2 — Event Bridges (all default OFF, individually toggleable)
  'bridge-outcome-reweight': false,         // #1: recordOutcome → reweight insight scores
  'bridge-decay-suggested-brief': false,    // #2: content decay → suggested brief
  'bridge-strategy-invalidate': false,      // #3: strategy updated → invalidate intelligence cache
  'bridge-insight-to-action': false,        // #4: insight resolved → tracked action (already exists in routes/insights.ts)
  'bridge-page-analysis-invalidate': false, // #5: page analysis → clear caches
  'bridge-action-auto-resolve': false,      // #7: recordAction → auto-resolve related insights
  'bridge-content-to-insight': false,       // #8: content published → content staleness insight (Phase 3)
  'bridge-schema-to-insight': false,        // #9: schema validation → schema health insight (Phase 3)
  'bridge-anomaly-boost': false,            // #10: anomaly → boost insight severity
  'bridge-settings-cascade': false,         // #11: workspace settings → cascade invalidation
  'bridge-audit-page-health': false,        // #12: audit → page_health insights
  'bridge-action-annotation': false,        // #13: recordAction → create annotation
  'bridge-annotation-to-insight': false,    // #14: annotation created → insight correlation (Phase 3)
  'bridge-audit-site-health': false,        // #15: audit → site_health insights
  'bridge-audit-auto-resolve': false,       // IG-4: auto-resolve audit_finding insights on clean audit
  'bridge-client-signal': false,            // #16: client feedback → signal insights (Phase 3)
  // Platform Intelligence Enhancements
  'smart-placeholders': false,       // System-wide smart placeholder hook (admin chips + prefill, client ghost text)
  'client-brand-section': false,     // Brand tab in client portal (business profile + brand positioning)
  'seo-editor-unified': false,       // Merged static+CMS SEO editor with collection filtering
  // Deep Diagnostics
  'deep-diagnostics': false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
