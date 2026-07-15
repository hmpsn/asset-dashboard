import { afterAll, describe, expect, it } from 'vitest';

import { savePost } from '../../server/content-posts-db.js';
import { buildKeywordCommandCenterRows } from '../../server/keyword-command-center.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import {
  KEYWORD_LIFECYCLE_STAGES,
  type KeywordCommandCenterRowsResponse,
} from '../../shared/types/keyword-command-center.js';
import type { GeneratedPost } from '../../shared/types/content.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';

function makePublishedPost(workspaceId: string, publishedSlug: string): GeneratedPost {
  const now = new Date().toISOString();
  return {
    id: `post_lifecycle_${workspaceId}`,
    workspaceId,
    briefId: 'brief-lifecycle',
    targetKeyword: 'emergency dentist',
    title: 'Emergency Dentist',
    metaDescription: 'Emergency dentist page',
    introduction: '',
    sections: [],
    conclusion: '',
    totalWordCount: 0,
    targetWordCount: 0,
    status: 'approved',
    unificationStatus: 'success',
    webflowItemId: 'wf-item-lifecycle',
    publishedAt: now,
    publishedSlug,
    createdAt: now,
    updatedAt: now,
  };
}

describe('Keyword Command Center lifecycleStage row contract', () => {
  const workspaceId = createWorkspace('KCC Lifecycle Stage Contract').id;

  afterAll(() => {
    deleteWorkspace(workspaceId);
  });

  it('serializes derived lifecycleStage on /rows entries', async () => {
    const keyword = 'Emergency dentist';
    savePost(workspaceId, makePublishedPost(workspaceId, 'services/emergency-dentist'));
    addTrackedKeyword(workspaceId, keyword, {
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      status: TRACKED_KEYWORD_STATUS.ACTIVE,
      strategyOwned: true,
      pagePath: 'https://example.com/services/emergency-dentist?utm=ignored',
      pageTitle: 'Emergency Dentist',
    });

    const response = await buildKeywordCommandCenterRows(workspaceId, {
      page: 1,
      pageSize: 10,
      sort: 'keyword',
    }) as KeywordCommandCenterRowsResponse | null;

    expect(response).not.toBeNull();
    const row = response!.rows.find(item => item.normalizedKeyword === keywordComparisonKey(keyword));

    expect(row).toEqual(expect.objectContaining({
      normalizedKeyword: keywordComparisonKey(keyword),
      lifecycleStage: KEYWORD_LIFECYCLE_STAGES.PUBLISHED,
    }));
  });
});
