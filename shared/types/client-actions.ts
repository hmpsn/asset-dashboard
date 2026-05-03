export type ClientActionSourceType =
  | 'aeo_change'
  | 'internal_link'
  | 'keyword_strategy'
  | 'redirect_proposal'
  | 'content_decay';

export type ClientActionStatus =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'completed'
  | 'archived';

export interface ClientActionPayload {
  [key: string]: unknown;
}

export interface ClientAction {
  id: string;
  workspaceId: string;
  sourceType: ClientActionSourceType;
  sourceId?: string;
  title: string;
  summary: string;
  payload: ClientActionPayload;
  status: ClientActionStatus;
  priority: 'high' | 'medium' | 'low';
  clientNote?: string;
  createdAt: string;
  updatedAt: string;
}
