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
    expect(facade).toContain("from './domains/keyword-command-center/sort.js'");
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
});
