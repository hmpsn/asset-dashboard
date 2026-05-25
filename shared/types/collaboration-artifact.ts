export type CollaborationArtifactSource = 'client_action' | 'approval_batch';

export type CollaborationArtifactSection =
  | 'decisions'
  | 'conversations'
  | 'reviews';

export type CollaborationArtifactVisibility = 'client-visible';

export interface CollaborationArtifact {
  id: string;
  source: CollaborationArtifactSource;
  sourceId: string;
  title: string;
  summary: string;
  createdAt: string;
  priority?: 'high' | 'medium' | 'low';
  badge?: string;
  itemCount: number;
  hasConversationNote: boolean;
  section: CollaborationArtifactSection;
  visibility: CollaborationArtifactVisibility;
}
