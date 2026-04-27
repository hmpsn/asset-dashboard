import { Globe } from 'lucide-react';
import { Icon, SectionCard, cn } from '../ui';
import type { CwvSummary, CwvStrategyResult } from './types';

interface CwvSummaryCardProps {
  cwvSummary: CwvSummary;
}

const ratingColor = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
  r === 'good' ? 'text-emerald-400' : r === 'needs-improvement' ? 'text-amber-400' : r === 'poor' ? 'text-red-400' : 'text-[var(--brand-text-muted)]';

const ratingBg = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
  r === 'good' ? 'bg-emerald-500/10 border-emerald-500/30' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/30' : r === 'poor' ? 'bg-red-500/10 border-red-500/30' : 'bg-[var(--surface-2)] border-[var(--brand-border)]';

const assessBadge = (a: CwvStrategyResult['assessment']) =>
  a === 'good' ? { text: 'Passed', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
  : a === 'needs-improvement' ? { text: 'Needs Work', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
  : a === 'poor' ? { text: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
  : { text: 'No Data', cls: 'bg-[var(--surface-2)] text-[var(--brand-text-muted)] border-[var(--brand-border)]' };

const renderStrategy = (label: string, s: CwvStrategyResult) => {
  const badge = assessBadge(s.assessment);
  return (
    <div key={label} className="flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-3">
        <span className="t-caption font-medium text-[var(--brand-text)] tracking-wider">{label}</span>
        <span className={cn('t-caption-sm px-2 py-0.5 rounded border font-medium', badge.cls)}>{badge.text}</span>
      </div>
      {/* CWV Metrics */}
      <div className="space-y-2">
        {[
          { key: 'LCP' as const, label: 'LCP', fmt: (v: number) => `${(v / 1000).toFixed(1)}s`, desc: 'Largest Contentful Paint' },
          { key: 'INP' as const, label: 'INP', fmt: (v: number) => `${Math.round(v)}ms`, desc: 'Interaction to Next Paint' },
          { key: 'CLS' as const, label: 'CLS', fmt: (v: number) => v.toFixed(2), desc: 'Cumulative Layout Shift' },
        ].map(m => {
          const metric = s.metrics[m.key];
          return (
            <div key={m.key} className={cn('flex items-center justify-between px-3 py-2 rounded-lg border', ratingBg(metric.rating))}>
              <div>
                <span className="t-caption font-medium text-[var(--brand-text-bright)]">{m.label}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">{m.desc}</span>
              </div>
              <span className={cn('t-mono font-medium', ratingColor(metric.rating))}>
                {metric.value !== null ? m.fmt(metric.value) : '—'}
              </span>
            </div>
          );
        })}
      </div>
      {/* Lighthouse lab score — secondary */}
      <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-950/50 border border-[var(--brand-border)]">
        <span className="t-caption-sm text-[var(--brand-text-muted)]">Lighthouse Lab Score</span>
        <span className={cn('t-mono font-medium', s.lighthouseScore >= 90 ? 'text-emerald-400' : s.lighthouseScore >= 50 ? 'text-amber-400' : 'text-red-400')}>
          {s.lighthouseScore}/100
        </span>
      </div>
      {!s.fieldDataAvailable && (
        <div className="mt-1.5 t-caption-sm text-[var(--brand-text-muted)] italic px-1">
          No real-user data (CrUX) — metrics are from lab simulation
        </div>
      )}
    </div>
  );
};

export function CwvSummaryCard({ cwvSummary }: CwvSummaryCardProps) {
  if (!cwvSummary.mobile && !cwvSummary.desktop) return null;

  return (
    <SectionCard>
      <div className="flex items-center gap-2 mb-4">
        <Icon as={Globe} size="md" className="text-blue-400" />
        <span className="t-body font-medium text-[var(--brand-text-bright)]">Core Web Vitals</span>
        <span className="t-caption-sm text-[var(--brand-text-muted)]">— Google ranking signal (real-user data)</span>
      </div>
      <div className="flex gap-4 flex-wrap">
        {cwvSummary.mobile && renderStrategy('Mobile', cwvSummary.mobile)}
        {cwvSummary.desktop && renderStrategy('Desktop', cwvSummary.desktop)}
      </div>
    </SectionCard>
  );
}
