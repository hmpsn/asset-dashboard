import type { AeoEffort } from './aeo.js';

export type ClientActionSourceType =
  | 'aeo_change'
  | 'internal_link'
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
  sourcePageUrl?: string;
  sourcePageTitle?: string;
  contextSnippet?: string;
  /** @deprecated Legacy payload field retained for backward-compatible reads. */
  sourcePage?: string;
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

export interface AeoChangeDiff {
  page: string;
  /** Which section/question type is changing */
  section?: string;
  current: string;
  proposed: string;
  /** Why this change — one sentence from AeoPageChange.rationale */
  rationale?: string;
  /** Admin effort estimate, mapped from AeoEffort via mapAeoEffortToClientEffort() */
  effort?: 'low' | 'medium' | 'high';
  /** Urgency hint from AeoPageChange.priority — hidden in client view by default (Phase 1) */
  priority?: 'high' | 'medium' | 'low';
}

const AEO_EFFORT_CLIENT_MAP: Record<AeoEffort, 'low' | 'medium' | 'high'> = {
  quick: 'low',
  moderate: 'medium',
  significant: 'high',
};

/** Maps AeoEffort (admin internal) to client-facing effort tier. Exhaustiveness-checked via Record. */
export function mapAeoEffortToClientEffort(e: AeoEffort): 'low' | 'medium' | 'high' {
  return AEO_EFFORT_CLIENT_MAP[e];
}

export interface AeoChangePayload {
  diffs: AeoChangeDiff[];
}
