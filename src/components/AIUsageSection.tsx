import { useState, useEffect } from 'react';
import { getOptional } from '../api/client';
import { Zap } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { SectionCard, Icon, cn, Button, EmptyState, Skeleton } from './ui';
import { chartAxisColor } from './ui/constants';
import { fmtNum } from '../utils/formatNumbers';

interface DailyUsage {
  date: string;
  cost: number;
  calls: number;
  totalTokens: number;
  openaiCost: number;
  anthropicCost: number;
  openaiTokens: number;
  anthropicTokens: number;
}

interface FeatureUsage {
  feature: string;
  calls: number;
  totalTokens: number;
  cost: number;
  provider: string;
}

interface DataForSeoUsage {
  totalCredits: number;
  totalCalls: number;
  cachedCalls: number;
}

interface DataForSeoDaily {
  date: string;
  credits: number;
  calls: number;
  cachedCalls: number;
}

interface AIUsageData {
  totalTokens: number;
  estimatedCost: number;
  daily: DailyUsage[];
  byFeature: FeatureUsage[];
  // P5 — served by GET /api/ai/usage but previously dropped by this component.
  dataforseo?: DataForSeoUsage;
  dataforseoDaily?: DataForSeoDaily[];
}

export function AIUsageSection({ compact = false }: { compact?: boolean } = {}) {
  const [data, setData] = useState<AIUsageData | null>(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getOptional<AIUsageData>(`/api/ai/usage?days=${days}`)
      .then(d => { if (active) setData(d); })
      .catch((err) => { console.error('WorkspaceOverview operation failed:', err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  const hasAiUsage = !!data && (data.totalTokens > 0 || data.daily.some(d => d.calls > 0));
  const hasSeoUsage = !!data?.dataforseo && data.dataforseo.totalCalls > 0;
  const usageTitleIcon = <Icon as={Zap} size="md" className="text-amber-400" />;

  if (loading) {
    return (
      <SectionCard title="AI Usage" titleIcon={usageTitleIcon}>
        <div aria-label="Loading AI usage" className="space-y-[14px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[84px] w-full" />)}
          </div>
          <Skeleton className="h-[150px] w-full" />
        </div>
      </SectionCard>
    );
  }

  if (!data || (!hasAiUsage && !hasSeoUsage)) {
    return (
      <SectionCard title="AI Usage" titleIcon={usageTitleIcon}>
        <EmptyState
          icon={Zap}
          title="No usage in this period"
          description="AI and SEO provider activity will appear here after it is recorded for this date range."
          className="min-h-[260px]"
        />
      </SectionCard>
    );
  }

  const totalCost = data.estimatedCost;
  const totalCalls = data.daily.reduce((s, d) => s + d.calls, 0);
  const openaiCost = data.daily.reduce((s, d) => s + d.openaiCost, 0);
  const anthropicCost = data.daily.reduce((s, d) => s + d.anthropicCost, 0);

  const chartDays = data.daily.slice(-days);

  const seo = data.dataforseo;
  const seoDaily = (data.dataforseoDaily ?? []).slice(-days);
  const seoCacheHitRate = seo && seo.totalCalls > 0 ? Math.round((seo.cachedCalls / seo.totalCalls) * 100) : 0;

  const fmtCost = (v: number) => v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
  const compactMetricValueClass = compact ? 't-stat-sm text-[20px] font-extrabold leading-none' : 'text-sm'; // arbitrary-text-ok stat-primitive-ok — source Business KPI tiles are exactly 20px; the nearest DS role is 18px.
  const rangeControl = (
    <div className="flex gap-1" aria-label="Usage date range">
      {[7, 14, 30].map(d => (
        <Button
          key={d}
          onClick={() => { setLoading(true); setDays(d); }}
          variant="ghost"
          size="sm"
          className={cn(
            'px-2 py-0.5 rounded t-caption-sm font-medium transition-colors',
            days === d
              ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)]'
              : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]',
          )}
        >
          {d}d
        </Button>
      ))}
    </div>
  );

  const FEATURE_LABELS: Record<string, string> = {
    'content-post-intro': 'Post: Intro',
    'content-post-section': 'Post: Sections',
    'content-post-conclusion': 'Post: Conclusion',
    'content-post-unify': 'Post: Unification',
    'content-post-seo-meta': 'Post: SEO Meta',
    'content-brief': 'Content Brief',
    'seo-rewrite': 'SEO Rewrite',
    'seo-chat': 'Admin Chat',
    'client-chat': 'Client Chat',
    'schema-generation': 'Schema',
    'alt-text': 'Alt Text',
    'strategy': 'Strategy',
    'kb-generate': 'KB Auto-Gen',
    'anomaly-detection': 'Anomaly Detection',
    'chat-summary': 'Chat Summary',
  };

  return (
    <SectionCard
      title="AI Usage"
      titleIcon={usageTitleIcon}
      action={compact ? undefined : rangeControl}
    >
      {/* AI cards + daily cost chart only when there IS AI activity — the section can
          also be shown for DataForSEO usage alone, where these would read all-zero. */}
      {hasAiUsage && (
      <>
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
          <div className={cn('t-caption-sm text-[var(--brand-text-muted)]', compact ? 'mb-2 flex items-center gap-1.5 font-medium' : 'mb-0.5')}>
            {compact && <Icon name="zap" size="xs" aria-hidden="true" />}
            AI cost
          </div>
          <div className={cn('font-semibold text-[var(--brand-text-bright)] tabular-nums', compactMetricValueClass)}>{fmtCost(totalCost)}</div>
          {compact && <div className="mt-1.5 t-caption-sm text-[var(--brand-text-muted)]">this cycle</div>}
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
          <div className={cn('t-caption-sm text-[var(--brand-text-muted)]', compact ? 'mb-2 flex items-center gap-1.5 font-medium' : 'mb-0.5')}>
            {compact && <Icon name="sparkle" size="xs" aria-hidden="true" />}
            AI calls
          </div>
          <div className={cn('font-semibold text-[var(--brand-text-bright)] tabular-nums', compactMetricValueClass)}>{totalCalls.toLocaleString()}</div>
          {compact && <div className="mt-1.5 t-caption-sm text-[var(--brand-text-muted)]">generations</div>}
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
          <div className={cn('t-caption-sm text-[var(--brand-text-muted)]', compact ? 'mb-2 flex items-center gap-1.5 font-medium' : 'mb-0.5')}>
            {compact && <Icon name="chart" size="xs" aria-hidden="true" />}
            OpenAI
          </div>
          <div className={cn('font-semibold text-emerald-400 tabular-nums', compactMetricValueClass)}>{fmtCost(openaiCost)}</div>
          {compact && <div className="mt-1.5 t-caption-sm text-[var(--brand-text-muted)]">GPT models</div>}
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
          <div className={cn('t-caption-sm text-[var(--brand-text-muted)]', compact ? 'mb-2 flex items-center gap-1.5 font-medium' : 'mb-0.5')}>
            {compact && <Icon name="chart" size="xs" aria-hidden="true" />}
            Anthropic
          </div>
          <div className={cn('font-semibold text-orange-400 tabular-nums', compactMetricValueClass)}>{fmtCost(anthropicCost)}</div>
          {compact && <div className="mt-1.5 t-caption-sm text-[var(--brand-text-muted)]">Claude models</div>}
        </div>
      </div>

      {/* Stacked bar chart — daily cost by provider */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-2">
          <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">Daily cost</span>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]"><div className="w-2 h-2 rounded-[var(--radius-pill)] bg-emerald-500" /> OpenAI</div>
            <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]"><div className="w-2 h-2 rounded-[var(--radius-pill)] bg-orange-500" /> Anthropic</div>
            {compact && rangeControl}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartDays} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fill: chartAxisColor(), fontSize: 9 }} tickLine={false} axisLine={false} interval={'preserveStartEnd'} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis hide />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as DailyUsage | undefined;
              if (!row) return null;
              return (
                <div className="bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-md)] shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-[var(--brand-border)] t-caption-sm font-semibold text-[var(--brand-text-bright)]">{row.date}</div>
                  <div className="px-3 py-1.5 space-y-1">
                    <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Total</span><span className="text-[var(--brand-text-bright)] font-medium">{fmtCost(row.cost)}</span></div>
                    <div className="flex justify-between t-caption-sm"><div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-emerald-500" />OpenAI</div><span className="text-emerald-400">{fmtCost(row.openaiCost)}</span></div>
                    <div className="flex justify-between t-caption-sm"><div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-orange-500" />Anthropic</div><span className="text-orange-400">{fmtCost(row.anthropicCost)}</span></div>
                    <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Calls</span><span className="text-[var(--brand-text)]">{row.calls}</span></div>
                    <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Tokens</span><span className="text-[var(--brand-text)]">{fmtNum(row.totalTokens)}</span></div>
                  </div>
                </div>
              );
            }} />
            <Bar dataKey="openaiCost" stackId="cost" fill="#059669" radius={[0, 0, 0, 0]} isAnimationActive={false} /> {/* chart-hex-ok — emerald-600 for OpenAI brand */}
            <Bar dataKey="anthropicCost" stackId="cost" fill="#ea580c" radius={[2, 2, 0, 0]} isAnimationActive={false} /> {/* chart-hex-ok — orange-700 for Anthropic brand */}
          </BarChart>
        </ResponsiveContainer>
      </div>
      </>
      )}

      {/* Feature breakdown */}
      {data.byFeature.length > 0 && (
        <div className="mt-4">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Cost by Feature</div>
          <div className="space-y-1">
            {data.byFeature.slice(0, 8).map((f, i) => {
              const pct = totalCost > 0 ? (f.cost / totalCost) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="t-caption-sm text-[var(--brand-text)] w-32 truncate">{FEATURE_LABELS[f.feature] || f.feature}</span>
                  <div className="flex-1 h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                    <div
                      className={`h-full rounded-[var(--radius-pill)] ${f.provider === 'anthropic' ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] w-12 text-right tabular-nums">{fmtCost(f.cost)}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] w-10 text-right tabular-nums">{f.calls} calls</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SEO provider (DataForSEO) credit usage — data is served by /api/ai/usage (P5). */}
      {seo && seo.totalCalls > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--brand-border)]">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">SEO Provider — DataForSEO</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Credits Used</div>
              <div className="text-sm font-semibold text-blue-400">{seo.totalCredits.toFixed(2)}</div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Provider Calls</div>
              <div className="text-sm font-semibold text-[var(--brand-text-bright)]">{seo.totalCalls.toLocaleString()}</div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)] px-3 py-2.5">
              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Cache Hit Rate</div>
              <div className="text-sm font-semibold text-emerald-400">{seoCacheHitRate}%</div>
            </div>
          </div>
          {seoDaily.some(d => d.credits > 0) && (
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={seoDaily} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="date" tick={{ fill: chartAxisColor(), fontSize: 9 }} tickLine={false} axisLine={false} interval={'preserveStartEnd'} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis hide />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as DataForSeoDaily | undefined;
                  if (!row) return null;
                  return (
                    <div className="bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-md)] shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-[var(--brand-border)] t-caption-sm font-semibold text-[var(--brand-text-bright)]">{row.date}</div>
                      <div className="px-3 py-1.5 space-y-1">
                        <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Credits</span><span className="text-blue-400 font-medium">{row.credits.toFixed(2)}</span></div>
                        <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Calls</span><span className="text-[var(--brand-text)]">{row.calls}</span></div>
                        <div className="flex justify-between t-caption-sm"><span className="text-[var(--brand-text-muted)]">Cached</span><span className="text-emerald-400">{row.cachedCalls}</span></div>
                      </div>
                    </div>
                  );
                }} />
                <Bar dataKey="credits" fill="#60a5fa" radius={[2, 2, 0, 0]} isAnimationActive={false} /> {/* chart-hex-ok — blue-400 for SEO credit data */}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </SectionCard>
  );
}
