import { Trophy, TrendingUp, Calendar } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import type { WeCalledItEntry } from '../../../shared/types/intelligence';

interface PredictionShowcaseCardProps {
  predictions: WeCalledItEntry[] | null | undefined;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export function PredictionShowcaseCard({ predictions }: PredictionShowcaseCardProps) {
  const items = predictions?.slice(0, 5) ?? [];

  if (items.length === 0) {
    return (
      <SectionCard title="Predictions That Came True">
        <EmptyState
          icon={Trophy}
          title="Building your prediction track record"
          description="As our strategy recommendations play out, we'll showcase the wins here."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Predictions That Came True"
      titleIcon={<Trophy className="w-4 h-4 text-teal-400" />}
    >
      <div className="space-y-3">
        {items.map((p) => (
          <div
            key={p.actionId}
            className="bg-teal-500/5 border border-teal-500/10 rounded-xl p-4 space-y-2"
          >
            {/* What we predicted */}
            <div className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-zinc-200 leading-snug">
                We predicted <span className="font-medium text-zinc-100">{p.prediction}</span>
              </p>
            </div>

            {/* What actually happened */}
            <p className="text-sm text-teal-400 pl-6 leading-snug">
              Result: {p.outcome}
            </p>

            {/* Date measured */}
            <div className="flex items-center gap-1.5 pl-6 text-xs text-zinc-500">
              <Calendar className="w-3 h-3" />
              <span>Confirmed {formatDate(p.measuredAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
