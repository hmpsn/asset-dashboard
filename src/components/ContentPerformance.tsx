import { useState, useEffect } from 'react';
import {
  BarChart3, MousePointer, Eye, Target,
  Clock, FileText, Loader2, ChevronDown, ChevronRight, Users, Layers, TrendingUp, Search,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { PageHeader, SectionCard, EmptyState, Badge } from './ui';
import { contentPerformance } from '../api/seo';

interface GscMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GA4Metrics {
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

interface ContentItem {
  requestId: string;
  topic: string;
  targetKeyword: string;
  targetPageSlug?: string;
  pageType?: string;
  status: string;
  publishedAt?: string;
  daysSincePublish: number;
  gsc: GscMetrics | null;
  ga4: GA4Metrics | null;
  source?: 'request' | 'matrix';
}

interface TrendPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Props {
  workspaceId: string;
}

function MiniSparkline({ data, color, height = 32, width = 100 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="flex-shrink-0" style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendChart({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) return <EmptyState icon={TrendingUp} title="Not enough data" description="Insufficient data points for trend chart." className="py-4" />;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Clicks</span>
        <span className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="w-3 h-0.5 bg-cyan-400 inline-block" /> Impressions</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={trend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis yAxisId="clicks" hide domain={[0, 'dataMax']} />
          <YAxis yAxisId="imps" hide domain={[0, 'dataMax']} orientation="right" />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as TrendPoint | undefined;
            if (!row) return null;
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[120px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.date}</div>
                <div className="px-3 py-1.5 space-y-1">
                  <div className="flex justify-between text-[11px]"><span className="text-blue-400">Clicks</span><span className="text-zinc-200 font-medium">{row.clicks.toLocaleString()}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-cyan-400">Impressions</span><span className="text-zinc-200 font-medium">{row.impressions.toLocaleString()}</span></div>
                </div>
              </div>
            );
          }} />
          <Line yAxisId="imps" type="monotone" dataKey="impressions" stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.5} dot={false} />
          <Line yAxisId="clicks" type="monotone" dataKey="clicks" stroke="#60a5fa" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
        <span>{trend[0].date}</span>
        <span>{trend[trend.length - 1].date}</span>
      </div>
    </div>
  );
}

function formatEngagement(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

const PAGE_TYPE_COLORS: Record<string, string> = {
  blog: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  landing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  service: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  location: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  product: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pillar: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  resource: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
};

export function ContentPerformance({ workspaceId }: Props) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<Record<string, TrendPoint[]>>({});
  const [trendLoading, setTrendLoading] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'clicks' | 'impressions' | 'sessions' | 'days'>('clicks');

  useEffect(() => {
    let cancelled = false;
    contentPerformance.get(workspaceId)
      .then(data => { if (!cancelled) { setItems((data as { items?: ContentItem[] }).items || []); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const toggleExpand = async (requestId: string) => {
    if (expandedId === requestId) { setExpandedId(null); return; }
    setExpandedId(requestId);
    if (!trendData[requestId]) {
      setTrendLoading(requestId);
      try {
        const data = await contentPerformance.trend(workspaceId, requestId);
        setTrendData(prev => ({ ...prev, [requestId]: (data as { trend?: TrendPoint[] }).trend || [] }));
      } catch (err) { console.error('ContentPerformance operation failed:', err); }
      setTrendLoading(null);
    }
  };

  const sorted = [...items].sort((a, b) => {
    switch (sortKey) {
      case 'clicks': return (b.gsc?.clicks || 0) - (a.gsc?.clicks || 0);
      case 'impressions': return (b.gsc?.impressions || 0) - (a.gsc?.impressions || 0);
      case 'sessions': return (b.ga4?.sessions || 0) - (a.ga4?.sessions || 0);
      case 'days': return b.daysSincePublish - a.daysSincePublish;
      default: return 0;
    }
  });

  // Aggregate stats
  const totalClicks = items.reduce((s, i) => s + (i.gsc?.clicks || 0), 0);
  const totalImpressions = items.reduce((s, i) => s + (i.gsc?.impressions || 0), 0);
  const totalSessions = items.reduce((s, i) => s + (i.ga4?.sessions || 0), 0);
  const avgPosition = items.filter(i => i.gsc).length > 0
    ? items.reduce((s, i) => s + (i.gsc?.position || 0), 0) / items.filter(i => i.gsc).length
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Performance"
        subtitle={`${items.length} published post${items.length !== 1 ? 's' : ''} tracked`}
        icon={<BarChart3 className="w-5 h-5 text-blue-400" />}
      />

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{error}</div>
      )}

      {items.length === 0 && !error ? (
        <EmptyState
          icon={FileText}
          title="No published content yet"
          description="Content performance tracking begins when content requests reach 'delivered' or 'published' status. Published content with a target page slug will show GSC and GA4 metrics here."
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-center gap-2 mb-1">
                <MousePointer className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Total Clicks</span>
              </div>
              <p className="text-xl font-semibold text-zinc-100">{totalClicks.toLocaleString()}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Impressions</span>
              </div>
              <p className="text-xl font-semibold text-zinc-100">{totalImpressions.toLocaleString()}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Sessions</span>
              </div>
              <p className="text-xl font-semibold text-zinc-100">{totalSessions.toLocaleString()}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '6px 12px 6px 12px' }}>
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Avg Position</span>
              </div>
              <p className="text-xl font-semibold text-zinc-100">{avgPosition > 0 ? avgPosition.toFixed(1) : '—'}</p>
            </div>
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">Sort by:</span>
            {(['clicks', 'impressions', 'sessions', 'days'] as const).map(key => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                  sortKey === key
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {key === 'days' ? 'Age' : key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>

          {/* Content items */}
          <div className="space-y-2">
            {sorted.map(item => {
              const isExpanded = expandedId === item.requestId;
              const ptColor = item.pageType ? PAGE_TYPE_COLORS[item.pageType] : undefined;

              return (
                <SectionCard key={item.requestId} className="!p-0 overflow-hidden">
                  {/* Row header */}
                  <button
                    onClick={() => toggleExpand(item.requestId)}
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                    }

                    {/* Title + keyword + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200 truncate">{item.topic}</span>
                        {ptColor && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ptColor}`}>
                            {item.pageType}
                          </span>
                        )}
                        <Badge label={item.status} color={item.status === 'published' ? 'emerald' : 'blue'} />
                        {item.source === 'matrix' && (
                          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            <Layers className="w-2.5 h-2.5" /> Content Plan
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-zinc-500">{item.targetKeyword}</span>
                        {item.targetPageSlug && (
                          <span className="text-[11px] text-zinc-600">{item.targetPageSlug}</span>
                        )}
                      </div>
                    </div>

                    {/* Inline metrics */}
                    <div className="flex items-center gap-5 flex-shrink-0">
                      {item.gsc ? (
                        <>
                          <div className="text-right">
                            <p className="text-xs font-medium text-zinc-200">{item.gsc.clicks.toLocaleString()}</p>
                            <p className="text-[10px] text-zinc-500">clicks</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-zinc-200">{item.gsc.impressions.toLocaleString()}</p>
                            <p className="text-[10px] text-zinc-500">impressions</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-xs font-medium ${item.gsc.position <= 10 ? 'text-emerald-400' : item.gsc.position <= 20 ? 'text-amber-400' : 'text-zinc-400'}`}>
                              #{item.gsc.position.toFixed(1)}
                            </p>
                            <p className="text-[10px] text-zinc-500">position</p>
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-zinc-600">No GSC data</span>
                      )}

                      <div className="text-right pl-3 border-l border-zinc-800">
                        <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                          <Clock className="w-3 h-3" />
                          {item.daysSincePublish}d
                        </div>
                      </div>

                      {item.gsc && (
                        <MiniSparkline
                          data={[item.gsc.clicks * 0.6, item.gsc.clicks * 0.8, item.gsc.clicks]}
                          color="#60a5fa"
                          width={60}
                          height={24}
                        />
                      )}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-zinc-800/50">
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        {/* GSC detail */}
                        <div className="bg-zinc-800/30 rounded-lg p-3">
                          <h4 className="text-[11px] text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <MousePointer className="w-3 h-3" /> Search Performance (90d)
                          </h4>
                          {item.gsc ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.gsc.clicks.toLocaleString()}</p>
                                <p className="text-[10px] text-zinc-500">Clicks</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.gsc.impressions.toLocaleString()}</p>
                                <p className="text-[10px] text-zinc-500">Impressions</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.gsc.ctr}%</p>
                                <p className="text-[10px] text-zinc-500">CTR</p>
                              </div>
                              <div>
                                <p className={`text-lg font-semibold ${item.gsc.position <= 10 ? 'text-emerald-400' : item.gsc.position <= 20 ? 'text-amber-400' : 'text-zinc-100'}`}>
                                  #{item.gsc.position.toFixed(1)}
                                </p>
                                <p className="text-[10px] text-zinc-500">Avg Position</p>
                              </div>
                            </div>
                          ) : (
                            <EmptyState icon={Search} title="No search data" description="This page may not have a matching slug in Google Search Console." className="py-2" />
                          )}
                        </div>

                        {/* GA4 detail */}
                        <div className="bg-zinc-800/30 rounded-lg p-3">
                          <h4 className="text-[11px] text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Users className="w-3 h-3" /> Site Analytics (90d)
                          </h4>
                          {item.ga4 ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.ga4.sessions.toLocaleString()}</p>
                                <p className="text-[10px] text-zinc-500">Sessions</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.ga4.users.toLocaleString()}</p>
                                <p className="text-[10px] text-zinc-500">Users</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{item.ga4.bounceRate.toFixed(1)}%</p>
                                <p className="text-[10px] text-zinc-500">Bounce Rate</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-zinc-100">{formatEngagement(item.ga4.avgEngagementTime)}</p>
                                <p className="text-[10px] text-zinc-500">Avg Engagement</p>
                              </div>
                            </div>
                          ) : (
                            <EmptyState icon={BarChart3} title="No analytics data" description="No Google Analytics data available for this page." className="py-2" />
                          )}
                        </div>
                      </div>

                      {/* Trend chart */}
                      {trendLoading === item.requestId ? (
                        <div className="flex items-center gap-2 mt-4 text-xs text-zinc-500">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading trend data...
                        </div>
                      ) : trendData[item.requestId] ? (
                        <TrendChart trend={trendData[item.requestId]} />
                      ) : null}
                    </div>
                  )}
                </SectionCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
