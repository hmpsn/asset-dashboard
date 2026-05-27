import { RefreshCw } from 'lucide-react';
import { Badge, Icon, SectionCard } from '../../ui';
import type { KeywordStrategyRefreshSummary } from '../../../../shared/types/keyword-strategy-ux.js';
import { formatDate } from '../../../utils/formatDates';

interface StrategyRefreshSummarySectionProps {
  summary: KeywordStrategyRefreshSummary;
}

export function StrategyRefreshSummarySection({ summary }: StrategyRefreshSummarySectionProps) {
  const retired = summary.deprecated + summary.replaced;
  const totalNew = summary.added + summary.newContentGaps;
  const hasChanges = totalNew > 0 || summary.reassigned > 0 || retired > 0 || summary.resolvedContentGaps > 0;
  if (!hasChanges && summary.retained === 0 && summary.preserved === 0) return null;

  return (
    <SectionCard
      title="What changed"
      titleIcon={<Icon as={RefreshCw} size="md" className="text-accent-brand" />}
      titleExtra={summary.currentGeneratedAt ? (
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          Refreshed {formatDate(summary.currentGeneratedAt)}
        </span>
      ) : undefined}
    >
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <SummaryTile label="New" value={totalNew} tone="emerald" />
        <SummaryTile label="Still watching" value={summary.retained} tone="blue" />
        <SummaryTile label="Moved" value={summary.reassigned} tone="amber" />
        <SummaryTile label="Retired" value={retired} tone="red" />
        <SummaryTile label="Preserved" value={summary.preserved} tone="teal" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {totalNew > 0 && <Badge tone="emerald" size="sm" label={`${totalNew} new opportunity${totalNew === 1 ? '' : 'ies'}`} />}
        {summary.reassigned > 0 && <Badge tone="amber" size="sm" label={`${summary.reassigned} page move${summary.reassigned === 1 ? '' : 's'}`} />}
        {retired > 0 && <Badge tone="red" size="sm" label={`${retired} retired from active tracking`} />}
        {summary.preserved > 0 && <Badge tone="teal" size="sm" label={`${summary.preserved} manually preserved`} />}
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 leading-relaxed">
        We keep historical tracking intact, but active strategy views focus on the keywords we are currently watching and acting on.
      </p>
    </SectionCard>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'blue' | 'amber' | 'red' | 'teal' }) {
  const color = {
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    teal: 'text-teal-400',
  }[tone];
  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2">
      <div className={`t-page font-semibold ${color}`}>{value}</div>
      <div className="t-caption-sm text-[var(--brand-text-muted)]">{label}</div>
    </div>
  );
}
