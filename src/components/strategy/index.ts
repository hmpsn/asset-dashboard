export * from './types';

export * from './hooks/useStrategyMetrics';
export * from './hooks/useStrategySettings';
export * from './hooks/useStrategyGeneration';
export * from './hooks/useTrackKeyword';
export * from './hooks/useKeywordFeedback';

export * from './StrategyHeaderActions';
export * from './DecisionQueue';
export * from './RequestedKeywordTriage';
export * from './strategySummaryLine';
export * from './StrategyFeedbackNudge';
export * from './ClientKeywordFeedback';
export * from './StrategySettings';
export * from './StrategyStalenessNudges';
export * from './StrategyEmptyState';
export * from './OrientZone';
export * from './ActQueue';
export * from './StrategyCockpit';
export * from './StrategyRankingsTab';
export * from './StrategyCompetitiveTab';
export * from './ShareBar';
export * from './RankingDistribution';
export * from './SiteTargetKeywords';
export * from './KeywordOpportunities';
export * from './StrategyHowItWorks';
// Act-queue candidate leaves re-homed from the legacy action sections — NOT yet wired into ActQueue
// (zero production importers today; covered only by their own unit tests). The Strategy v2 cutover
// (Phase 0) made the command-center layout the baseline; these stay reserved for the Strategy v3
// cockpit (Phase 2) built behind the kept `strategy-command-center` umbrella flag. Do NOT delete.
// See docs/superpowers/plans/2026-06-18-strategy-v3-curation-cockpit.md.
// (AuthorityAndBacklinks was removed in Phase 5 — the Competitive tab composes BacklinkProfile +
// CompetitiveIntel directly in research order rather than via the merged wrapper.)
export * from './OpportunitiesList';
export * from './DecayingPagesCard';
export * from './LostQueryRecoveryCard';
export * from './CannibalizationTriage';
export * from './NeedsAttentionStrip';
export * from './CurationMeter';
export * from './CurationBulkActionBar';
