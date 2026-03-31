import { describe, it, expect, beforeEach } from 'vitest';

describe('suggested-briefs-store', () => {
  let createSuggestedBrief: typeof import('../server/suggested-briefs-store.js').createSuggestedBrief;
  let listSuggestedBriefs: typeof import('../server/suggested-briefs-store.js').listSuggestedBriefs;
  let getSuggestedBrief: typeof import('../server/suggested-briefs-store.js').getSuggestedBrief;
  let updateSuggestedBrief: typeof import('../server/suggested-briefs-store.js').updateSuggestedBrief;
  let dismissSuggestedBrief: typeof import('../server/suggested-briefs-store.js').dismissSuggestedBrief;
  let snoozeSuggestedBrief: typeof import('../server/suggested-briefs-store.js').snoozeSuggestedBrief;

  const wsId = 'test-ws-suggested-briefs';

  beforeEach(async () => {
    const mod = await import('../server/suggested-briefs-store.js');
    createSuggestedBrief = mod.createSuggestedBrief;
    listSuggestedBriefs = mod.listSuggestedBriefs;
    getSuggestedBrief = mod.getSuggestedBrief;
    updateSuggestedBrief = mod.updateSuggestedBrief;
    dismissSuggestedBrief = mod.dismissSuggestedBrief;
    snoozeSuggestedBrief = mod.snoozeSuggestedBrief;
  });

  it('exports all expected functions', () => {
    expect(typeof createSuggestedBrief).toBe('function');
    expect(typeof listSuggestedBriefs).toBe('function');
    expect(typeof getSuggestedBrief).toBe('function');
    expect(typeof updateSuggestedBrief).toBe('function');
    expect(typeof dismissSuggestedBrief).toBe('function');
    expect(typeof snoozeSuggestedBrief).toBe('function');
  });

  describe('createSuggestedBrief', () => {
    it('creates a brief with required fields and returns it', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'seo optimization',
        reason: 'Content has decayed significantly',
      });

      expect(brief.id).toBeTruthy();
      expect(brief.workspaceId).toBe(wsId);
      expect(brief.keyword).toBe('seo optimization');
      expect(brief.reason).toBe('Content has decayed significantly');
      expect(brief.status).toBe('pending');
      expect(brief.priority).toBe('medium');
      expect(brief.source).toBe('content_decay');
      expect(brief.pageUrl).toBeNull();
      expect(brief.resolvedAt).toBeNull();
      expect(brief.snoozedUntil).toBeNull();
      expect(brief.dismissedKeywordHash).toBeTruthy();
    });

    it('accepts optional fields', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'local seo',
        reason: 'Declining traffic',
        pageUrl: 'https://example.com/local-seo',
        source: 'traffic_drop',
        priority: 'high',
      });

      expect(brief.pageUrl).toBe('https://example.com/local-seo');
      expect(brief.source).toBe('traffic_drop');
      expect(brief.priority).toBe('high');
    });

    it('returns a synthetic dismissed brief when keyword was previously dismissed', () => {
      const wsIdUnique = `${wsId}-dismiss-dedup`;

      // Create and dismiss a brief
      const first = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'duplicate keyword',
        reason: 'First time',
      });
      dismissSuggestedBrief(first.id, wsIdUnique);

      // Now try to create again with same keyword
      const second = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'duplicate keyword',
        reason: 'Second time',
      });

      expect(second.status).toBe('dismissed');
      // Synthetic brief should not be persisted (id won't match any real row)
      const retrieved = getSuggestedBrief(second.id, wsIdUnique);
      expect(retrieved).toBeNull();
    });
  });

  describe('listSuggestedBriefs', () => {
    it('returns only pending and snoozed briefs by default', () => {
      const wsIdUnique = `${wsId}-list-filter`;

      const pending = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'pending keyword',
        reason: 'Pending reason',
      });
      const accepted = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'accepted keyword',
        reason: 'Accepted reason',
      });
      updateSuggestedBrief(accepted.id, wsIdUnique, 'accepted');

      const results = listSuggestedBriefs(wsIdUnique);
      const ids = results.map(b => b.id);

      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(accepted.id);
    });

    it('returns all briefs when includeAll=true', () => {
      const wsIdUnique = `${wsId}-list-all`;

      const pending = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'pending all',
        reason: 'Pending reason',
      });
      const dismissed = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'dismissed all',
        reason: 'Dismissed reason',
      });
      dismissSuggestedBrief(dismissed.id, wsIdUnique);

      const results = listSuggestedBriefs(wsIdUnique, true);
      const ids = results.map(b => b.id);

      expect(ids).toContain(pending.id);
      expect(ids).toContain(dismissed.id);
    });

    it('orders results by priority (high before medium before low)', () => {
      const wsIdUnique = `${wsId}-list-order`;

      createSuggestedBrief({ workspaceId: wsIdUnique, keyword: 'low priority', reason: 'Low', priority: 'low' });
      createSuggestedBrief({ workspaceId: wsIdUnique, keyword: 'high priority', reason: 'High', priority: 'high' });
      createSuggestedBrief({ workspaceId: wsIdUnique, keyword: 'medium priority', reason: 'Medium', priority: 'medium' });

      const results = listSuggestedBriefs(wsIdUnique);
      expect(results.length).toBeGreaterThan(0);

      const priorities = results.map(b => b.priority);
      const highIdx = priorities.indexOf('high');
      const medIdx = priorities.indexOf('medium');
      const lowIdx = priorities.indexOf('low');

      if (highIdx !== -1 && medIdx !== -1) expect(highIdx).toBeLessThan(medIdx);
      if (medIdx !== -1 && lowIdx !== -1) expect(medIdx).toBeLessThan(lowIdx);
    });
  });

  describe('getSuggestedBrief', () => {
    it('returns a brief by id and workspaceId', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'get by id',
        reason: 'Test reason',
      });

      const retrieved = getSuggestedBrief(brief.id, wsId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(brief.id);
      expect(retrieved!.keyword).toBe('get by id');
    });

    it('returns null for a non-existent id', () => {
      const result = getSuggestedBrief('non-existent-id', wsId);
      expect(result).toBeNull();
    });

    it('returns null when workspaceId does not match', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'workspace mismatch',
        reason: 'Test reason',
      });

      const result = getSuggestedBrief(brief.id, 'wrong-workspace');
      expect(result).toBeNull();
    });
  });

  describe('updateSuggestedBrief', () => {
    it('changes status to accepted and sets resolvedAt', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'update to accepted',
        reason: 'Test reason',
      });

      const updated = updateSuggestedBrief(brief.id, wsId, 'accepted');
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('accepted');
      expect(updated!.resolvedAt).toBeTruthy();
    });

    it('changes status to dismissed and sets resolvedAt', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'update to dismissed',
        reason: 'Test reason',
      });

      const updated = updateSuggestedBrief(brief.id, wsId, 'dismissed');
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('dismissed');
      expect(updated!.resolvedAt).toBeTruthy();
    });
  });

  describe('dismissSuggestedBrief', () => {
    it('marks a brief as dismissed', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'dismiss this',
        reason: 'Test reason',
      });

      const dismissed = dismissSuggestedBrief(brief.id, wsId);
      expect(dismissed).not.toBeNull();
      expect(dismissed!.status).toBe('dismissed');
      expect(dismissed!.resolvedAt).toBeTruthy();
    });

    it('returns null for non-existent brief', () => {
      const result = dismissSuggestedBrief('non-existent', wsId);
      expect(result).toBeNull();
    });
  });

  describe('snoozeSuggestedBrief', () => {
    it('sets status to snoozed and sets snoozedUntil', () => {
      const brief = createSuggestedBrief({
        workspaceId: wsId,
        keyword: 'snooze this',
        reason: 'Test reason',
      });

      const snoozeDate = '2026-04-07T00:00:00.000Z';
      const snoozed = snoozeSuggestedBrief(brief.id, wsId, snoozeDate);
      expect(snoozed).not.toBeNull();
      expect(snoozed!.status).toBe('snoozed');
      expect(snoozed!.snoozedUntil).toBe(snoozeDate);
    });

    it('snoozed briefs appear in default list (pending/snoozed)', () => {
      const wsIdUnique = `${wsId}-snooze-list`;
      const brief = createSuggestedBrief({
        workspaceId: wsIdUnique,
        keyword: 'snooze list test',
        reason: 'Test reason',
      });

      snoozeSuggestedBrief(brief.id, wsIdUnique, '2026-04-07T00:00:00.000Z');

      const results = listSuggestedBriefs(wsIdUnique);
      const ids = results.map(b => b.id);
      expect(ids).toContain(brief.id);
    });
  });
});
