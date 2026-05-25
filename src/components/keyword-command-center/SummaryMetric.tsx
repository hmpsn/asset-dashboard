import type { LucideIcon } from 'lucide-react';

import { StatCard } from '../ui';

interface SummaryMetricProps {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: 'teal' | 'blue' | 'amber' | 'zinc';
}

export function SummaryMetric({ label, value, icon: MetricIcon, tone }: SummaryMetricProps) {
  const iconColor = {
    teal: 'var(--teal)',
    blue: 'var(--blue)',
    amber: 'var(--amber)',
    zinc: 'var(--brand-text-muted)',
  }[tone];

  return (
    <StatCard
      label={label}
      value={value}
      icon={MetricIcon}
      iconColor={iconColor}
      className="min-w-0"
    />
  );
}
