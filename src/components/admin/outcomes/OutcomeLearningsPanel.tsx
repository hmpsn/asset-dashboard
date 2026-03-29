import { Brain, FileText, Target, Wrench, TrendingUp } from 'lucide-react';
import { SectionCard, Badge, EmptyState, Skeleton, SectionCardSkeleton } from '../../ui';
import { useOutcomeLearnings } from '../../../hooks/admin/useOutcomes';
import type {
  ContentLearnings,
  StrategyLearnings,
  TechnicalLearnings,
  LearningsConfidence,
} from '../../../../shared/types/outcome-tracking';

interface Props {
  workspaceId: string;
}

function confidenceColor(confidence: LearningsConfidence): 'green' | 'amber' | 'red' {
  if (confidence === 'high') return 'green';
  if (confidence === 'medium') return 'amber';
  return 'red';
}

function confidenceLabel(confidence: LearningsConfidence): string {
  if (confidence === 'high') return 'High Confidence';
  if (confidence === 'medium') return 'Medium Confidence';
  return 'Low Confidence';
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatWinRateRecord(record: Record<string, number>): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([key, val]) => ({ label: key.replace(/_/g, ' '), value: pct(val) }));
}

function NoDataMessage({ message = 'Not enough data yet' }: { message?: string }) {
  return (
    <p className="text-xs text-zinc-600 italic py-2">{message}</p>
  );
}

interface ContentSectionProps {
  data: ContentLearnings;
}

function ContentSection({ data }: ContentSectionProps) {
  const formatWins = formatWinRateRecord(data.winRateByFormat);

  return (
    <SectionCard
      title="Content"
      titleIcon={<FileText className="w-4 h-4 text-blue-400" />}
      staggerIndex={1}
    >
      <div className="space-y-4">
        {/* Win rate by format */}
        {formatWins.length > 0 ? (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Win Rate by Format</p>
            <div className="space-y-1.5">
              {formatWins.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 capitalize">{label}</span>
                  <span className="text-xs font-semibold text-emerald-400">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <NoDataMessage message="No format win-rate data yet" />
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Avg Days to Page 1</p>
            <p className="text-sm font-bold text-zinc-200">
              {data.avgDaysToPage1 !== null ? `${data.avgDaysToPage1}d` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Refresh Recovery Rate</p>
            <p className="text-sm font-bold text-zinc-200">{pct(data.refreshRecoveryRate)}</p>
          </div>
          {data.optimalWordCount && (
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Optimal Word Count</p>
              <p className="text-sm font-bold text-zinc-200">
                {data.optimalWordCount.min}–{data.optimalWordCount.max}
              </p>
            </div>
          )}
          {data.voiceScoreCorrelation !== null && (
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Voice Score Correlation</p>
              <p className="text-sm font-bold text-zinc-200">{data.voiceScoreCorrelation > 0 ? '+' : ''}{data.voiceScoreCorrelation.toFixed(1)} pts</p>
            </div>
          )}
        </div>

        {/* Best topics */}
        {data.bestPerformingTopics.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Best Performing Topics</p>
            <div className="flex flex-wrap gap-1.5">
              {data.bestPerformingTopics.slice(0, 6).map((topic) => (
                <Badge key={topic} label={topic} color="blue" />
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface StrategySectionProps {
  data: StrategyLearnings;
}

function StrategySection({ data }: StrategySectionProps) {
  const difficultyWins = formatWinRateRecord(data.winRateByDifficultyRange);
  const timeToRankEntries = Object.entries(data.avgTimeToRank)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 4);

  return (
    <SectionCard
      title="Strategy"
      titleIcon={<Target className="w-4 h-4 text-blue-400" />}
      staggerIndex={2}
    >
      <div className="space-y-4">
        {/* Win rate by difficulty */}
        {difficultyWins.length > 0 ? (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Win Rate by Difficulty</p>
            <div className="space-y-1.5">
              {difficultyWins.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 capitalize">{label}</span>
                  <span className="text-xs font-semibold text-emerald-400">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <NoDataMessage message="No difficulty win-rate data yet" />
        )}

        {/* Avg time to rank */}
        {timeToRankEntries.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Avg Time to Rank (days)</p>
            <div className="space-y-1.5">
              {timeToRankEntries.map(([range, days]) => (
                <div key={range} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 capitalize">{range.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-semibold text-blue-400">{Math.round(days)}d</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Volume sweet spot + best intent */}
        <div className="grid grid-cols-2 gap-3">
          {data.keywordVolumeSweetSpot && (
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Volume Sweet Spot</p>
              <p className="text-sm font-bold text-zinc-200">
                {data.keywordVolumeSweetSpot.min.toLocaleString()}–{data.keywordVolumeSweetSpot.max.toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* Best intent types */}
        {data.bestIntentTypes.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Best Intent Types</p>
            <div className="flex flex-wrap gap-1.5">
              {data.bestIntentTypes.slice(0, 5).map((intent) => (
                <Badge key={intent} label={intent} color="teal" />
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface TechnicalSectionProps {
  data: TechnicalLearnings;
}

function TechnicalSection({ data }: TechnicalSectionProps) {
  const fixTypeWins = formatWinRateRecord(data.winRateByFixType);

  return (
    <SectionCard
      title="Technical"
      titleIcon={<Wrench className="w-4 h-4 text-blue-400" />}
      staggerIndex={3}
    >
      <div className="space-y-4">
        {/* Win rate by fix type */}
        {fixTypeWins.length > 0 ? (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Win Rate by Fix Type</p>
            <div className="space-y-1.5">
              {fixTypeWins.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 capitalize">{label}</span>
                  <span className="text-xs font-semibold text-emerald-400">{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <NoDataMessage message="No fix-type win-rate data yet" />
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Avg Health Score Gain</p>
            <p className="text-sm font-bold text-zinc-200">+{data.avgHealthScoreImprovement.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Internal Link Effectiveness</p>
            <p className="text-sm font-bold text-zinc-200">{pct(data.internalLinkEffectiveness)}</p>
          </div>
        </div>

        {/* Schema types with rich results */}
        {data.schemaTypesWithRichResults.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Schema Types Driving Rich Results</p>
            <div className="flex flex-wrap gap-1.5">
              {data.schemaTypesWithRichResults.map((type) => (
                <Badge key={type} label={type} color="blue" />
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export default function OutcomeLearningsPanel({ workspaceId }: Props) {
  const { data: learnings, isLoading } = useOutcomeLearnings(workspaceId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Confidence header skeleton */}
        <div className="bg-zinc-900 border border-zinc-800 px-4 py-3 flex items-center gap-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <Skeleton className="w-5 h-5 rounded-lg" />
          <Skeleton className="w-32 h-3" />
          <div className="ml-auto">
            <Skeleton className="w-28 h-5 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SectionCardSkeleton lines={6} />
          <SectionCardSkeleton lines={6} />
          <SectionCardSkeleton lines={6} />
        </div>
      </div>
    );
  }

  if (!learnings) {
    return (
      <EmptyState
        icon={Brain}
        title="Learnings not available yet"
        description="As outcomes are measured and scored, the AI will surface patterns about what's working across your SEO actions."
      />
    );
  }

  const { content, strategy, technical, overall } = learnings;
  const hasAnySection = content !== null || strategy !== null || technical !== null;

  if (!hasAnySection) {
    return (
      <EmptyState
        icon={Brain}
        title="Building your learnings"
        description="More scored outcomes are needed before patterns can be identified. Keep acting on insights."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Confidence + overall stats header */}
      <SectionCard
        titleIcon={<Brain className="w-4 h-4 text-blue-400" />}
        title="AI Learnings"
        titleExtra={
          <Badge
            label={confidenceLabel(learnings.confidence)}
            color={confidenceColor(learnings.confidence)}
          />
        }
        action={
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-zinc-500" />
            <span className={`text-xs font-medium ${
              overall.recentTrend === 'improving'
                ? 'text-emerald-400'
                : overall.recentTrend === 'declining'
                ? 'text-red-400'
                : 'text-zinc-400'
            }`}>
              {overall.recentTrend}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Win Rate</p>
            <p className="text-xl font-bold text-emerald-400">{pct(overall.totalWinRate)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Strong Win Rate</p>
            <p className="text-xl font-bold text-zinc-200">{pct(overall.strongWinRate)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Scored Actions</p>
            <p className="text-xl font-bold text-blue-400">{learnings.totalScoredActions}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-0.5">Top Action</p>
            <p className="text-sm font-bold text-zinc-200 leading-tight">
              {overall.topActionTypes[0]
                ? overall.topActionTypes[0].type.replace(/_/g, ' ')
                : '—'}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Section panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {content !== null ? (
          <ContentSection data={content} />
        ) : (
          <SectionCard title="Content" titleIcon={<FileText className="w-4 h-4 text-blue-400" />} staggerIndex={1}>
            <NoDataMessage message="Not enough content action data yet" />
          </SectionCard>
        )}

        {strategy !== null ? (
          <StrategySection data={strategy} />
        ) : (
          <SectionCard title="Strategy" titleIcon={<Target className="w-4 h-4 text-blue-400" />} staggerIndex={2}>
            <NoDataMessage message="Not enough strategy action data yet" />
          </SectionCard>
        )}

        {technical !== null ? (
          <TechnicalSection data={technical} />
        ) : (
          <SectionCard title="Technical" titleIcon={<Wrench className="w-4 h-4 text-blue-400" />} staggerIndex={3}>
            <NoDataMessage message="Not enough technical action data yet" />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
