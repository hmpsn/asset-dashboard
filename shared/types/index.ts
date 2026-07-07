// ── Barrel export for shared types ──────────────────────────────

export type * from './workspace.ts';
export type * from './recommendations.ts';
export type * from './requests.ts';
export type * from './content.ts';
export type * from './payments.ts';
export type * from './users.ts';
export type * from './analytics.ts';
export type * from './analytics-contract.ts';
export type * from './roadmap.ts';
export type * from './approvals.ts';
export type * from './schema-plan.ts';
export type * from './insights.ts';
export type * from './intelligence.ts';
export type * from './client-signals.ts';
export type * from './business-priorities.ts';
export * from './keywords.ts';
export type * from './keyword-command-center.ts';
export * from './local-seo.ts';
export type * from './brand-engine.ts';
export type * from './outcome-tracking.ts';
export type * from './copy-pipeline.ts';
export type * from './diagnostics.ts';
export type * from './page-strategy.ts';
export type * from './collaboration-artifact.ts';
export * from './feature-flags.ts';
// Lexicon registry — value exports (LEXICON, DUPLICATE_NAME_ALLOWLIST, LEXICON_WORD_CLASSES)
// need `export *`, not `export type *`. Do NOT add client-deliverable.ts or
// keyword-universe.ts to this barrel — they TS2308-collide on DeliverableStatus/Type
// and KeywordCandidate (see shared/types/lexicon.ts DUPLICATE_NAME_ALLOWLIST).
export * from './lexicon.ts';
export type * from './features.ts';
export type * from './narrative.ts';
export type * from './cms-images.ts';
export type * from './page-join.ts';
export type * from './briefing.ts';
export * from './background-jobs.ts';
export * from './action-catalog.ts';
export * from './analytics-contract.ts';
export type * from './platform-observability.ts';
export type * from './keyword-strategy-ux.ts';
export type * from './usage.ts';
export * from './seo-audit.ts';
