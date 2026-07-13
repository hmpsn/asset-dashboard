/**
 * React Query hook for content calendar data
 * Replaces manual useEffect fetch pattern in ContentCalendar.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { contentBriefs, contentPosts, contentRequests, contentMatrices } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';

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
  status: 'generating' | 'needs_attention' | 'draft' | 'review' | 'approved' | 'error';
  totalWordCount: number;
  publishedAt?: string;
  /** W6.6: admin-set planned/scheduled publish date for forward-planning. */
  plannedPublishAt?: string;
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

/**
 * W6.6: distinguishes how a post item is plotted on the calendar:
 *  - 'published' — plotted on publishedAt (historical record)
 *  - 'planned'   — plotted on plannedPublishAt (forward-planning intent)
 *  - 'created'   — plotted on createdAt (fallback for unscheduled drafts)
 * Briefs/requests/matrices are always 'created'.
 */
export type CalendarItemKind = 'published' | 'planned' | 'created';

export interface CalendarItem {
  id: string;
  type: ItemType;
  label: string;
  sublabel: string;
  status: string;
  date: string; // ISO date string
  publishedAt?: string;
  /** W6.6: how this item is plotted — drives visual treatment + future-month rendering. */
  kind: CalendarItemKind;
}

/**
 * W6.6: pure derivation of how a post item is plotted on the calendar and on which
 * date. Exported for unit testing. Published wins (historical record), then planned
 * (forward-looking intent), then created (unscheduled fallback).
 */
export function derivePostPlot(post: { publishedAt?: string; plannedPublishAt?: string; createdAt: string }): {
  kind: CalendarItemKind;
  date: string;
} {
  if (post.publishedAt) return { kind: 'published', date: post.publishedAt };
  if (post.plannedPublishAt) return { kind: 'planned', date: post.plannedPublishAt };
  return { kind: 'created', date: post.createdAt };
}

export function useContentCalendar(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.contentCalendar(workspaceId),
    queryFn: async (): Promise<CalendarItem[]> => {
      const [briefsData, postsData, requestsData, matricesData] = await Promise.all([
        contentBriefs.list(workspaceId),
        contentPosts.list(workspaceId),
        contentRequests.list(workspaceId),
        contentMatrices.list(workspaceId),
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
          kind: 'created',
        });
      }

      // Process posts — W6.6: plot on the most meaningful date.
      // Published posts plot on publishedAt ('published'). Unpublished posts with an
      // admin-set plannedPublishAt plot there ('planned', forward-looking). Everything
      // else falls back to createdAt ('created').
      for (const p of postsData as CalendarPost[]) {
        const { kind, date } = derivePostPlot(p);
        allItems.push({
          id: p.id,
          type: 'post',
          label: p.title,
          sublabel: p.targetKeyword,
          status: p.status,
          date,
          publishedAt: p.publishedAt,
          kind,
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
          kind: 'created',
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
          kind: 'created',
        });
      }

      return allItems;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!workspaceId,
    retry: 2,
  });
}
