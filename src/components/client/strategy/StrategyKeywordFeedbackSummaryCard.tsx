import { CheckCircle2, MessageSquareText, XCircle } from 'lucide-react';
import type { ClientKeywordFeedbackSummary } from '../../../../shared/types/intelligence';
import { Badge, Icon, SectionCard } from '../../ui';

interface StrategyKeywordFeedbackSummaryCardProps {
  summary: ClientKeywordFeedbackSummary;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sampleLabel(value: string): string {
  return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

export function StrategyKeywordFeedbackSummaryCard({ summary }: StrategyKeywordFeedbackSummaryCardProps) {
  const total = summary.approvedCount + summary.rejectedCount;
  const approveRate = clampRate(summary.approveRate);
  const approvePercent = Math.round(approveRate * 100);

  if (total === 0) return null;

  return (
    <SectionCard
      title="Keyword Feedback"
      titleIcon={<Icon as={MessageSquareText} size="md" className="text-blue-400" />}
      action={
        <Badge
          tone="blue"
          variant="soft"
          shape="pill"
          label={pluralize(total, 'review')}
          ariaLabel={`${pluralize(total, 'keyword review')} recorded`}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="t-body text-[var(--brand-text-bright)]">
              You approved <span className="font-semibold text-blue-400">{approvePercent}%</span> of keyword suggestions.
            </p>
            <p className="t-caption text-[var(--brand-text-muted)] mt-1">
              {pluralize(summary.approvedCount, 'keyword')} marked relevant, {pluralize(summary.rejectedCount, 'keyword')} marked not relevant.
            </p>
            </div>
            <div className="flex items-center gap-2 text-blue-400">
              <Icon as={CheckCircle2} size="sm" />
              <span className="t-body font-semibold">{approvePercent}%</span>
            </div>
          </div>

        <div
          className="h-2 w-full overflow-hidden bg-[var(--surface-3)] rounded-[var(--radius-pill)]"
          role="progressbar"
          aria-label="Keyword suggestion approval rate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={approvePercent}
        >
          <div
            className="h-full bg-blue-500 rounded-[var(--radius-pill)]"
            style={{ width: `${approvePercent}%` }}
          />
        </div>

        {summary.approvedSamples.length > 0 && (
          <div className="space-y-2">
            <p className="t-label text-[var(--brand-text-muted)]">Recent relevant themes</p>
            <div className="flex flex-wrap gap-2">
              {summary.approvedSamples.map(keyword => (
                <Badge key={keyword} tone="blue" variant="outline" shape="pill" label={sampleLabel(keyword)} />
              ))}
            </div>
          </div>
        )}

        {(summary.rejectedSamples.length > 0 || summary.rejectionReasons.length > 0) && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[var(--brand-text-muted)]">
              <Icon as={XCircle} size="sm" />
              <p className="t-label">Not relevant signals</p>
            </div>
            {summary.rejectedSamples.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {summary.rejectedSamples.map(keyword => (
                  <Badge key={keyword} tone="zinc" variant="outline" shape="pill" label={sampleLabel(keyword)} />
                ))}
              </div>
            )}
            {summary.rejectionReasons.length > 0 && (
              <p className="t-caption text-[var(--brand-text-muted)]">
                Common reason: {summary.rejectionReasons.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
