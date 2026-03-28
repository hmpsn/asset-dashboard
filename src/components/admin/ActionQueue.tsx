import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useActionQueue } from '../../hooks/admin/useActionQueue.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Skeleton } from '../ui/Skeleton.js';
import { put } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';
import { AlertTriangle, Clock, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { AnalyticsInsight } from '../../../shared/types/analytics.js';

interface Props {
  workspaceId: string;
}

// Severity badge colors following Three Laws of Color
const severityBadge = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  opportunity: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  positive: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
} as const;

export function ActionQueue({ workspaceId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useActionQueue(workspaceId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const resolveMutation = useMutation({
    mutationFn: ({ insightId, status, note }: { insightId: string; status: 'in_progress' | 'resolved'; note?: string }) =>
      put(`/api/insights/${workspaceId}/${insightId}/resolve`, { status, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.actionQueue(workspaceId) });
    },
  });

  const items: AnalyticsInsight[] = data?.items ?? [];

  if (isLoading) {
    return (
      <SectionCard title="Action Queue" titleIcon={<AlertTriangle className="w-4 h-4 text-zinc-400" />}>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  if (!items.length) {
    return (
      <SectionCard title="Action Queue" titleIcon={<AlertTriangle className="w-4 h-4 text-zinc-400" />}>
        <EmptyState
          icon={CheckCircle}
          title="All caught up"
          description="No unresolved critical or warning insights at this time"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`Action Queue (${items.length})`} titleIcon={<AlertTriangle className="w-4 h-4 text-zinc-400" />}>
      <div className="space-y-2">
        {items.map(item => {
          const isExpanded = expandedId === item.id;
          const sev = item.severity as keyof typeof severityBadge;
          const badgeClass = severityBadge[sev] ?? severityBadge.warning;
          const note = noteInputs[item.id] ?? '';

          return (
            <div key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40">
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-800/30 rounded-lg transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${badgeClass} shrink-0`}>
                  {item.severity}
                </span>
                <span className="text-sm text-zinc-200 flex-1 text-left truncate">
                  {item.pageTitle ?? item.pageId ?? 'Unknown page'}
                </span>
                {/* Impact score — blue for data */}
                <span className="text-xs text-blue-400 font-mono shrink-0">
                  {item.impactScore ?? 0}
                </span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
              </button>

              {/* Expanded resolution panel */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-zinc-800/60 pt-3">
                  <p className="text-xs text-zinc-400">
                    Type: <span className="text-zinc-300">{item.insightType}</span>
                    {' · '}Domain: <span className="text-zinc-300">{item.domain ?? '—'}</span>
                  </p>

                  {/* Note input */}
                  <input
                    type="text"
                    placeholder="Add a resolution note (optional)..."
                    value={note}
                    onChange={e => setNoteInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-full text-xs bg-zinc-800/60 border border-zinc-700/50 rounded px-2.5 py-1.5 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
                  />

                  {/* Resolution buttons — teal for actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolveMutation.mutate({ insightId: item.id, status: 'in_progress', note: note || undefined })}
                      disabled={resolveMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 border border-zinc-600/50 transition-colors disabled:opacity-50"
                    >
                      <Clock className="w-3 h-3" />
                      In Progress
                    </button>
                    <button
                      onClick={() => resolveMutation.mutate({ insightId: item.id, status: 'resolved', note: note || undefined })}
                      disabled={resolveMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600/20 text-teal-300 hover:bg-teal-600/30 border border-teal-500/30 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Mark Resolved
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
