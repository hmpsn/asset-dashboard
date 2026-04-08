import { FileText } from 'lucide-react';
import { useAdminMeetingBrief } from '../../../hooks/admin/useAdminMeetingBrief';
import { SectionCard } from '../../ui/SectionCard';
import { Skeleton } from '../../ui/Skeleton';
import { EmptyState } from '../../ui/EmptyState';
import { BriefHeader } from './BriefHeader';
import { AtAGlanceStrip } from './AtAGlanceStrip';
import { BriefSection } from './BriefSection';
import { RecommendationsList } from './RecommendationsList';
import { BlueprintProgress } from './BlueprintProgress';

interface Props {
  workspaceId: string;
}

function BriefSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="grid grid-cols-5 gap-3 mt-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-3 w-1/4 mt-6" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function MeetingBriefPage({ workspaceId }: Props) {
  const { brief, isLoading, isError, generate, isGenerating } = useAdminMeetingBrief(workspaceId);

  if (isLoading) {
    return (
      <SectionCard>
        <BriefSkeleton />
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard>
        <EmptyState
          icon={FileText}
          title="Couldn't load brief"
          description="Something went wrong loading the meeting brief. Try again."
          action={
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Retry
            </button>
          }
        />
      </SectionCard>
    );
  }

  if (!brief) {
    return (
      <SectionCard>
        <EmptyState
          icon={FileText}
          title="No meeting brief yet"
          description="Generate a brief before your next client call. Takes about 10 seconds."
          action={
            <button
              onClick={() => generate()}
              disabled={isGenerating}
              className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating\u2026' : 'Generate First Brief'}
            </button>
          }
        />
        {isGenerating && (
          <div className="mt-6">
            <p className="text-xs text-zinc-500 text-center mb-4">Analyzing site performance\u2026</p>
            <BriefSkeleton />
          </div>
        )}
      </SectionCard>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <BriefHeader
        generatedAt={brief.generatedAt}
        onRegenerate={() => generate()}
        isGenerating={isGenerating}
      />

      {isGenerating && (
        <SectionCard className="mb-6">
          <p className="text-xs text-zinc-500 text-center mb-4">Analyzing site performance\u2026</p>
          <BriefSkeleton />
        </SectionCard>
      )}

      {!isGenerating && (
        <SectionCard>
          <div className="mb-6">
            <p className="text-sm text-zinc-200 leading-relaxed">{brief.situationSummary}</p>
          </div>
          <AtAGlanceStrip metrics={brief.metrics} />
          <BriefSection title="Wins Since Last Review" items={brief.wins} />
          <BriefSection title="What Needs Attention" items={brief.attention} />
          <RecommendationsList items={brief.recommendations} />
          <BlueprintProgress progress={brief.blueprintProgress} />
        </SectionCard>
      )}
    </div>
  );
}
