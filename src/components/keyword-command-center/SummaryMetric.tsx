import type { LucideIcon } from 'lucide-react';

import { Icon, SectionCard, Stat, cn } from '../ui';

interface SummaryMetricProps {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: 'teal' | 'blue' | 'amber' | 'zinc';
}

export function SummaryMetric({ label, value, icon: MetricIcon, tone }: SummaryMetricProps) {
  const toneClass = {
    teal: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400/80 bg-amber-500/10 border-amber-500/20',
    zinc: 'text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-[var(--brand-border)]',
  }[tone];

  return (
    <SectionCard className="min-w-0" noPadding variant="subtle">
      <div className="p-3 flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-[var(--radius-lg)] border flex items-center justify-center', toneClass)}>
          <Icon as={MetricIcon} size="md" />
        </div>
        <div className="min-w-0">
          <Stat size="sm" className="text-[var(--brand-text-bright)] tabular-nums">{value}</Stat>
          <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{label}</p>
        </div>
      </div>
    </SectionCard>
  );
}
