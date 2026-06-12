/**
 * R2-B — Agency work feed hooks.
 *
 * useClientActivityFeed  — paginated client-visible activity (last 30 entries, 14-day window).
 * useClientJobs          — currently-running client-visible background jobs.
 *
 * Both are React Query queries; cache invalidation wires through the central
 * ClientDashboard useWorkspaceEvents handler (JOB_CREATED / JOB_UPDATED for jobs,
 * ACTIVITY_NEW for activity — both halves of the broadcast contract are in place).
 */
import { useQuery } from '@tanstack/react-query';
import { fetchClientActivityFeed, fetchClientJobs } from '../../api/analytics.js';
import type { ClientActivityEntry, ClientJobEntry } from '../../api/analytics.js';
import { queryKeys } from '../../lib/queryKeys.js';

/**
 * Fetch the last `limit` client-visible activity entries.
 * 30-second staleTime — activity refreshes on ACTIVITY_NEW WS broadcasts,
 * so a moderate stale window is fine for background re-fetch avoidance.
 */
export function useClientActivityFeed(workspaceId: string, limit = 30) {
  return useQuery<ClientActivityEntry[]>({
    queryKey: queryKeys.client.activity(workspaceId),
    queryFn: () => fetchClientActivityFeed(workspaceId, limit, 0),
    staleTime: 30 * 1000,
    enabled: !!workspaceId,
  });
}

/**
 * Fetch active client-visible background jobs.
 * Short staleTime (10 s) because WS events already trigger invalidation;
 * this catches the case where the client reconnects mid-job.
 */
export function useClientJobs(workspaceId: string) {
  return useQuery<ClientJobEntry[]>({
    queryKey: queryKeys.client.jobs(workspaceId),
    queryFn: () => fetchClientJobs(workspaceId),
    staleTime: 10 * 1000,
    enabled: !!workspaceId,
  });
}
