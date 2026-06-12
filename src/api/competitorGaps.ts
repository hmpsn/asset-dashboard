// ── Competitor gaps API client ─────────────────────────────────────────────
// Typed wrapper for the Premium competitor-benchmarking public endpoint.
// Tier-gated server-side (free + growth → 402); the projection is client-safe
// (no raw volume/difficulty, no money/EMV).

import { get } from './client';
import type { ClientCompetitorGapsResponse } from '../../shared/types/competitor-gaps';

export const competitorGapsApi = {
  /** Premium-only: client-safe competitor keyword gaps for the workspace. */
  getGaps: (workspaceId: string) =>
    get<ClientCompetitorGapsResponse>(`/api/public/competitor-gaps/${workspaceId}`),
};
