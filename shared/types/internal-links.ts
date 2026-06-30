export interface LinkSuggestion {
  fromPage: string;
  fromTitle: string;
  toPage: string;
  toTitle: string;
  anchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface PageLinkHealth {
  path: string;
  title: string;
  outboundLinks: number;
  inboundLinks: number;
  score: number;
  isOrphan: boolean;
}

export interface InternalLinkResult {
  suggestions: LinkSuggestion[];
  pageCount: number;
  attemptedPageCount: number;
  existingLinkCount: number;
  analyzedAt: string;
  pageHealth?: PageLinkHealth[];
  orphanCount?: number;
}
