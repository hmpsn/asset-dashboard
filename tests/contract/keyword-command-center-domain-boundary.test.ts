import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildKeywordCommandCenterDetail as facadeBuildKeywordCommandCenterDetail,
  buildKeywordCommandCenterInitialView as facadeBuildKeywordCommandCenterInitialView,
  buildKeywordCommandCenterRows as facadeBuildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary as facadeBuildKeywordCommandCenterSummary,
} from '../../server/keyword-command-center.js';
import { buildKeywordCommandCenterDetail } from '../../server/domains/keyword-command-center/detail-service.js';
import { buildKeywordCommandCenterInitialView } from '../../server/domains/keyword-command-center/initial-view-service.js';
import { buildKeywordCommandCenterRows } from '../../server/domains/keyword-command-center/rows-service.js';
import { buildKeywordCommandCenterSummary } from '../../server/domains/keyword-command-center/summary-service.js';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8'); // readFile-ok - source contract checks KCC facade/domain ownership.
}

describe('keyword command center domain boundary', () => {
  it('keeps row-query helpers in the domain module with compatibility re-exports from the facade', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const rowQuery = readRepoFile('server/domains/keyword-command-center/row-query.ts');
    const sort = readRepoFile('server/domains/keyword-command-center/sort.ts');

    for (const helper of [
      'sortRows',
      'sortRowsForQuery',
      'matchesFilter',
      'matchesSearch',
      'paginateRows',
      'filterCount',
      'filterNeedsLocalCandidates',
      'buildCounts',
      'buildFilterFacetsFromCounts',
      'stripLocalSeoVisibility',
    ]) {
      expect(facade).toContain(`  ${helper},`);
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(rowQuery).toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/keyword-command-center/row-query.js'");
    expect(rowQuery).toContain("from './sort.js'");
    expect(rowQuery).toContain('setKeywordCommandCenterRowValueScore');
    expect(sort).toContain('export function keywordSortComparator');
  });

  it('keeps row lifecycle helpers in the domain module with compatibility re-exports from the facade', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const lifecycle = readRepoFile('server/domains/keyword-command-center/row-lifecycle.ts');
    const types = readRepoFile('server/domains/keyword-command-center/types.ts');

    for (const helper of [
      'feedbackState',
      'ensureRow',
      'assignmentPriority',
      'sourceFromExplanation',
      'sourceFromKeywordGap',
      'isInactiveTracking',
      'protectedReason',
      'lifecycleStatus',
      'statusLabel',
      'localPriority',
    ]) {
      expect(facade).toContain(`  ${helper},`);
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(lifecycle).toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/keyword-command-center/row-lifecycle.js'");
    expect(facade).toContain("from './domains/keyword-command-center/types.js'");
    expect(types).toContain('export interface CommandCenterSourceBundle');
    expect(types).toContain('export interface DraftRow');
  });

  it('keeps keyword feedback persistence in the domain store module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const feedbackStore = readRepoFile('server/domains/keyword-command-center/feedback-store.ts');
    const rowsService = readRepoFile('server/domains/keyword-command-center/rows-service.ts');
    const detailService = readRepoFile('server/domains/keyword-command-center/detail-service.ts');
    const sourceSnapshot = readRepoFile('server/domains/keyword-command-center/source-snapshot.ts');

    for (const helper of [
      'readFeedbackRows',
      'readFeedback',
      'deleteFeedbackByKeywordKey',
      'upsertFeedback',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(feedbackStore).toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(rowsService).toContain("from './source-snapshot.js'");
    expect(detailService).toContain("from './source-snapshot.js'");
    expect(sourceSnapshot).toContain("from './feedback-store.js'");
    expect(feedbackStore).toContain('keyword_feedback');
    expect(feedbackStore).toContain('createStmtCache');
  });

  it('keeps bundle filtering helpers in the domain module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const bundleFilters = readRepoFile('server/domains/keyword-command-center/bundle-filters.ts');
    const rowsService = readRepoFile('server/domains/keyword-command-center/rows-service.ts');
    const detailService = readRepoFile('server/domains/keyword-command-center/detail-service.ts');

    for (const helper of [
      'addStrategyKeys',
      'addPageKeys',
      'parentableVariantKeys',
      'findVariantParentKey',
      'filterStrategyForKeys',
      'restrictPageToKeys',
      'filterMapByKeys',
      'filterStrategyForSingleKeyword',
      'pageMatchesKeyword',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(bundleFilters).toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(rowsService).toContain("from './bundle-filters.js'");
    expect(detailService).toContain("from './bundle-filters.js'");
    expect(bundleFilters).toContain('createVariantParentIndex');
    expect(bundleFilters).toContain('keywordComparisonKey');
  });

  it('keeps tracked keyword provenance helpers in the domain module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const provenance = readRepoFile('server/domains/keyword-command-center/tracked-keyword-provenance.ts');
    const startup = readRepoFile('server/index.ts');

    for (const helper of [
      'withResolvedSiteKeywordMetrics',
      'inferTrackedKeywordSources',
      'mergeTrackedKeywordProvenance',
      'inferTrackedKeywordSourcesForWorkspace',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(provenance).toMatch(new RegExp(`function ${helper}\\b`));
      expect(facade).toContain(`  ${helper},`);
    }

    expect(facade).toContain("from './domains/keyword-command-center/tracked-keyword-provenance.js'");
    expect(startup).toContain("from './domains/keyword-command-center/tracked-keyword-provenance.js'");
    expect(startup).not.toContain("from './keyword-command-center.js'");
    expect(provenance).toContain('listTrackedKeywordRows');
    expect(provenance).toContain('resolveSiteKeywordMetrics');
  });

  it('keeps candidate boundary helpers in the domain module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const candidateBoundary = readRepoFile('server/domains/keyword-command-center/candidate-boundary.ts');

    for (const helper of [
      'selectRankEvidence',
      'mergeMetricsInto',
      'gateDiscoveryGaps',
      'addCandidateKeysFromBundle',
      'resolveBundleMetrics',
      'candidateSortForQuery',
      'trackedKeywordMatchesFilter',
      '__candidateKeysForTest',
      'rowCandidateKeysForQuery',
      'sourceKeysForRows',
      'filterBundleToKeys',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(candidateBoundary).toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const reExported of [
      '__candidateKeysForTest',
      'candidateSortForQuery',
      'gateDiscoveryGaps',
      'trackedKeywordMatchesFilter',
    ]) {
      expect(facade).toContain(`  ${reExported},`);
    }

    expect(facade).toContain("from './domains/keyword-command-center/candidate-boundary.js'");
    expect(candidateBoundary).toContain('isStrategyPoolEligibleKeyword');
    expect(candidateBoundary).toContain('keywordSortComparator');
    expect(candidateBoundary).toContain('selectRankEvidence');
  });

  it('keeps action mutation helpers in the domain service with compatibility re-exports from the facade', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const actionService = readRepoFile('server/domains/keyword-command-center/action-service.ts');

    for (const helper of [
      'canModifyProtected',
      'trackedSourceForMerge',
      'upsertTrackedKeywordByKey',
      'retireTrackedKeyword',
      'broadcastKeywordCommandCenterAction',
      'applyKeywordCommandCenterActionInternal',
      'bulkActionLabel',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(actionService).toMatch(new RegExp(`function ${helper}\\b`));
    }

    for (const reExported of [
      'applyKeywordCommandCenterAction',
      'applyKeywordCommandCenterBulkAction',
      'deleteKeywordHard',
      'isHardDeleteEligible',
    ]) {
      expect(facade).toContain(`  ${reExported},`);
      expect(actionService).toMatch(new RegExp(`export function ${reExported}\\b`));
    }

    expect(facade).toContain("from './domains/keyword-command-center/action-service.js'");
    expect(actionService).toContain('db.transaction');
    expect(actionService).toContain('broadcastToWorkspace');
    expect(actionService).toContain('addActivity');
    expect(actionService).toContain('recordKeywordTrackingAction');
    expect(actionService).toContain('validateTransition');
  });

  it('keeps read-model row assembly helpers in the domain module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const readModel = readRepoFile('server/domains/keyword-command-center/read-model.ts');

    for (const helper of [
      'buildValueScoringConfig',
      'safeLostVisibilityKeys',
      'safeLostVisibilityRows',
      'populateDraftRows',
      'finalizeDraftRow',
      'finalizeDraftRows',
      'ensureLocalVisibilityRows',
      '__candidateRowMetricParityForTest',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(readModel).toMatch(new RegExp(`export (async )?function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/keyword-command-center/read-model.js'");
    expect(facade).toContain('  __candidateRowMetricParityForTest,');
    expect(readModel).toContain('buildKeywordStrategyUxPayload');
    expect(readModel).toContain('getLatestSerpSnapshots');
    expect(readModel).toContain('keywordDollarValue');
    expect(readModel).toContain('addCandidateKeysFromBundle');
  });

  it('keeps summary assembly in the domain service with compatibility re-export from the facade', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const summaryService = readRepoFile('server/domains/keyword-command-center/summary-service.ts');

    expect(facade).not.toMatch(/function buildKeywordCommandCenterSummary\b/);
    expect(summaryService).toMatch(/export async function buildKeywordCommandCenterSummary\b/);
    expect(facade).toContain('  buildKeywordCommandCenterSummary,');
    expect(facade).toContain("from './domains/keyword-command-center/summary-service.js'");
    expect(summaryService).toContain('countLocalSeoKeywordCandidates');
    expect(summaryService).toContain('isSuspiciousPlannerGroupedVolume');
    expect(summaryService).toContain('trackedKeywordMatchesFilter');
    expect(summaryService).toContain('buildFilterFacetsFromCounts');
    expect(summaryService).toContain("from './source-snapshot.js'");
  });

  it('keeps detail assembly in the domain service with compatibility re-export from the facade', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const detailService = readRepoFile('server/domains/keyword-command-center/detail-service.ts');

    expect(facade).not.toMatch(/function buildKeywordCommandCenterDetail\b/);
    expect(detailService).toMatch(/export async function buildKeywordCommandCenterDetail\b/);
    expect(facade).toContain('  buildKeywordCommandCenterDetail,');
    expect(facade).toContain("from './domains/keyword-command-center/detail-service.js'");
    expect(detailService).toContain('buildLocalSeoKeywordVisibilityForKeyword');
    expect(detailService).toContain('getScoredOutcomeReadbacks');
    expect(detailService).toContain('filterStrategyForSingleKeyword');
    expect(detailService).toContain('finalizeDraftRow');
    expect(detailService).toContain("from './source-snapshot.js'");
  });

  it('keeps rows and initial view assembly in domain services with facade re-export only', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const rowsService = readRepoFile('server/domains/keyword-command-center/rows-service.ts');
    const initialViewService = readRepoFile('server/domains/keyword-command-center/initial-view-service.ts');

    for (const helper of [
      'buildKeywordCommandCenterRows',
      'buildKeywordCommandCenterRowsSkinny',
      'buildKeywordCommandCenterLocalCandidateRows',
      'buildFilteredBundle',
      'localVisibilityByFilter',
      'buildKeywordCommandCenterInitialView',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
    }
    expect(facade).not.toMatch(/createLogger\('keyword-command-center'\)/);
    expect(facade).toContain('  buildKeywordCommandCenterRows,');
    expect(facade).toContain('  buildKeywordCommandCenterInitialView,');
    expect(facade).toContain("from './domains/keyword-command-center/rows-service.js'");
    expect(facade).toContain("from './domains/keyword-command-center/initial-view-service.js'");
    expect(rowsService).toMatch(/export async function buildKeywordCommandCenterRows\b/);
    expect(rowsService).not.toContain('buildKeywordCommandCenterModel');
    expect(rowsService).toContain('buildLocalSeoKeywordCandidates');
    expect(rowsService).toContain('LOCAL_CANDIDATE_ROW_LIMIT');
    expect(rowsService).toContain('finalizeDraftRows');
    expect(rowsService).toContain("from './source-snapshot.js'");
    expect(rowsService).toContain('rowCandidateKeysForQuery');
    expect(rowsService).toContain('filterBundleToKeys');
    expect(initialViewService).toMatch(/export async function buildKeywordCommandCenterInitialView\b/);
    expect(initialViewService).toContain('buildKeywordCommandCenterSourceSnapshot');
    expect(initialViewService).toContain('buildKeywordCommandCenterSummary');
    expect(initialViewService).toContain('buildKeywordCommandCenterRows');
    expect(initialViewService).not.toContain('buildKeywordCommandCenterModel');
    expect(existsSync(new URL('server/domains/keyword-command-center/model-service.ts', repoRoot))).toBe(false);
  });

  it('keeps shared source loading in the domain source snapshot', () => {
    const sourceSnapshot = readRepoFile('server/domains/keyword-command-center/source-snapshot.ts');
    const summaryService = readRepoFile('server/domains/keyword-command-center/summary-service.ts');
    const rowsService = readRepoFile('server/domains/keyword-command-center/rows-service.ts');
    const detailService = readRepoFile('server/domains/keyword-command-center/detail-service.ts');
    const initialViewService = readRepoFile('server/domains/keyword-command-center/initial-view-service.ts');

    expect(sourceSnapshot).toMatch(/export function buildKeywordCommandCenterSourceSnapshot\b/);
    expect(sourceSnapshot).toContain('assembleStoredKeywordStrategy');
    expect(sourceSnapshot).toContain('listPageKeywordsLite');
    expect(sourceSnapshot).toContain('getTrackedKeywords');
    expect(sourceSnapshot).toContain('getLatestSnapshotRanks');
    expect(sourceSnapshot).toContain('safeLostVisibilityRows');
    expect(sourceSnapshot).toContain('safeLostVisibilityCount');
    expect(sourceSnapshot).not.toContain('buildKeywordCommandCenterModel');
    for (const service of [summaryService, rowsService, detailService, initialViewService]) {
      expect(service).toContain("from './source-snapshot.js'");
    }
  });

  it('keeps facade read exports as direct domain service re-exports', () => {
    expect(facadeBuildKeywordCommandCenterRows).toBe(buildKeywordCommandCenterRows);
    expect(facadeBuildKeywordCommandCenterSummary).toBe(buildKeywordCommandCenterSummary);
    expect(facadeBuildKeywordCommandCenterDetail).toBe(buildKeywordCommandCenterDetail);
    expect(facadeBuildKeywordCommandCenterInitialView).toBe(buildKeywordCommandCenterInitialView);
  });
});
