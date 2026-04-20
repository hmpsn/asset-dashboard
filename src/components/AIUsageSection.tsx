import { useState, useEffect } from 'react';
import { getOptional } from '../api/client';
import { Zap } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { SectionCard } from './ui';
import { chartAxisColor } from './ui/constants';

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

interface SemrushUsage {
  totalCredits: number;
  totalCalls: number;
  cachedCalls: number;
}

interface SemrushDailyUsage {
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
  semrush: SemrushUsage;
  semrushDaily: SemrushDailyUsage[];
}

export function AIUsageSection() {
  const [data, setData] = useState<AIUsageData | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    getOptional<AIUsageData>(`/api/ai/usage?days=${days}`)
      .then(d => { if (d) setData(d); })
      .catch((err) => { console.error('WorkspaceOverview operation failed:', err); });
  }, [days]);

  const hasSemrush = data?.semrush && data.semrush.totalCredits > 0;
  if (!data || (data.totalTokens === 0 && data.daily.every(d => d.calls === 0) && !hasSemrush)) return null;

  const totalCost = data.estimatedCost;
  const totalCalls = data.daily.reduce((s, d) => s + d.calls, 0);
  const openaiCost = data.daily.reduce((s, d) => s + d.openaiCost, 0);
  const anthropicCost = data.daily.reduce((s, d) => s + d.anthropicCost, 0);

  const chartDays = data.daily.slice(-days);

  const fmtCost = (v: number) => v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`;
  const fmtTokens = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);

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
      titleIcon={<Zap className="w-4 h-4 text-amber-400" />}
      action={
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {/* Stat cards */}
      <div className={`grid grid-cols-2 ${hasSemrush ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3 mb-4`}>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">AI Cost</div>
          <div className="text-sm font-semibold text-zinc-200">{fmtCost(totalCost)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">AI Calls</div>
          <div className="text-sm font-semibold text-zinc-200">{totalCalls.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">OpenAI</div>
          <div className="text-sm font-semibold text-emerald-400">{fmtCost(openaiCost)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">Anthropic</div>
          <div className="text-sm font-semibold text-orange-400">{fmtCost(anthropicCost)}</div>
        </div>
        {hasSemrush && (
          <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">SEMRush Credits</div>
            <div className="text-sm font-semibold text-blue-400">{data.semrush.totalCredits.toLocaleString()}</div>
            <div className="text-[9px] text-zinc-600 mt-0.5">{data.semrush.totalCalls - data.semrush.cachedCalls} API / {data.semrush.cachedCalls} cached</div>
          </div>
        )}
      </div>

      {/* Stacked bar chart — daily cost by provider */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-zinc-500">Daily Cost</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[11px] text-zinc-500"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> OpenAI</span>
            <span className="flex items-center gap-1 text-[11px] text-zinc-500"><span className="w-2 h-2 rounded-sm bg-orange-500 inline-block" /> Anthropic</span>
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
                <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.date}</div>
                  <div className="px-3 py-1.5 space-y-1">
                    <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Total</span><span className="text-zinc-200 font-medium">{fmtCost(row.cost)}</span></div>
                    <div className="flex justify-between text-[11px]"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-emerald-500 inline-block" />OpenAI</span><span className="text-emerald-400">{fmtCost(row.openaiCost)}</span></div>
                    <div className="flex justify-between text-[11px]"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-orange-500 inline-block" />Anthropic</span><span className="text-orange-400">{fmtCost(row.anthropicCost)}</span></div>
                    <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Calls</span><span className="text-zinc-300">{row.calls}</span></div>
                    <div className="flex justify-between text-[11px]"><span className="text-zinc-500">Tokens</span><span className="text-zinc-300">{fmtTokens(row.totalTokens)}</span></div>
                  </div>
                </div>
              );
            }} />
            <Bar dataKey="openaiCost" stackId="cost" fill="#059669" radius={[0, 0, 0, 0]} />
            <Bar dataKey="anthropicCost" stackId="cost" fill="#ea580c" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Feature breakdown */}
      {data.byFeature.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-zinc-500 mb-2">Cost by Feature</div>
          <div className="space-y-1">
            {data.byFeature.slice(0, 8).map((f, i) => {
              const pct = totalCost > 0 ? (f.cost / totalCost) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400 w-32 truncate">{FEATURE_LABELS[f.feature] || f.feature}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${f.provider === 'anthropic' ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-zinc-500 w-12 text-right tabular-nums">{fmtCost(f.cost)}</span>
                  <span className="text-[9px] text-zinc-600 w-10 text-right tabular-nums">{f.calls} calls</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
