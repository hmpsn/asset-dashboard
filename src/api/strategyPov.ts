import { getSafe, post, patch } from './client';
import type { StrategyPov } from '../../shared/types/strategy-pov';

interface PovResponse {
  pov: StrategyPov | null;
  unchanged?: boolean;
}

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
    getSafe<PovResponse>(`/api/workspaces/${workspaceId}/strategy-pov`, { pov: null }),

  /** Generate (or return cached on no-change). Throws on non-2xx — handle via useMutation onError. */
  generate: (workspaceId: string) =>
    post<PovResponse>(`/api/workspaces/${workspaceId}/strategy-pov/generate`, {}),

  /** Force a fresh draft (bypass cache). */
  regenerate: (workspaceId: string) =>
    post<PovResponse>(`/api/workspaces/${workspaceId}/strategy-pov/regenerate`, {}),

  /** Operator edit → bumps version, persists override. */
  edit: (workspaceId: string, edit: StrategyPovEdit) =>
    patch<PovResponse>(`/api/workspaces/${workspaceId}/strategy-pov`, edit),
};
