/**
 * React Query hook for content calendar data
 * Replaces manual useEffect fetch pattern in ContentCalendar.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { contentBriefs, contentPosts, contentRequests, contentMatrices } from '../../api/content.js';

interface CalendarBrief {
  id: string;
  targetKeyword: string;
  suggestedTitle: string;
  createdAt: string;
}

interface CalendarPost {
  id: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  status: 'generating' | 'draft' | 'review' | 'approved';
  totalWordCount: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CalendarRequest {
  id: string;
  topic: string;
  targetKeyword: string;
  status: string;
  serviceType?: string;
  requestedAt: string;
  updatedAt: string;
}

type ItemType = 'brief' | 'post' | 'request' | 'matrix';

interface CalendarItem {
  id: string;
  type: ItemType;
  label: string;
  sublabel: string;
  status: string;
  date: string; // ISO date string
  publishedAt?: string;
}

export function useContentCalendar(workspaceId: string) {
  return useQuery({
    queryKey: ['content-calendar', workspaceId],
    queryFn: async (): Promise<CalendarItem[]> => {
      const [briefsData, postsData, requestsData, matricesData] = await Promise.all([
        contentBriefs.list(workspaceId).catch(() => []),
        contentPosts.list(workspaceId).catch(() => []),
        contentRequests.list(workspaceId).catch(() => []),
        contentMatrices.list(workspaceId).catch(() => []),
      ]);

      const allItems: CalendarItem[] = [];

      // Process briefs
      for (const b of briefsData as CalendarBrief[]) {
        allItems.push({
          id: b.id,
          type: 'brief',
          label: b.suggestedTitle || b.targetKeyword,
          sublabel: b.targetKeyword,
          status: 'created',
          date: b.createdAt,
        });
      }

      // Process posts
      for (const p of postsData as CalendarPost[]) {
        allItems.push({
          id: p.id,
          type: 'post',
          label: p.title,
          sublabel: p.targetKeyword,
          status: p.status,
          date: p.publishedAt || p.createdAt,
          publishedAt: p.publishedAt,
        });
      }

      // Process requests
      for (const r of requestsData as CalendarRequest[]) {
        allItems.push({
          id: r.id,
          type: 'request',
          label: r.topic,
          sublabel: r.targetKeyword,
          status: r.status,
          date: r.requestedAt,
        });
      }

      // Process matrices
      for (const m of matricesData as { id: string; name: string; cells: any[]; updatedAt: string; status?: string; createdAt?: string }[]) {
        allItems.push({
          id: m.id,
          type: 'matrix',
          label: m.name || 'Content Matrix',
          sublabel: `${m.cells?.length || 0} cells`,
          status: m.status || 'created',
          date: m.createdAt || m.updatedAt,
        });
      }

      return allItems;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!workspaceId,
    retry: 2,
  });
}
