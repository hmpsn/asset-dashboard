// ── Outcomes API (Outcome Intelligence Engine) ─────────────────────────────
import { getSafe, post } from './client';
import type {
  TrackedAction,
  ActionOutcome,
  OutcomeScorecard,
  TopWin,
  WorkspaceLearnings,
  WorkspaceOutcomeOverview,
  WeCalledItEntry,
} from '../../shared/types/outcome-tracking';

export interface ActionWithOutcomes extends TrackedAction {
  outcomes: ActionOutcome[];
}

// ── Admin endpoints (require auth) ─────────────────────────────────────────

export const outcomesApi = {
  getActions: (wsId: string, type?: string, score?: string, signal?: AbortSignal) => {
    let url = `/api/outcomes/${wsId}/actions`;
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (score) params.set('score', score);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    return getSafe<TrackedAction[]>(url, [], signal);
  },

  getAction: (wsId: string, actionId: string, signal?: AbortSignal) =>
    getSafe<ActionWithOutcomes | null>(
      `/api/outcomes/${wsId}/actions/${actionId}`,
      null,
      signal,
    ),

  getScorecard: (wsId: string, signal?: AbortSignal) =>
    getSafe<OutcomeScorecard | null>(`/api/outcomes/${wsId}/scorecard`, null, signal),

  getTopWins: (wsId: string, signal?: AbortSignal) =>
    getSafe<TopWin[]>(`/api/outcomes/${wsId}/top-wins`, [], signal),

  getTimeline: (wsId: string, signal?: AbortSignal) =>
    getSafe<TrackedAction[]>(`/api/outcomes/${wsId}/timeline`, [], signal),

  getLearnings: (wsId: string, signal?: AbortSignal) =>
    getSafe<WorkspaceLearnings | null>(`/api/outcomes/${wsId}/learnings`, null, signal),

  getOverview: (signal?: AbortSignal) =>
    getSafe<WorkspaceOutcomeOverview[]>(`/api/outcomes/overview`, [], signal),

  addNote: (wsId: string, actionId: string, note: string) =>
    post<{ ok: boolean }>(`/api/outcomes/${wsId}/actions/${actionId}/note`, { note }),
};

// ── Client-facing endpoints (public, token-gated by workspace) ──────────────

export const clientOutcomesApi = {
  getSummary: (wsId: string, signal?: AbortSignal) =>
    getSafe<OutcomeScorecard | null>(`/api/public/outcomes/${wsId}/summary`, null, signal),

  getWins: (wsId: string, signal?: AbortSignal) =>
    getSafe<WeCalledItEntry[]>(`/api/public/outcomes/${wsId}/wins`, [], signal),
};
