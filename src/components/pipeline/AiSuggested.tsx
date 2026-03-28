import { useAiSuggestedBriefs } from '../../hooks/admin/useAiSuggestedBriefs.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge } from '../ui/Badge.js';
import { Sparkles, FileText, RefreshCw } from 'lucide-react';

interface Props {
  workspaceId: string;
  onCreateBrief?: (keyword: string, pageUrl?: string) => void;
}

const iconMap: Record<string, typeof FileText> = {
  suggested_brief: FileText,
  refresh_suggestion: RefreshCw,
};

export function AiSuggested({ workspaceId, onCreateBrief }: Props) {
  const { data, isLoading } = useAiSuggestedBriefs(workspaceId);
  const signals = data?.signals ?? [];

  if (isLoading) {
    return (
      <SectionCard
        title="AI Suggested"
        titleIcon={<Sparkles className="w-4 h-4 text-teal-400" />}
      >
        <div className="animate-pulse space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-12 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!signals.length) {
    return (
      <SectionCard
        title="AI Suggested"
        titleIcon={<Sparkles className="w-4 h-4 text-teal-400" />}
      >
        <EmptyState
          icon={Sparkles}
          title="No suggestions yet"
          description="Suggestions appear when the insight engine finds content opportunities"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="AI Suggested"
      titleIcon={<Sparkles className="w-4 h-4 text-teal-400" />}
      titleExtra={<Badge label={`${signals.length}`} color="teal" />}
    >
      <div className="space-y-2">
        {signals.slice(0, 8).map(signal => {
          const Icon = iconMap[signal.type] ?? FileText;
          return (
            <div
              key={signal.insightId}
              className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors"
            >
              <Icon className="w-4 h-4 mt-0.5 text-teal-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {signal.pageTitle ?? signal.keyword ?? 'Untitled'}
                  </span>
                  <Badge
                    label={signal.type === 'suggested_brief' ? 'New Brief' : 'Refresh'}
                    color={signal.type === 'suggested_brief' ? 'blue' : 'amber'}
                  />
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{signal.detail}</p>
              </div>
              {onCreateBrief && signal.type === 'suggested_brief' && (
                <button
                  onClick={() => onCreateBrief(signal.keyword ?? '', signal.pageUrl)}
                  className="text-xs px-2 py-1 rounded bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 transition-colors shrink-0"
                >
                  Create Brief
                </button>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
