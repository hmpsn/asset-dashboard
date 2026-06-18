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
export * from './StrategyStatGrid';
export * from './OrientZone';
export * from './ActQueue';
export * from './StrategyRankingsTab';
export * from './StrategyCompetitiveTab';
export * from './ShareBar';
export * from './RankingDistribution';
export * from './SiteTargetKeywords';
export * from './KeywordOpportunities';
export * from './StrategyHowItWorks';
// Orphaned after Phase R (decision-bands removal): zero importers today, re-homed by Strategy v2.
// Do NOT delete — re-imported by upcoming phases (Act queue: DecisionQueue/OpportunitiesList/
// DecayingPagesCard/LostQueryRecoveryCard/CannibalizationTriage/RequestedKeywordTriage).
// See docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md.
// (AuthorityAndBacklinks was removed in Phase 5 — the Competitive tab composes BacklinkProfile +
// CompetitiveIntel directly in research order rather than via the merged wrapper.)
export * from './OpportunitiesList';
export * from './DecayingPagesCard';
export * from './LostQueryRecoveryCard';
export * from './CannibalizationTriage';
