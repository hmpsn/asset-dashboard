import { useQuery } from '@tanstack/react-query';
import type { ChatUsageResponse } from '../../../shared/types/usage';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';

export function useClientChatUsage(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.client.chatUsage(workspaceId ?? ''),
    queryFn: () => get<ChatUsageResponse>(`/api/public/chat-usage/${workspaceId}`),
    enabled: enabled && !!workspaceId,
  });
}
