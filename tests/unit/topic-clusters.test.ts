import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  listTopicClusters,
  replaceAllTopicClusters,
  deleteAllTopicClusters,
  countTopicClusters,
  migrateFromJsonBlob,
} from '../../server/topic-clusters.js';
import type { TopicCluster } from '../../shared/types/workspace.js';

const cleanupWorkspaceIds: string[] = [];

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteAllTopicClusters(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function makeCluster(overrides: Partial<TopicCluster> = {}): TopicCluster {
  return {
    topic: 'seo services',
    keywords: ['seo services', 'technical seo'],
    ownedCount: 1,
    totalCount: 4,
    coveragePercent: 25,
    avgPosition: 11.5,
    topCompetitor: 'competitor.com',
    topCompetitorCoverage: 75,
    gap: ['seo consultant', 'enterprise seo'],
    ...overrides,
  };
}

describe('topic-clusters table', () => {
  it('replaces and lists topic clusters', () => {
    const ws = createWorkspace(`Topic Clusters Replace ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllTopicClusters(ws.id, [
      makeCluster({ topic: 'cluster b', coveragePercent: 60 }),
      makeCluster({ topic: 'cluster a', coveragePercent: 20 }),
    ]);

    const clusters = listTopicClusters(ws.id);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].topic).toBe('cluster a');
    expect(clusters[1].topic).toBe('cluster b');
    expect(countTopicClusters(ws.id)).toBe(2);
  });

  it('keeps one row per topic (case-insensitive dedupe, last topic wins)', () => {
    const ws = createWorkspace(`Topic Clusters Unique ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllTopicClusters(ws.id, [
      makeCluster({ topic: 'SEO Cluster', coveragePercent: 30 }),
      makeCluster({ topic: 'seo cluster', coveragePercent: 80 }),
    ]);

    const clusters = listTopicClusters(ws.id);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].topic).toBe('seo cluster');
    expect(clusters[0].coveragePercent).toBe(80);
  });

  it('migrates topicClusters from workspace keywordStrategy blob and strips stale blob field', () => {
    const ws = createWorkspace(`Topic Clusters Migrate ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    updateWorkspace(ws.id, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        topicClusters: [
          makeCluster({ topic: 'migrate cluster', coveragePercent: 44 }),
        ],
        generatedAt: new Date().toISOString(),
      },
    });

    migrateFromJsonBlob();

    const clusters = listTopicClusters(ws.id);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].topic).toBe('migrate cluster');
    expect(clusters[0].coveragePercent).toBe(44);

    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.topicClusters).toBeUndefined();
  });
});
