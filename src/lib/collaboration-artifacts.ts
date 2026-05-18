import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { ClientAction } from '../../shared/types/client-actions.js';
import type {
  CollaborationArtifact,
  CollaborationArtifactSection,
} from '../../shared/types/collaboration-artifact.js';
import { badgeForBatch } from './decision-adapters';

const CLIENT_ACTION_BADGES: Record<string, string> = {
  aeo_change: 'AEO',
  internal_link: 'Internal Links',
  redirect_proposal: 'Redirects',
  content_decay: 'Content',
  keyword_strategy: 'Keywords', // deprecated legacy rows only
};

function hasConversationNote(note: string | null | undefined): boolean {
  return typeof note === 'string' && note.trim().length > 0;
}

function sectionForNote(note: string | null | undefined): CollaborationArtifactSection {
  return hasConversationNote(note) ? 'conversations' : 'decisions';
}

function actionItemCount(action: ClientAction): number {
  const p = action.payload as Record<string, unknown>;
  if (Array.isArray(p?.diffs)) return p.diffs.length;
  if (Array.isArray(p?.suggestions)) return p.suggestions.length;
  if (Array.isArray(p?.redirects)) return p.redirects.length;
  return 1;
}

export function collaborationArtifactFromAction(action: ClientAction): CollaborationArtifact {
  const section = sectionForNote(action.clientNote);
  return {
    id: `ca-${action.id}`,
    source: 'client_action',
    sourceId: action.id,
    title: action.title,
    summary: action.summary,
    createdAt: action.createdAt,
    priority: action.priority,
    badge: CLIENT_ACTION_BADGES[action.sourceType] ?? action.sourceType.replace(/_/g, ' '),
    itemCount: actionItemCount(action),
    hasConversationNote: section === 'conversations',
    section,
    visibility: 'client-visible',
  };
}

export function collaborationArtifactFromBatch(batch: ApprovalBatch): CollaborationArtifact {
  const section = sectionForNote(batch.note);
  return {
    id: `ab-${batch.id}`,
    source: 'approval_batch',
    sourceId: batch.id,
    title: batch.name,
    summary: `${batch.items.length} change${batch.items.length !== 1 ? 's' : ''} ready for your approval`,
    createdAt: batch.createdAt,
    badge: badgeForBatch(batch.name),
    itemCount: batch.items.length,
    hasConversationNote: section === 'conversations',
    section,
    visibility: 'client-visible',
  };
}

export function partitionCollaborationArtifacts(
  approvals: ApprovalBatch[],
  actions: ClientAction[],
): {
  decisions: CollaborationArtifact[];
  conversations: CollaborationArtifact[];
} {
  const artifacts = [
    ...approvals.map(collaborationArtifactFromBatch),
    ...actions.map(collaborationArtifactFromAction),
  ];
  return {
    decisions: artifacts.filter((artifact) => artifact.section === 'decisions'),
    conversations: artifacts.filter((artifact) => artifact.section === 'conversations'),
  };
}
