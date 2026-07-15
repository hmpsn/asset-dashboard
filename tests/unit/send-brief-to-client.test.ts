import { afterEach, describe, expect, it, vi } from 'vitest';

const emailState = vi.hoisted(() => ({
  clientBriefReady: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../server/email.js', () => ({
  notifyClientBriefReady: vi.fn((options: Record<string, unknown>) => {
    emailState.clientBriefReady.push(options);
  }),
  isEmailConfigured: vi.fn(() => true),
}));

import type { ContentBrief } from '../../shared/types/content.js';
import db from '../../server/db/index.js';
import { getBrief, updateBriefAtRevision, upsertBrief } from '../../server/content-brief.js';
import {
  createContentRequest,
  ExplicitContentRequestNotFoundError,
  getContentRequest,
  listContentRequests,
  updateContentRequest,
} from '../../server/content-requests.js';
import {
  BriefReviewRequestLifecycleConflictError,
  sendBriefToClientForReview,
} from '../../server/domains/content/send-brief-to-client.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let workspaceId = '';

function seedBrief(): ContentBrief {
  const brief: ContentBrief = {
    id: `brief_send_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    targetKeyword: 'atomic brief send',
    secondaryKeywords: [],
    suggestedTitle: 'Atomic brief send',
    suggestedMetaDesc: 'Safe client review',
    outline: [],
    wordCountTarget: 900,
    intent: 'informational',
    audience: 'operators',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
  };
  upsertBrief(workspaceId, brief);
  return brief;
}

function setup(): void {
  setBroadcast(() => {}, () => {});
  workspaceId = createWorkspace(`Brief send ${Date.now()} ${Math.random()}`).id;
  updateWorkspace(workspaceId, { clientEmail: 'client@example.com' });
  emailState.clientBriefReady = [];
}

function activityCount(type: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM activity_log WHERE workspace_id = ? AND type = ?',
  ).get(workspaceId, type) as { count: number };
  return row.count;
}

function seedLinkedGeneratedRequest(brief: ContentBrief) {
  const request = createContentRequest(workspaceId, {
    topic: brief.suggestedTitle,
    targetKeyword: brief.targetKeyword,
    intent: brief.intent || 'informational',
    priority: 'medium',
    rationale: brief.executiveSummary || 'Generated brief ready for review',
    source: 'strategy',
    serviceType: 'brief_only',
    pageType: brief.pageType || 'blog',
    initialStatus: 'brief_generated',
    dedupe: false,
  });
  const linked = updateContentRequest(workspaceId, request.id, { briefId: brief.id });
  if (!linked) throw new Error('Failed to link generated request fixture');
  return linked;
}

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
});

describe('sendBriefToClientForReview', () => {
  it('creates the review request and bumps the brief in one accepted mutation', () => {
    setup();
    const brief = seedBrief();

    const result = sendBriefToClientForReview(workspaceId, brief.id, { expectedRevision: 0 });

    expect(result.changed).toBe(true);
    expect(result.request).toMatchObject({ briefId: brief.id, status: 'client_review' });
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(1);
  });

  it('rejects a stale send without leaving a review request', () => {
    setup();
    const brief = seedBrief();
    updateBriefAtRevision(workspaceId, brief.id, 0, { suggestedTitle: 'Newer title' });

    expect(() => sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
    })).toThrow('changed while generation was running');

    expect(listContentRequests(workspaceId)).toHaveLength(0);
    expect(getBrief(workspaceId, brief.id)?.suggestedTitle).toBe('Newer title');
  });

  it('advances an open linked generated request when sending by brief id', () => {
    setup();
    const brief = seedBrief();
    const generatedRequest = seedLinkedGeneratedRequest(brief);

    const result = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      created: false,
      changed: true,
      request: { id: generatedRequest.id, briefId: brief.id, status: 'client_review' },
    });
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(1);
    expect(listContentRequests(workspaceId)).toHaveLength(1);
  });

  it('rejects a missing explicit request without retargeting or side effects', () => {
    setup();
    const brief = seedBrief();
    const events: string[] = [];
    setBroadcast(() => {}, (_workspaceId, event) => events.push(event));

    expect(() => sendBriefToClientForReview(workspaceId, brief.id, {
      requestId: 'creq_missing_explicit_brief',
      expectedRevision: 0,
    })).toThrow(ExplicitContentRequestNotFoundError);

    expect(listContentRequests(workspaceId)).toHaveLength(0);
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(0);
    expect(emailState.clientBriefReady).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(activityCount('brief_sent_for_review')).toBe(0);
  });

  it('rejects a cross-workspace explicit request without retargeting or side effects', () => {
    setup();
    const brief = seedBrief();
    const otherWorkspaceId = createWorkspace(`Foreign brief request ${Date.now()} ${Math.random()}`).id;
    const foreign = createContentRequest(otherWorkspaceId, {
      topic: 'Foreign brief request',
      targetKeyword: 'foreign brief',
      intent: 'informational',
      priority: 'medium',
      rationale: 'foreign',
      initialStatus: 'brief_generated',
      dedupe: false,
    });
    const events: string[] = [];
    setBroadcast(() => {}, (_workspaceId, event) => events.push(event));

    try {
      expect(() => sendBriefToClientForReview(workspaceId, brief.id, {
        requestId: foreign.id,
        expectedRevision: 0,
      })).toThrow(ExplicitContentRequestNotFoundError);

      expect(listContentRequests(workspaceId)).toHaveLength(0);
      expect(getContentRequest(otherWorkspaceId, foreign.id)?.status).toBe('brief_generated');
      expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(0);
      expect(emailState.clientBriefReady).toHaveLength(0);
      expect(events).toHaveLength(0);
      expect(activityCount('brief_sent_for_review')).toBe(0);
    } finally {
      deleteWorkspace(otherWorkspaceId);
    }
  });

  it('rejects an explicit lifecycle-incompatible request without side effects', () => {
    setup();
    const brief = seedBrief();
    const request = seedLinkedGeneratedRequest(brief);
    db.prepare(`
      UPDATE content_topic_requests SET status = 'approved'
      WHERE id = ? AND workspace_id = ?
    `).run(request.id, workspaceId);
    const events: string[] = [];
    setBroadcast(() => {}, (_workspaceId, event) => events.push(event));

    expect(() => sendBriefToClientForReview(workspaceId, brief.id, {
      requestId: request.id,
      expectedRevision: 0,
    })).toThrow(BriefReviewRequestLifecycleConflictError);

    expect(getContentRequest(workspaceId, request.id)?.status).toBe('approved');
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(0);
    expect(listContentRequests(workspaceId)).toHaveLength(1);
    expect(emailState.clientBriefReady).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(activityCount('brief_sent_for_review')).toBe(0);
  });

  it('creates a fresh review instead of resurrecting an implicitly linked incompatible request', () => {
    setup();
    const brief = seedBrief();
    const historical = seedLinkedGeneratedRequest(brief);
    db.prepare(`
      UPDATE content_topic_requests SET status = 'approved'
      WHERE id = ? AND workspace_id = ?
    `).run(historical.id, workspaceId);

    const result = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
    });

    expect(result.created).toBe(true);
    expect(result.request.id).not.toBe(historical.id);
    expect(result.request.status).toBe('client_review');
    expect(getContentRequest(workspaceId, historical.id)?.status).toBe('approved');
    expect(listContentRequests(workspaceId)).toHaveLength(2);
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(1);
  });

  it('returns an unchanged open review as an idempotent no-op', () => {
    setup();
    const brief = seedBrief();
    sendBriefToClientForReview(workspaceId, brief.id, { expectedRevision: 0 });
    const revision = getBrief(workspaceId, brief.id)!.generationRevision;

    const second = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: revision,
    });

    expect(second.changed).toBe(false);
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(revision);
    expect(listContentRequests(workspaceId)).toHaveLength(1);
  });

  it('applies a new note on re-send, bumps once, then treats the same note as a true no-op', () => {
    setup();
    const brief = seedBrief();
    const first = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
      note: 'Initial review context',
    });
    expect(first.brief.generationRevision).toBe(1);
    expect(first.request.clientNote).toBe('Initial review context');
    expect(first.request.internalNote).toBeUndefined();

    const changed = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 1,
      note: 'Please prioritize the decision section.',
    });

    expect(changed.changed).toBe(true);
    expect(changed.created).toBe(false);
    expect(changed.request.clientNote).toBe('Please prioritize the decision section.');
    expect(changed.request.internalNote).toBeUndefined();
    expect(changed.brief.generationRevision).toBe(2);
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(2);
    expect(getContentRequest(workspaceId, changed.request.id)?.clientNote)
      .toBe('Please prioritize the decision section.');

    const unchanged = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 2,
      note: 'Please prioritize the decision section.',
    });

    expect(unchanged.changed).toBe(false);
    expect(unchanged.request.updatedAt).toBe(changed.request.updatedAt);
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(2);
    expect(listContentRequests(workspaceId)).toHaveLength(1);
  });

  it('rejects a stale re-send without applying its note or bumping the brief', () => {
    setup();
    const brief = seedBrief();
    const first = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
      note: 'Accepted note',
    });

    expect(() => sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
      note: 'Stale replacement',
    })).toThrow('changed while generation was running');

    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(1);
    expect(getContentRequest(workspaceId, first.request.id)?.clientNote).toBe('Accepted note');
    expect(getContentRequest(workspaceId, first.request.id)?.internalNote).toBeUndefined();
    expect(listContentRequests(workspaceId)).toHaveLength(1);
  });

  it('keeps a committed send successful when one broadcast fails and runs the next effect', () => {
    setup();
    const brief = seedBrief();
    const laterEvents: string[] = [];
    let failRequestBroadcast = true;
    setBroadcast(() => {}, (_workspaceId, event) => {
      if (event === WS_EVENTS.CONTENT_REQUEST_CREATED && failRequestBroadcast) {
        failRequestBroadcast = false;
        throw new Error('injected request broadcast failure');
      }
      laterEvents.push(event);
    });

    const result = sendBriefToClientForReview(workspaceId, brief.id, {
      expectedRevision: 0,
      note: 'Visible review context',
    });

    expect(result.changed).toBe(true);
    expect(result.request).toMatchObject({
      clientNote: 'Visible review context',
      status: 'client_review',
    });
    expect(getContentRequest(workspaceId, result.request.id)?.status).toBe('client_review');
    expect(getBrief(workspaceId, brief.id)?.generationRevision).toBe(1);
    expect(laterEvents).not.toContain(WS_EVENTS.CONTENT_REQUEST_CREATED);
    expect(laterEvents).toContain(WS_EVENTS.CONTENT_UPDATED);
  });
});
