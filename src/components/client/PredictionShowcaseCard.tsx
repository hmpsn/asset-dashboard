import { Trophy, TrendingUp, Calendar } from 'lucide-react'; // trend-icon-ok — this icon is narrative decoration ("we predicted"), not a directional metric trend indicator.
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
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
      titleIcon={<Icon as={Trophy} size="md" className="text-accent-brand" />}
    >
      <div className="space-y-3">
        {items.map((p) => (
          <div
            key={p.actionId}
            className="bg-teal-500/5 border border-teal-500/10 rounded-[var(--radius-xl)] p-4 space-y-2"
          >
            {/* What we predicted */}
            <div className="flex items-start gap-2">
              <Icon as={TrendingUp} size="md" className="text-accent-brand flex-shrink-0 mt-0.5" />
              <p className="t-body text-[var(--brand-text-bright)] leading-snug">
                We predicted <span className="font-medium text-[var(--brand-text-bright)]">{p.prediction}</span>
              </p>
            </div>

            {/* What actually happened */}
            <p className="t-body text-accent-brand pl-6 leading-snug">
              Result: {p.outcome}
            </p>

            {/* Date measured */}
            <div className="flex items-center gap-1.5 pl-6 t-caption text-[var(--brand-text-muted)]">
              <Icon as={Calendar} size="sm" />
              <span>Confirmed {formatDate(p.measuredAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
