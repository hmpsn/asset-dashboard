// ── Client request domain types ─────────────────────────────────

export type RequestPriority = 'low' | 'medium' | 'high' | 'urgent';
export type RequestStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';
export type RequestCategory = 'bug' | 'content' | 'design' | 'seo' | 'feature' | 'other';

/**
 * The 4 client-visible request states synthesized from admin RequestStatus + notes.
 * Replaces the raw 6-state RequestStatus in all client-facing components.
 */
export type ClientRequestStatus =
  | 'awaiting_team'  // admin: 'new' | 'in_review' — no unread team note
  | 'in_progress'    // admin: 'in_progress' | 'on_hold' — no unread team note
  | 'resolved'       // admin: 'completed' | 'closed'
  | 'team_replied';  // any non-terminal + last note.author === 'team'

/**
 * Maps admin RequestStatus + notes to the 4 client-visible states.
 * "team_replied" is inferred from last note author (no explicit unread tracking in DB).
 * Priority: resolved > team_replied > in_progress > awaiting_team
 */
export function toClientRequestStatus(
  status: RequestStatus,
  notes: Pick<RequestNote, 'author'>[],
): ClientRequestStatus {
  if (status === 'completed' || status === 'closed') return 'resolved';
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'team_replied';
  if (status === 'in_progress' || status === 'on_hold') return 'in_progress';
  return 'awaiting_team';
}

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
