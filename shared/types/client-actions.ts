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

// ── Typed payload shapes per source type ──────────────────────────────────
// These narrow the generic ClientActionPayload for modal renderers.
// Each admin "send to client" route populates payload with this shape.

export interface InternalLinkItem {
  anchorText: string;
  targetUrl: string;
  targetTitle?: string;
  sourcePage?: string;
  contextSnippet?: string;
}
export interface InternalLinkPayload {
  suggestions: InternalLinkItem[];
}

export interface RedirectItem {
  source: string;
  target: string;
  rationale?: string;
  /** 301 or 302 — defaults to permanent if absent */
  type?: 'permanent' | 'temporary';
}
export interface RedirectProposalPayload {
  redirects: RedirectItem[];
}

export interface KeywordStrategyPage {
  page: string;
  keyword: string;
  currentPosition?: number;
}
export interface KeywordStrategyQuickWin {
  keyword: string;
  opportunity: string;
}
export interface KeywordStrategyPayload {
  mappedPages?: KeywordStrategyPage[];
  quickWins?: KeywordStrategyQuickWin[];
  contentGaps?: string[];
  opportunities?: string[];
}

export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
}
export interface AeoChangePayload {
  diffs: AeoChangeDiff[];
}
