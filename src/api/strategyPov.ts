import { getSafe, post, patch } from './client';
import type { StrategyPovResponse } from '../../shared/types/strategy-pov';

/** Operator-editable fields (the PATCH body). Mirrors the route's patchPovSchema. */
export interface StrategyPovEdit {
  situation?: string;
  leadSentence?: string;
  wins?: string[];
  flags?: string[];
  leadMoveRecId?: string | null;
}

export const strategyPovApi = {
  get: (workspaceId: string) =>
    getSafe<StrategyPovResponse>(
      `/api/workspaces/${workspaceId}/strategy-pov`,
      { pov: null, refreshAvailable: false },
    ),

  /** Generate (or return cached on no-change). Throws on non-2xx — handle via useMutation onError. */
  generate: (workspaceId: string) =>
    post<StrategyPovResponse>(`/api/workspaces/${workspaceId}/strategy-pov/generate`, {}),

  /** Force a fresh draft (bypass cache). */
  regenerate: (workspaceId: string) =>
    post<StrategyPovResponse>(`/api/workspaces/${workspaceId}/strategy-pov/regenerate`, {}),

  /** Operator edit → bumps version, persists override. */
  edit: (workspaceId: string, edit: StrategyPovEdit) =>
    patch<StrategyPovResponse>(`/api/workspaces/${workspaceId}/strategy-pov`, edit),
};
