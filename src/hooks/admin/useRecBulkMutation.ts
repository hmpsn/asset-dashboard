import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';

export interface BulkRecActionPayload {
  recIds: string[];
  action: 'send' | 'throttle' | 'strike';
  throttleDays?: 7 | 30 | 90;
  note?: string;
  confirmStrike?: boolean;
}

/**
 * Bulk lifecycle mutation for the curation cockpit (spec §4.4). Posts ALL N recIds to the
 * single bulk endpoint, which applies them in ONE server-side transaction via the Phase-1
 * single-writer — NOT N independent client requests. Bulk Strike still arm-then-confirms
 * (the caller passes confirmStrike:true only after the inline confirm). Invalidates both the
 * admin and shared rec caches so the cockpit + any public read refetch.
 */
export function useRecBulkMutation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BulkRecActionPayload): Promise<{ modified: number }> =>
      post<{ modified: number }>(`/api/recommendations/${workspaceId}/bulk`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
  });
}
