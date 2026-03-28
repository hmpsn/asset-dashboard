import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import type { QueueItem } from '../../components/ProcessingQueue';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export const QUEUE_KEY = queryKeys.admin.queue();

export function useQueue() {
  return useQuery<QueueItem[]>({
    queryKey: QUEUE_KEY,
    queryFn: () => get<QueueItem[]>('/api/queue'),
    staleTime: STALE_TIMES.FAST,
  });
}
