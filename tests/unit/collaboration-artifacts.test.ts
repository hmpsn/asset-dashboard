import { describe, expect, it } from 'vitest';
import {
  collaborationArtifactFromAction,
  collaborationArtifactFromBatch,
  partitionCollaborationArtifacts,
} from '../../src/lib/collaboration-artifacts';
import type { ClientAction } from '../../shared/types/client-actions';
import type { ApprovalBatch } from '../../shared/types/approvals';

function action(overrides: Partial<ClientAction> = {}): ClientAction {
  return {
    id: 'ca-1',
    workspaceId: 'ws-1',
    sourceType: 'content_decay',
    sourceId: 'source-1',
    title: 'Action title',
    summary: 'Action summary',
    payload: {},
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

function batch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'ab-1',
    workspaceId: 'ws-1',
    siteId: 'site-1',
    name: 'SEO Editor — Homepage',
    items: [{
      id: 'item-1',
      pageId: 'home',
      pageTitle: 'Home',
      pageSlug: '/',
      field: 'seo_title',
      currentValue: 'Old',
      proposedValue: 'New',
      status: 'pending',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    }],
    status: 'pending',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('collaboration artifact adapters', () => {
  it('routes note-free action to decisions', () => {
    const item = collaborationArtifactFromAction(action({ clientNote: undefined }));
    expect(item.section).toBe('decisions');
    expect(item.hasConversationNote).toBe(false);
  });

  it('routes note-bearing action to conversations', () => {
    const item = collaborationArtifactFromAction(action({ clientNote: 'Please discuss with us' }));
    expect(item.section).toBe('conversations');
    expect(item.hasConversationNote).toBe(true);
  });

  it('routes note-bearing batch to conversations', () => {
    const item = collaborationArtifactFromBatch(batch({ note: 'Need your confirmation' }));
    expect(item.section).toBe('conversations');
    expect(item.hasConversationNote).toBe(true);
  });

  it('partitions actions and batches by note routing', () => {
    const split = partitionCollaborationArtifacts(
      [
        batch({ id: 'ab-decisions' }),
        batch({ id: 'ab-conversations', note: 'Please review together' }),
      ],
      [
        action({ id: 'ca-decisions' }),
        action({ id: 'ca-conversations', clientNote: 'Need a reply' }),
      ],
    );
    expect(split.decisions.map(item => item.sourceId).sort()).toEqual(['ab-decisions', 'ca-decisions']);
    expect(split.conversations.map(item => item.sourceId).sort()).toEqual(['ab-conversations', 'ca-conversations']);
  });
});
