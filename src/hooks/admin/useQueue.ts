import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import type { QueueItem } from '../../components/ProcessingQueue';

const QUEUE_KEY = ['admin-queue'] as const;

export function useQueue() {
  return useQuery<QueueItem[]>({
    queryKey: QUEUE_KEY,
    queryFn: () => get<QueueItem[]>('/api/queue'),
    staleTime: 30_000,
  });
}

export { QUEUE_KEY };
