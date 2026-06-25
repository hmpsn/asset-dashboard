import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestLlmMentions,
  getLlmMentionsTrend,
  storeLlmMentionSnapshot,
} from '../../server/llm-mentions-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`LLM Mentions ${Date.now()}`).id;
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

describe('llm-mentions-store', () => {
  it('round-trips a snapshot: numerics, share-of-voice, JSON arrays', () => {
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      domain: 'example.com',
      mentions: 72,
      aiSearchVolume: 1500,
      shareOfVoice: 0.14,
      competitors: [{ name: 'Rival', mentions: 200 }],
      sourceDomains: [{ domain: 'reddit.com', mentions: 40 }],
    });

    const latest = getLatestLlmMentions(workspaceId);
    expect(latest).toBeDefined();
    expect(latest!.workspaceId).toBe(workspaceId);
    expect(latest!.snapshotDate).toBe('2026-06-24');
    expect(latest!.platform).toBe('chat_gpt');
    expect(latest!.domain).toBe('example.com');
    expect(latest!.mentions).toBe(72);
    expect(latest!.aiSearchVolume).toBe(1500);
    expect(latest!.shareOfVoice).toBe(0.14);
    // JSON array columns deep-equal.
    expect(latest!.competitors).toEqual([{ name: 'Rival', mentions: 200 }]);
    expect(latest!.sourceDomains).toEqual([{ domain: 'reddit.com', mentions: 40 }]);
    expect(typeof latest!.fetchedAt).toBe('string');
  });

  it('maps absent numerics to undefined (never 0)', () => {
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      // mentions / aiSearchVolume / shareOfVoice / domain all omitted.
      competitors: [],
      sourceDomains: [],
    });

    const latest = getLatestLlmMentions(workspaceId);
    expect(latest).toBeDefined();
    expect(latest!.mentions).toBeUndefined();
    expect(latest!.aiSearchVolume).toBeUndefined();
    expect(latest!.shareOfVoice).toBeUndefined();
    expect(latest!.domain).toBeUndefined();
    expect(latest!.competitors).toEqual([]);
    expect(latest!.sourceDomains).toEqual([]);
  });

  it('upserts on (workspace_id, snapshot_date, platform) — second store UPDATES, not duplicates', () => {
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      mentions: 72,
      competitors: [{ name: 'Rival', mentions: 200 }],
      sourceDomains: [],
    });
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      mentions: 90,
      competitors: [{ name: 'Rival', mentions: 250 }],
      sourceDomains: [{ domain: 'reddit.com', mentions: 40 }],
    });

    const trend = getLlmMentionsTrend(workspaceId);
    expect(trend).toHaveLength(1);
    expect(trend[0].mentions).toBe(90);
    expect(trend[0].competitors).toEqual([{ name: 'Rival', mentions: 250 }]);
    expect(trend[0].sourceDomains).toEqual([{ domain: 'reddit.com', mentions: 40 }]);
  });

  it('getLlmMentionsTrend returns snapshots date-ascending', () => {
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      mentions: 90,
      competitors: [],
      sourceDomains: [],
    });
    storeLlmMentionSnapshot(workspaceId, '2026-06-20', 'chat_gpt', {
      mentions: 60,
      competitors: [],
      sourceDomains: [],
    });

    const trend = getLlmMentionsTrend(workspaceId);
    expect(trend.map(s => s.snapshotDate)).toEqual(['2026-06-20', '2026-06-24']);
    expect(trend.map(s => s.mentions)).toEqual([60, 90]);

    // getLatestLlmMentions returns the most recent date.
    expect(getLatestLlmMentions(workspaceId)!.snapshotDate).toBe('2026-06-24');
    expect(getLatestLlmMentions(workspaceId)!.mentions).toBe(90);
  });

  it('scopes latest/trend reads by platform when provided', () => {
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
      mentions: 72,
      competitors: [],
      sourceDomains: [],
    });
    storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'google', {
      mentions: 33,
      competitors: [],
      sourceDomains: [],
    });

    expect(getLatestLlmMentions(workspaceId, 'chat_gpt')!.mentions).toBe(72);
    expect(getLatestLlmMentions(workspaceId, 'google')!.mentions).toBe(33);
    expect(getLlmMentionsTrend(workspaceId, 'chat_gpt')).toHaveLength(1);
    expect(getLlmMentionsTrend(workspaceId)).toHaveLength(2);
  });

  it('scopes reads by workspace_id', () => {
    const otherWorkspaceId = createWorkspace(`LLM Other ${Date.now()}`).id;
    try {
      storeLlmMentionSnapshot(workspaceId, '2026-06-24', 'chat_gpt', {
        mentions: 72,
        competitors: [],
        sourceDomains: [],
      });
      storeLlmMentionSnapshot(otherWorkspaceId, '2026-06-24', 'chat_gpt', {
        mentions: 999,
        competitors: [],
        sourceDomains: [],
      });

      expect(getLatestLlmMentions(workspaceId)!.mentions).toBe(72);
      expect(getLatestLlmMentions(otherWorkspaceId)!.mentions).toBe(999);
      expect(getLlmMentionsTrend(workspaceId)).toHaveLength(1);
      expect(getLlmMentionsTrend(otherWorkspaceId)).toHaveLength(1);
    } finally {
      deleteWorkspace(otherWorkspaceId);
    }
  });
});
