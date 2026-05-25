/**
 * Unit tests for server/suggested-briefs-store.ts
 *
 * Tests cover the public API surface:
 *  - createSuggestedBrief: basic creation, deduplication (pending/snoozed skip),
 *    dismissed-keyword skip, default priority/source, explicit priority, pageUrl
 *  - listSuggestedBriefs: ordering (high > medium > low), includeAll flag
 *  - getSuggestedBrief: hit + miss
 *  - updateSuggestedBrief: accepted + dismissed status transitions
 *  - dismissSuggestedBrief: convenience wrapper
 *  - snoozeSuggestedBrief: sets status and snoozedUntil, included in default list
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSuggestedBrief,
  dismissSuggestedBrief,
  getSuggestedBrief,
  listSuggestedBriefs,
  snoozeSuggestedBrief,
  updateSuggestedBrief,
} from '../../server/suggested-briefs-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let wsId: string;

beforeEach(() => {
  const ws = createWorkspace('SuggestedBriefs Test');
  wsId = ws.id;
});

afterEach(() => {
  deleteWorkspace(wsId);
});

// ─── createSuggestedBrief ───────────────────────────────────────────────────

describe('createSuggestedBrief — basic creation', () => {
  it('persists a brief and returns the correct fields', () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'seo audit services',
      reason: 'High-priority gap',
      priority: 'high',
      pageUrl: 'https://example.com/seo-audit',
      source: 'content_decay',
    });

    expect(brief.workspaceId).toBe(wsId);
    expect(brief.keyword).toBe('seo audit services');
    expect(brief.reason).toBe('High-priority gap');
    expect(brief.priority).toBe('high');
    expect(brief.pageUrl).toBe('https://example.com/seo-audit');
    expect(brief.source).toBe('content_decay');
    expect(brief.status).toBe('pending');
    expect(brief.resolvedAt).toBeNull();
    expect(brief.snoozedUntil).toBeNull();
    expect(brief.id).toBeTruthy();
  });

  it('defaults priority to medium and source to content_decay', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'default test', reason: 'test' });
    expect(brief.priority).toBe('medium');
    expect(brief.source).toBe('content_decay');
  });

  it('stores pageUrl as null when not supplied', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'no url test', reason: 'test' });
    expect(brief.pageUrl).toBeNull();
  });

  it('persists a brief with low priority', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'low priority keyword', reason: 'minor gap', priority: 'low' });
    expect(brief.priority).toBe('low');
  });
});

describe('createSuggestedBrief — deduplication: pending keyword', () => {
  it('returns a synthetic non-persisted brief when the same keyword already has a pending brief', () => {
    const first = createSuggestedBrief({ workspaceId: wsId, keyword: 'dup keyword', reason: 'first' });
    expect(first.status).toBe('pending');

    const second = createSuggestedBrief({ workspaceId: wsId, keyword: 'dup keyword', reason: 'second' });
    expect(second.status).toBe('pending');
    // Different id — synthetic, not persisted
    expect(second.id).not.toBe(first.id);

    // Only one brief actually in DB
    const listed = listSuggestedBriefs(wsId);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(first.id);
  });

  it('is case-insensitive for keyword dedup', () => {
    createSuggestedBrief({ workspaceId: wsId, keyword: 'Local SEO', reason: 'gap' });
    const dup = createSuggestedBrief({ workspaceId: wsId, keyword: 'local seo', reason: 'again' });
    expect(dup.status).toBe('pending');
    expect(listSuggestedBriefs(wsId)).toHaveLength(1);
  });
});

describe('createSuggestedBrief — deduplication: dismissed keyword', () => {
  it('returns a synthetic dismissed brief when the keyword was previously dismissed', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'dismissed kw', reason: 'test' });
    dismissSuggestedBrief(brief.id, wsId);

    const again = createSuggestedBrief({ workspaceId: wsId, keyword: 'dismissed kw', reason: 'retry' });
    expect(again.status).toBe('dismissed');
    // Not persisted — total in DB is still 1 (the original dismissed row)
    expect(listSuggestedBriefs(wsId, true)).toHaveLength(1);
  });
});

// ─── listSuggestedBriefs ────────────────────────────────────────────────────

describe('listSuggestedBriefs — priority ordering', () => {
  it('orders high > medium > low', () => {
    createSuggestedBrief({ workspaceId: wsId, keyword: 'low kw', reason: 'x', priority: 'low' });
    createSuggestedBrief({ workspaceId: wsId, keyword: 'high kw', reason: 'x', priority: 'high' });
    createSuggestedBrief({ workspaceId: wsId, keyword: 'medium kw', reason: 'x', priority: 'medium' });

    const list = listSuggestedBriefs(wsId);
    expect(list.map(b => b.priority)).toEqual(['high', 'medium', 'low']);
  });
});

describe('listSuggestedBriefs — includeAll flag', () => {
  it('excludes accepted/dismissed from default list', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'accepted kw', reason: 'x' });
    updateSuggestedBrief(brief.id, wsId, 'accepted');

    const defaultList = listSuggestedBriefs(wsId);
    expect(defaultList.find(b => b.id === brief.id)).toBeUndefined();
  });

  it('includes accepted/dismissed in includeAll=true list', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'accepted kw', reason: 'x' });
    updateSuggestedBrief(brief.id, wsId, 'accepted');

    const allList = listSuggestedBriefs(wsId, true);
    expect(allList.find(b => b.id === brief.id)?.status).toBe('accepted');
  });
});

// ─── getSuggestedBrief ──────────────────────────────────────────────────────

describe('getSuggestedBrief', () => {
  it('returns the brief for a known id', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'get test', reason: 'test' });
    const fetched = getSuggestedBrief(brief.id, wsId);
    expect(fetched?.id).toBe(brief.id);
    expect(fetched?.keyword).toBe('get test');
  });

  it('returns null for an unknown id', () => {
    expect(getSuggestedBrief('nonexistent-id', wsId)).toBeNull();
  });

  it('returns null for a brief in a different workspace', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'cross-ws', reason: 'test' });
    const otherWs = createWorkspace('Other WS');
    try {
      expect(getSuggestedBrief(brief.id, otherWs.id)).toBeNull();
    } finally {
      deleteWorkspace(otherWs.id);
    }
  });
});

// ─── updateSuggestedBrief ───────────────────────────────────────────────────

describe('updateSuggestedBrief', () => {
  it('sets status to accepted and records resolvedAt', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'accept me', reason: 'x' });
    const updated = updateSuggestedBrief(brief.id, wsId, 'accepted');
    expect(updated?.status).toBe('accepted');
    expect(updated?.resolvedAt).toBeTruthy();
  });

  it('sets status to dismissed and records resolvedAt', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'dismiss me', reason: 'x' });
    const updated = updateSuggestedBrief(brief.id, wsId, 'dismissed');
    expect(updated?.status).toBe('dismissed');
    expect(updated?.resolvedAt).toBeTruthy();
  });

  it('returns null for an unknown id', () => {
    const result = updateSuggestedBrief('nonexistent', wsId, 'accepted');
    expect(result).toBeNull();
  });
});

// ─── dismissSuggestedBrief ──────────────────────────────────────────────────

describe('dismissSuggestedBrief', () => {
  it('is a convenience wrapper that sets status to dismissed', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'dismiss via helper', reason: 'x' });
    const dismissed = dismissSuggestedBrief(brief.id, wsId);
    expect(dismissed?.status).toBe('dismissed');
    expect(dismissed?.resolvedAt).toBeTruthy();
  });
});

// ─── snoozeSuggestedBrief ───────────────────────────────────────────────────

describe('snoozeSuggestedBrief', () => {
  it('sets status to snoozed and records snoozedUntil', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'snooze me', reason: 'x' });
    const snoozed = snoozeSuggestedBrief(brief.id, wsId, '2026-12-01');
    expect(snoozed?.status).toBe('snoozed');
    expect(snoozed?.snoozedUntil).toBe('2026-12-01');
  });

  it('snoozed brief appears in the default list (status IN pending, snoozed)', () => {
    const brief = createSuggestedBrief({ workspaceId: wsId, keyword: 'snoozed visible', reason: 'x' });
    snoozeSuggestedBrief(brief.id, wsId, '2026-12-01');
    const list = listSuggestedBriefs(wsId);
    expect(list.find(b => b.id === brief.id)?.status).toBe('snoozed');
  });

  it('returns null for an unknown id', () => {
    const result = snoozeSuggestedBrief('nonexistent', wsId, '2026-12-01');
    expect(result).toBeNull();
  });
});
