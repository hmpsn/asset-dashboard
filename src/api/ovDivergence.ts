// src/api/ovDivergence.ts
// Typed fetch wrapper for the OV divergence admin endpoint.
// Admin-only — not called from client-facing components.

import { get } from './client';
import type { OvDivergence } from '../../server/ov-divergence.js';

export interface OvDivergenceListResponse {
  workspaceId: string;
  rows: OvDivergence[];
  count: number;
}

export const ovDivergenceApi = {
  /**
   * Fetch recent OV divergence rows for a workspace.
   * Admin-only endpoint — protected by the global APP_PASSWORD gate.
   */
  list(
    workspaceId: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<OvDivergenceListResponse> {
    const qs = limit != null ? `?limit=${limit}` : '';
    return get<OvDivergenceListResponse>(
      `/api/ov-divergence/${workspaceId}${qs}`,
      signal,
    );
  },
};
