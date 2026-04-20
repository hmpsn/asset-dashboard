import { Globe } from 'lucide-react';
import type { CwvSummary, CwvStrategyResult } from './types';

interface CwvSummaryCardProps {
  cwvSummary: CwvSummary;
}

const ratingColor = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
  r === 'good' ? 'text-emerald-400' : r === 'needs-improvement' ? 'text-amber-400' : r === 'poor' ? 'text-red-400' : 'text-zinc-500';

const ratingBg = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
  r === 'good' ? 'bg-emerald-500/10 border-emerald-500/30' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/30' : r === 'poor' ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/50 border-zinc-700/30';

const assessBadge = (a: CwvStrategyResult['assessment']) =>
  a === 'good' ? { text: 'Passed', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
  : a === 'needs-improvement' ? { text: 'Needs Work', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
  : a === 'poor' ? { text: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
  : { text: 'No Data', cls: 'bg-zinc-800/50 text-zinc-500 border-zinc-700/30' };

const renderStrategy = (label: string, s: CwvStrategyResult) => {
  const badge = assessBadge(s.assessment);
  return (
    <div key={label} className="flex-1 min-w-[260px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-zinc-400 tracking-wider">{label}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>{badge.text}</span>
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
            <div key={m.key} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${ratingBg(metric.rating)}`}>
              <div>
                <span className="text-xs font-medium text-zinc-300">{m.label}</span>
                <span className="text-[11px] text-zinc-500 ml-1.5">{m.desc}</span>
              </div>
              <span className={`text-sm font-mono font-medium ${ratingColor(metric.rating)}`}>
                {metric.value !== null ? m.fmt(metric.value) : '—'}
              </span>
            </div>
          );
        })}
      </div>
      {/* Lighthouse lab score — secondary */}
      <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
        <span className="text-[11px] text-zinc-500">Lighthouse Lab Score</span>
        <span className={`text-xs font-mono font-medium ${s.lighthouseScore >= 90 ? 'text-emerald-400' : s.lighthouseScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
          {s.lighthouseScore}/100
        </span>
      </div>
      {!s.fieldDataAvailable && (
        <div className="mt-1.5 text-[11px] text-zinc-500 italic px-1">
          No real-user data (CrUX) — metrics are from lab simulation
        </div>
      )}
    </div>
  );
};

export function CwvSummaryCard({ cwvSummary }: CwvSummaryCardProps) {
  if (!cwvSummary.mobile && !cwvSummary.desktop) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-zinc-300">Core Web Vitals</span>
        <span className="text-[11px] text-zinc-500">— Google ranking signal (real-user data)</span>
      </div>
      <div className="flex gap-4 flex-wrap">
        {cwvSummary.mobile && renderStrategy('Mobile', cwvSummary.mobile)}
        {cwvSummary.desktop && renderStrategy('Desktop', cwvSummary.desktop)}
      </div>
    </div>
  );
}
