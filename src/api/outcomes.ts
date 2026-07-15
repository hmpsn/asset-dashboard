// ── Outcomes API (Outcome Intelligence Engine) ─────────────────────────────
import { getSafe, post } from './client';
import type {
  TrackedAction,
  ActionOutcome,
  ActionPlaybook,
  Attribution,
  OutcomeScorecard,
  OutcomeCoverage,
  TopWin,
  WorkspaceLearnings,
  WorkspaceOutcomeOverview,
  OutcomeWinEntry,
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

  // R9 (B15): admin-only coverage funnel (tracked/measured/reconciled). Never exposed to a
  // client-facing consumer.
  getCoverage: (wsId: string, signal?: AbortSignal) =>
    getSafe<OutcomeCoverage | null>(`/api/outcomes/${wsId}/coverage`, null, signal),

  getTopWins: (wsId: string, signal?: AbortSignal) =>
    getSafe<TopWin[]>(`/api/outcomes/${wsId}/top-wins`, [], signal),

  getTimeline: (wsId: string, signal?: AbortSignal) =>
    getSafe<TrackedAction[]>(`/api/outcomes/${wsId}/timeline`, [], signal),

  getLearnings: (wsId: string, signal?: AbortSignal) =>
    getSafe<WorkspaceLearnings | null>(`/api/outcomes/${wsId}/learnings`, null, signal),

  getOverview: (signal?: AbortSignal) =>
    getSafe<WorkspaceOutcomeOverview[]>(`/api/outcomes/overview`, [], signal),

  recordAction: (
    wsId: string,
    body: {
      actionType: string;
      sourceType: string;
      sourceId?: string;
      pageUrl?: string;
      targetKeyword?: string;
      baselineSnapshot?: { position?: number; clicks?: number; impressions?: number; ctr?: number; sessions?: number };
      /**
       * R8-PR2 (B14): the write layer REQUIRES an honest attribution internally, but this
       * external POST tolerates a missing value for backward compatibility. When omitted,
       * the server stores the HONEST `not_acted_on` default (never the old silent
       * `platform_executed`) and logs a deprecation warn. Pass an explicit value —
       * typed to the `Attribution` union so callers can't send an arbitrary string.
       */
      attribution?: Attribution;
      /**
       * R6 (B11) advisory source-identity snapshot — captures the source's title at write
       * time so a later win renders the real headline (e.g. a manually-published post's
       * title) instead of a generic label. `snapshot.type`/`page` are free-form.
       */
      source?: { label: string; snapshot?: { title?: string; type?: string; page?: string } };
    },
  ) =>
    post<{ success: boolean; action: TrackedAction; deduplicated?: boolean }>(
      `/api/outcomes/${wsId}/actions`,
      { baselineSnapshot: {}, ...body },
    ),

  addNote: (wsId: string, actionId: string, note: string) =>
    post<{ success: boolean }>(`/api/outcomes/${wsId}/actions/${actionId}/note`, { note }),

  getPlaybooks: (wsId: string, signal?: AbortSignal) =>
    getSafe<ActionPlaybook[]>(`/api/outcomes/${wsId}/playbooks`, [], signal),
};

// ── Client-facing endpoints (public, token-gated by workspace) ──────────────

export const clientOutcomesApi = {
  getSummary: (wsId: string, signal?: AbortSignal) =>
    getSafe<OutcomeScorecard | null>(`/api/public/outcomes/${wsId}/summary`, null, signal),

  getWins: (wsId: string, signal?: AbortSignal) =>
    getSafe<OutcomeWinEntry[]>(`/api/public/outcomes/${wsId}/wins`, [], signal),
};
