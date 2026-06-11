/**
 * React Query hook for lightweight workspace badge counts.
 *
 * Replaces the raw get()+useState pattern in App.tsx so the sidebar
 * Pipeline badge, Breadcrumbs request widget, and amber banner all
 * derive from a shared cache that WebSocket CONTENT_REQUEST_* events
 * can invalidate via useWsInvalidation.
 */

import { useQuery } from '@tanstack/react-query';
import { workspaceBadges, type WorkspaceBadges } from '../../api/platform';
import { queryKeys } from '../../lib/queryKeys';

export function useWorkspaceBadges(workspaceId: string | undefined) {
  return useQuery<WorkspaceBadges>({
    queryKey: queryKeys.admin.workspaceBadges(workspaceId ?? ''),
    queryFn: () => workspaceBadges.get(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
