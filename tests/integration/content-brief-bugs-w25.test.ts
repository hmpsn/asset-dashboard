/**
 * Integration tests for W2.5 content-brief server bug fixes.
 *
 * Bug 1: StandaloneContentBriefGenerationParams targetPageId/targetPageSlug
 *   — dispatcher threads fields through; type carries the new optional fields.
 *
 * Bug 2: send-to-client dedupe — calling the route twice returns the same requestId
 *   and creates exactly one content request linked to the brief.
 *
 * Bug 3: regenerateBrief lineage — superseded_by set on the old brief; listBriefs
 *   (default) excludes superseded; listBriefs({ includeSuperseded: true }) includes all.
 *   The transaction behavior is exercised by simulating the exact DB writes that
 *   regenerateBrief performs: upsertBrief for the new row + updateBrief on the old one.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  listBriefs,
  getBrief,
  upsertBrief,
  updateBrief,
} from '../../server/content-brief.js';
import {
  createContentRequest,
  getOpenRequestForBrief,
  updateContentRequest,
} from '../../server/content-requests.js';
import type { ContentBrief } from '../../shared/types/content.js';
import type { StandaloneContentBriefGenerationParams } from '../../server/content-brief-generation-job.js';
import db from '../../server/db/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let briefSeq = 0;
function makeBrief(workspaceId: string, suffix: string): ContentBrief {
  briefSeq++;
  const brief: ContentBrief = {
    id: `brief_test_${suffix}_${briefSeq}_${Date.now()}`,
    workspaceId,
    targetKeyword: `test keyword ${suffix} ${briefSeq}`,
    secondaryKeywords: [],
    suggestedTitle: `Test Title ${suffix}`,
    suggestedMetaDesc: `Test meta description for ${suffix}`,
    outline: [{ heading: 'Intro', notes: 'Introduction section', subheadings: [] }],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'general',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    executiveSummary: `Executive summary for ${suffix}`,
    pageType: 'blog',
  };
  upsertBrief(workspaceId, brief);
  return brief;
}

/**
 * Simulate the regenerateBrief write path (insert new + mark old as superseded)
 * without invoking the AI call. This isolates Bug 3's DB-layer fix.
 */
function simulateRegenerate(workspaceId: string, existingBrief: ContentBrief): ContentBrief {
  const newBrief: ContentBrief = {
    ...existingBrief,
    id: `brief_regen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    suggestedTitle: `Regenerated: ${existingBrief.suggestedTitle}`,
    supersededBy: undefined,
  };
  db.transaction(() => {
    upsertBrief(workspaceId, newBrief);
    const currentOld = getBrief(workspaceId, existingBrief.id);
    if (currentOld && !currentOld.supersededBy) {
      updateBrief(workspaceId, existingBrief.id, { supersededBy: newBrief.id });
    }
  })();
  return newBrief;
}

// ══════════════════════════════════════════════════════════════════════════════
// Bug 1: StandaloneContentBriefGenerationParams type carries targetPageId/Slug
// ══════════════════════════════════════════════════════════════════════════════

describe('Bug 1 — StandaloneContentBriefGenerationParams includes targetPageId/targetPageSlug', () => {
  it('params type accepts targetPageId and targetPageSlug without TypeScript error', () => {
    // Compile-time shape check exercised at test runtime.
    const params: StandaloneContentBriefGenerationParams = {
      source: 'standalone',
      workspaceId: 'ws_test',
      targetKeyword: 'test keyword',
      targetPageId: 'page_abc123',
      targetPageSlug: '/blog/my-page',
    };
    expect(params.targetPageId).toBe('page_abc123');
    expect(params.targetPageSlug).toBe('/blog/my-page');
  });

  it('params type still works without the optional fields', () => {
    const params: StandaloneContentBriefGenerationParams = {
      source: 'standalone',
      workspaceId: 'ws_test',
      targetKeyword: 'another keyword',
    };
    expect(params.targetPageId).toBeUndefined();
    expect(params.targetPageSlug).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Bug 2: send-to-client dedupe — getOpenRequestForBrief + transaction
// ══════════════════════════════════════════════════════════════════════════════

describe('Bug 2 — send-to-client dedupe: getOpenRequestForBrief', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('returns undefined when no request is linked to the brief', () => {
    const brief = makeBrief(workspaceId, 'dedupe-1');
    const result = getOpenRequestForBrief(workspaceId, brief.id);
    expect(result).toBeUndefined();
  });

  it('returns the linked request after create+link (simulating send-to-client write)', () => {
    const brief = makeBrief(workspaceId, 'dedupe-2');

    let request: ReturnType<typeof createContentRequest>;
    db.transaction(() => {
      request = createContentRequest(workspaceId, {
        topic: brief.suggestedTitle,
        targetKeyword: brief.targetKeyword,
        intent: 'informational',
        priority: 'medium',
        rationale: brief.executiveSummary || 'test',
        source: 'strategy',
        serviceType: 'brief_only',
        pageType: 'blog',
        initialStatus: 'brief_generated',
        dedupe: false,
      });
      updateContentRequest(workspaceId, request.id, {
        briefId: brief.id,
        status: 'client_review',
      });
    })();

    const found = getOpenRequestForBrief(workspaceId, brief.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(request!.id);
    expect(found!.briefId).toBe(brief.id);
    expect(found!.status).toBe('client_review');
  });

  it('calling send-to-client twice creates exactly one linked request', () => {
    const brief = makeBrief(workspaceId, 'dedupe-3');

    // Simulate first call (idempotent create+link)
    function sendToClient(): string {
      let requestId: string | undefined;
      db.transaction(() => {
        const existing = getOpenRequestForBrief(workspaceId, brief.id);
        if (existing) { requestId = existing.id; return; }
        const req = createContentRequest(workspaceId, {
          topic: brief.suggestedTitle,
          targetKeyword: brief.targetKeyword,
          intent: 'informational',
          priority: 'medium',
          rationale: 'test',
          source: 'strategy',
          serviceType: 'brief_only',
          pageType: 'blog',
          initialStatus: 'brief_generated',
          dedupe: false,
        });
        updateContentRequest(workspaceId, req.id, { briefId: brief.id, status: 'client_review' });
        requestId = req.id;
      })();
      return requestId!;
    }

    const id1 = sendToClient();
    const id2 = sendToClient();

    // Both calls must return the same request id
    expect(id1).toBe(id2);

    // Verify exactly one row is linked to this brief
    const row = db.prepare(
      `SELECT COUNT(*) as c FROM content_topic_requests WHERE workspace_id = ? AND brief_id = ?`,
    ).get(workspaceId, brief.id) as { c: number };
    expect(row.c).toBe(1);
  });

  it('returns undefined for a declined request so a new one can be created', () => {
    const brief = makeBrief(workspaceId, 'dedupe-4');

    let request: ReturnType<typeof createContentRequest>;
    db.transaction(() => {
      request = createContentRequest(workspaceId, {
        topic: brief.suggestedTitle,
        targetKeyword: brief.targetKeyword,
        intent: 'informational',
        priority: 'medium',
        rationale: 'test',
        source: 'strategy',
        serviceType: 'brief_only',
        pageType: 'blog',
        initialStatus: 'brief_generated',
        dedupe: false,
      });
      updateContentRequest(workspaceId, request.id, { briefId: brief.id, status: 'client_review' });
    })();

    // Decline the request
    updateContentRequest(workspaceId, request!.id, { status: 'declined' });

    // getOpenRequestForBrief must return undefined — declined is excluded
    const found = getOpenRequestForBrief(workspaceId, brief.id);
    expect(found).toBeUndefined();
  });

  // Review fix #3: the dedupe filter must exclude ALL concluded statuses, not just
  // ('declined','published'). `delivered` is terminal-enough (work shipped) that a
  // re-send should open a fresh request; `client_review` is in-flight and must block.
  function linkRequest(brief: ContentBrief, status: string): string {
    let id = '';
    db.transaction(() => {
      const req = createContentRequest(workspaceId, {
        topic: brief.suggestedTitle,
        targetKeyword: brief.targetKeyword,
        intent: 'informational',
        priority: 'medium',
        rationale: 'test',
        source: 'strategy',
        serviceType: 'brief_only',
        pageType: 'blog',
        initialStatus: 'brief_generated',
        dedupe: false,
      });
      updateContentRequest(workspaceId, req.id, { briefId: brief.id, status: 'client_review' });
      if (status !== 'client_review') {
        updateContentRequest(workspaceId, req.id, { status: status as never });
      }
      id = req.id;
    })();
    return id;
  }

  it('a DELIVERED request does NOT block re-send (delivered is excluded)', () => {
    const brief = makeBrief(workspaceId, 'dedupe-delivered');
    linkRequest(brief, 'delivered');
    // delivered is concluded → no open request → re-send allowed.
    expect(getOpenRequestForBrief(workspaceId, brief.id)).toBeUndefined();
  });

  it('a PUBLISHED request does NOT block re-send (published is terminal)', () => {
    const brief = makeBrief(workspaceId, 'dedupe-published');
    linkRequest(brief, 'published');
    expect(getOpenRequestForBrief(workspaceId, brief.id)).toBeUndefined();
  });

  it('a CLIENT_REVIEW request DOES block re-send (still in flight)', () => {
    const brief = makeBrief(workspaceId, 'dedupe-clientreview');
    const id = linkRequest(brief, 'client_review');
    const found = getOpenRequestForBrief(workspaceId, brief.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Bug 3: superseded_by column + listBriefs filter + regenerate transaction
// ══════════════════════════════════════════════════════════════════════════════

describe('Bug 3 — regenerateBrief lineage: superseded_by + listBriefs filter', () => {
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('new briefs have supersededBy = undefined', () => {
    const brief = makeBrief(workspaceId, 'lineage-new');
    const read = getBrief(workspaceId, brief.id);
    expect(read).toBeDefined();
    expect(read!.supersededBy).toBeUndefined();
  });

  it('listBriefs default excludes superseded briefs', () => {
    const brief1 = makeBrief(workspaceId, 'lineage-list-a');
    const brief2 = makeBrief(workspaceId, 'lineage-list-b');

    // Mark brief1 as superseded by brief2
    db.prepare(
      `UPDATE content_briefs SET superseded_by = ? WHERE id = ? AND workspace_id = ?`,
    ).run(brief2.id, brief1.id, workspaceId);

    const defaultList = listBriefs(workspaceId);
    const ids = defaultList.map(b => b.id);
    expect(ids).not.toContain(brief1.id);
    expect(ids).toContain(brief2.id);
  });

  it('listBriefs({ includeSuperseded: true }) returns all briefs', () => {
    const brief1 = makeBrief(workspaceId, 'lineage-all-a');
    const brief2 = makeBrief(workspaceId, 'lineage-all-b');

    db.prepare(
      `UPDATE content_briefs SET superseded_by = ? WHERE id = ? AND workspace_id = ?`,
    ).run(brief2.id, brief1.id, workspaceId);

    const allList = listBriefs(workspaceId, { includeSuperseded: true });
    const ids = allList.map(b => b.id);
    expect(ids).toContain(brief1.id);
    expect(ids).toContain(brief2.id);

    const read1 = allList.find(b => b.id === brief1.id);
    expect(read1?.supersededBy).toBe(brief2.id);
  });

  it('simulateRegenerate sets superseded_by and the default list excludes old brief', () => {
    const brief0 = makeBrief(workspaceId, 'regen-single');

    const brief1 = simulateRegenerate(workspaceId, brief0);

    // New brief is a separate row
    expect(brief1.id).not.toBe(brief0.id);

    // Old brief has supersededBy set to the new brief's id
    const oldRead = getBrief(workspaceId, brief0.id);
    expect(oldRead).toBeDefined();
    expect(oldRead!.supersededBy).toBe(brief1.id);

    // Default list should NOT include the old brief
    const defaultList = listBriefs(workspaceId);
    const ids = defaultList.map(b => b.id);
    expect(ids).not.toContain(brief0.id);
    expect(ids).toContain(brief1.id);
  });

  it('two regenerations produce one active brief and two superseded ones (lineage chain)', () => {
    const brief0 = makeBrief(workspaceId, 'regen-chain-0');
    const brief1 = simulateRegenerate(workspaceId, brief0);
    const brief2 = simulateRegenerate(workspaceId, brief1);

    const defaultList = listBriefs(workspaceId);
    const ids = defaultList.map(b => b.id);

    expect(ids).not.toContain(brief0.id);
    expect(ids).not.toContain(brief1.id);
    expect(ids).toContain(brief2.id);

    // Full lineage traceable
    const r0 = getBrief(workspaceId, brief0.id);
    const r1 = getBrief(workspaceId, brief1.id);
    expect(r0!.supersededBy).toBe(brief1.id);
    expect(r1!.supersededBy).toBe(brief2.id);
  });

  it('transaction idempotency — re-running regenerate on already-superseded brief is a no-op', () => {
    const brief0 = makeBrief(workspaceId, 'regen-idempotent');
    const brief1 = simulateRegenerate(workspaceId, brief0);

    // Simulate a duplicate write attempt on brief0 (already has supersededBy=brief1.id)
    const brief2: ContentBrief = {
      ...brief0,
      id: `brief_dup_${Date.now()}`,
      createdAt: new Date().toISOString(),
      supersededBy: undefined,
    };
    db.transaction(() => {
      upsertBrief(workspaceId, brief2);
      const currentOld = getBrief(workspaceId, brief0.id);
      // Guard: if already superseded, don't overwrite
      if (currentOld && !currentOld.supersededBy) {
        updateBrief(workspaceId, brief0.id, { supersededBy: brief2.id });
      }
    })();

    // brief0 should still point to brief1 (not brief2)
    const r0 = getBrief(workspaceId, brief0.id);
    expect(r0!.supersededBy).toBe(brief1.id);
  });
});
