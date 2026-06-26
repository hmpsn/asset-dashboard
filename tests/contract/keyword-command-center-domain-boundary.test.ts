import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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

    for (const helper of [
      'readFeedbackRows',
      'readFeedback',
      'deleteFeedbackByKeywordKey',
      'upsertFeedback',
    ]) {
      expect(facade).not.toMatch(new RegExp(`function ${helper}\\b`));
      expect(feedbackStore).toMatch(new RegExp(`function ${helper}\\b`));
    }

    expect(facade).toContain("from './domains/keyword-command-center/feedback-store.js'");
    expect(feedbackStore).toContain('keyword_feedback');
    expect(feedbackStore).toContain('createStmtCache');
  });

  it('keeps bundle filtering helpers in the domain module', () => {
    const facade = readRepoFile('server/keyword-command-center.ts');
    const bundleFilters = readRepoFile('server/domains/keyword-command-center/bundle-filters.ts');

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

    expect(facade).toContain("from './domains/keyword-command-center/bundle-filters.js'");
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
});
