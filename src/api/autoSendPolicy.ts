import { get, patch } from './client';
import type {
  AutoSendEligibleArchetype,
  AutoSendPolicyResponse,
} from '../../shared/types/strategy-autosend';

/**
 * Trust-ladder auto-send policy API (The Issue, Phase 4).
 *
 * - GET resolves the per-archetype trust state for the 2 eligible buckets
 *   (quick_win, technical) — earned/enabled/consecutiveCycles.
 * - PATCH flips a single archetype's `enabled` reward. The server rejects
 *   enabling a not-yet-earned (or ineligible) archetype, so the mutation can
 *   throw — handle via useMutation onError.
 */
export const autoSendPolicyApi = {
  get: (workspaceId: string): Promise<AutoSendPolicyResponse> =>
    get<AutoSendPolicyResponse>(`/api/auto-send-policy/${workspaceId}`),

  setEnabled: (
    workspaceId: string,
    archetype: AutoSendEligibleArchetype,
    enabled: boolean,
  ): Promise<AutoSendPolicyResponse> =>
    patch<AutoSendPolicyResponse>(
      `/api/auto-send-policy/${workspaceId}/${archetype}`,
      { enabled },
    ),
};

/** Thin functional aliases matching the lane contract. */
export const getAutoSendPolicy = (workspaceId: string) =>
  autoSendPolicyApi.get(workspaceId);

export const setAutoSendPolicy = (
  workspaceId: string,
  archetype: AutoSendEligibleArchetype,
  enabled: boolean,
) => autoSendPolicyApi.setEnabled(workspaceId, archetype, enabled);
