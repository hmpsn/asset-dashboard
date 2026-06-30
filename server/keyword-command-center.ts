export {
  assignmentPriority,
  feedbackState,
  ensureRow,
  isInactiveTracking,
  lifecycleStatus,
  localPriority,
  protectedReason,
  sourceFromExplanation,
  sourceFromKeywordGap,
  statusLabel,
} from './domains/keyword-command-center/row-lifecycle.js';

export {
  buildCounts,
  buildFilterFacetsFromCounts,
  filterCount,
  filterNeedsLocalCandidates,
  matchesFilter,
  matchesSearch,
  paginateRows,
  sortRows,
  sortRowsForQuery,
  stripLocalSeoVisibility,
} from './domains/keyword-command-center/row-query.js';

export {
  inferTrackedKeywordSources,
  inferTrackedKeywordSourcesForWorkspace,
  mergeTrackedKeywordProvenance,
  withResolvedSiteKeywordMetrics,
} from './domains/keyword-command-center/tracked-keyword-provenance.js';

export {
  __candidateKeysForTest,
  candidateSortForQuery,
  gateDiscoveryGaps,
  trackedKeywordMatchesFilter,
} from './domains/keyword-command-center/candidate-boundary.js';

export {
  __candidateRowMetricParityForTest,
} from './domains/keyword-command-center/read-model.js';

export {
  buildKeywordCommandCenterRows,
} from './domains/keyword-command-center/rows-service.js';

export {
  buildKeywordCommandCenterSummary,
} from './domains/keyword-command-center/summary-service.js';

export {
  buildKeywordCommandCenterDetail,
} from './domains/keyword-command-center/detail-service.js';

export {
  buildKeywordCommandCenterInitialView,
} from './domains/keyword-command-center/initial-view-service.js';

export {
  applyKeywordCommandCenterAction,
  applyKeywordCommandCenterBulkAction,
  deleteKeywordHard,
  isHardDeleteEligible,
} from './domains/keyword-command-center/action-service.js';

export type {
  CandidateRowMetricParity,
  RowCandidateKey,
} from './domains/keyword-command-center/candidate-boundary.js';

export type { CommandCenterSourceBundle } from './domains/keyword-command-center/types.js';
