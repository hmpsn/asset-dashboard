// ── Client request domain types ─────────────────────────────────

export type RequestPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
export type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';

export interface RequestAttachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface RequestNote {
  id: string;
  author: 'client' | 'team';
  content: string;
  attachments?: RequestAttachment[];
  createdAt: string;
}

export interface ClientRequest {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  submittedBy?: string;
  pageUrl?: string;
  pageId?: string;
  attachments?: RequestAttachment[];
  notes: RequestNote[];
  createdAt: string;
  updatedAt: string;
}
