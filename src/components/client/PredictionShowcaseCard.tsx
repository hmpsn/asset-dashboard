import { Calendar, CheckCircle2, FileText, Target, Trophy } from 'lucide-react';
import { Badge, Icon, SectionCard } from '../ui';
import { EmptyState } from '../ui/EmptyState';
import type { WeCalledItEntry } from '../../../shared/types/intelligence';

interface PredictionShowcaseCardProps {
  predictions: WeCalledItEntry[] | null | undefined;
}

function scoreLabel(score: WeCalledItEntry['score']): string {
  return score
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function scoreTone(score: WeCalledItEntry['score']): 'emerald' | 'blue' {
  return score === 'strong_win' ? 'emerald' : 'blue';
}

function looksLikeEnum(value: string): boolean {
  return /^[a-z]+(?:_[a-z]+)+$/.test(value);
}

function outcomeCopy(entry: WeCalledItEntry): string {
  if (!entry.outcome || entry.outcome === entry.score || looksLikeEnum(entry.outcome)) {
    return `${scoreLabel(entry.score)} confirmed for this recommendation.`;
  }
  return entry.outcome;
}

function formatMeasuredDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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
      <div className="space-y-5">
        {items.map((p) => (
          <div
            key={p.actionId}
            className="space-y-3 border-t border-[var(--brand-border)] pt-5 first:border-t-0 first:pt-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={scoreTone(p.score)}
                variant="soft"
                shape="pill"
                icon={CheckCircle2}
                label={scoreLabel(p.score)}
              />
              {p.pageUrl && (
                <span className="t-caption text-[var(--brand-text-muted)]">
                  {p.pageUrl}
                </span>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[var(--brand-text-muted)]">
                  <Icon as={Target} size="sm" />
                  <span className="t-label">Before</span>
                </div>
                <p className="t-body text-[var(--brand-text-bright)] leading-snug">
                  We predicted {p.prediction}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[var(--brand-text-muted)]">
                  <Icon as={CheckCircle2} size="sm" />
                  <span className="t-label">After</span>
                </div>
                <p className="t-body text-accent-brand leading-snug">
                  {outcomeCopy(p)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 t-caption text-[var(--brand-text-muted)]">
              {p.pageUrl && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon as={FileText} size="sm" />
                  {p.pageUrl}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Calendar} size="sm" />
                Confirmed {formatMeasuredDate(p.measuredAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
