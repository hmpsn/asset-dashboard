import { useState, useEffect } from 'react';
import {
  BarChart3, MousePointer, Eye, Target,
  Clock, FileText, Loader2, ChevronDown, ChevronRight, Users, Layers, TrendingUp, Search,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { PageHeader, SectionCard, EmptyState, Badge, Icon } from './ui';
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
        <span className="flex items-center gap-1 text-[10px] text-[var(--brand-text)]"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Clicks</span>
        <span className="flex items-center gap-1 text-[10px] text-[var(--brand-text)]"><span className="w-3 h-0.5 bg-cyan-400 inline-block" /> Impressions</span>
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
              <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl shadow-black/40 min-w-[120px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-[var(--brand-border)] text-[11px] font-semibold text-[var(--brand-text-bright)]">{row.date}</div>
                <div className="px-3 py-1.5 space-y-1">
                  <div className="flex justify-between text-[11px]"><span className="text-blue-400">Clicks</span><span className="text-[var(--brand-text-bright)] font-medium">{row.clicks.toLocaleString()}</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-cyan-400">Impressions</span><span className="text-[var(--brand-text-bright)] font-medium">{row.impressions.toLocaleString()}</span></div>
                </div>
              </div>
            );
          }} />
          <Line yAxisId="imps" type="monotone" dataKey="impressions" stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.5} dot={false} />
          <Line yAxisId="clicks" type="monotone" dataKey="clicks" stroke="#60a5fa" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[10px] text-[var(--brand-text-dim)] mt-1">
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
  landing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  service: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  location: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  product: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pillar: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  resource: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
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
        <Loader2 className="w-6 h-6 text-[var(--brand-text-muted)] animate-spin" />
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
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-[var(--radius-lg)] px-4 py-3">{error}</div>
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
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] px-4 py-3 rounded-[var(--radius-signature)]">
              <div className="flex items-center gap-2 mb-1">
                <Icon as={MousePointer} size="md" className="text-blue-400" />
                <span className="text-[11px] text-[var(--brand-text-muted)] uppercase tracking-wider">Total Clicks</span>
              </div>
              <p className="text-xl font-semibold text-[var(--brand-text-bright)]">{totalClicks.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] px-4 py-3 rounded-[var(--radius-signature)]">
              <div className="flex items-center gap-2 mb-1">
                <Icon as={Eye} size="md" className="text-cyan-400" />
                <span className="text-[11px] text-[var(--brand-text-muted)] uppercase tracking-wider">Impressions</span>
              </div>
              <p className="text-xl font-semibold text-[var(--brand-text-bright)]">{totalImpressions.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] px-4 py-3 rounded-[var(--radius-signature)]">
              <div className="flex items-center gap-2 mb-1">
                <Icon as={Users} size="md" className="text-teal-400" />
                <span className="text-[11px] text-[var(--brand-text-muted)] uppercase tracking-wider">Sessions</span>
              </div>
              <p className="text-xl font-semibold text-[var(--brand-text-bright)]">{totalSessions.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] px-4 py-3 rounded-[var(--radius-signature)]">
              <div className="flex items-center gap-2 mb-1">
                <Icon as={Target} size="md" className="text-amber-400" />
                <span className="text-[11px] text-[var(--brand-text-muted)] uppercase tracking-wider">Avg Position</span>
              </div>
              <p className="text-xl font-semibold text-[var(--brand-text-bright)]">{avgPosition > 0 ? avgPosition.toFixed(1) : '—'}</p>
            </div>
          </div>

          {/* Sort controls */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--brand-text-muted)]">Sort by:</span>
            {(['clicks', 'impressions', 'sessions', 'days'] as const).map(key => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                  sortKey === key
                    ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]'
                    : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
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
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors text-left"
                  >
                    {isExpanded
                      ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                      : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                    }

                    {/* Title + keyword + badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--brand-text-bright)] truncate">{item.topic}</span>
                        {ptColor && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ptColor}`}>
                            {item.pageType}
                          </span>
                        )}
                        <Badge label={item.status} color={item.status === 'published' ? 'emerald' : 'blue'} />
                        {item.source === 'matrix' && (
                          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                            <Icon as={Layers} size="sm" /> Content Plan
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-[var(--brand-text-muted)]">{item.targetKeyword}</span>
                        {item.targetPageSlug && (
                          <span className="text-[11px] text-[var(--brand-text-dim)]">{item.targetPageSlug}</span>
                        )}
                      </div>
                    </div>

                    {/* Inline metrics */}
                    <div className="flex items-center gap-5 flex-shrink-0">
                      {item.gsc ? (
                        <>
                          <div className="text-right">
                            <p className="text-xs font-medium text-[var(--brand-text-bright)]">{item.gsc.clicks.toLocaleString()}</p>
                            <p className="text-[10px] text-[var(--brand-text-muted)]">clicks</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-[var(--brand-text-bright)]">{item.gsc.impressions.toLocaleString()}</p>
                            <p className="text-[10px] text-[var(--brand-text-muted)]">impressions</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-xs font-medium ${item.gsc.position <= 10 ? 'text-emerald-400' : item.gsc.position <= 20 ? 'text-amber-400' : 'text-[var(--brand-text)]'}`}>
                              #{item.gsc.position.toFixed(1)}
                            </p>
                            <p className="text-[10px] text-[var(--brand-text-muted)]">position</p>
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-[var(--brand-text-dim)]">No GSC data</span>
                      )}

                      <div className="text-right pl-3 border-l border-[var(--brand-border)]">
                        <div className="flex items-center gap-1 text-[11px] text-[var(--brand-text-muted)]">
                          <Icon as={Clock} size="sm" />
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
                    <div className="px-4 pb-4 pt-1 border-t border-[var(--brand-border)]/50">
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        {/* GSC detail */}
                        <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] p-3">
                          <h4 className="text-[11px] text-[var(--brand-text)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Icon as={MousePointer} size="sm" /> Search Performance (90d)
                          </h4>
                          {item.gsc ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.gsc.clicks.toLocaleString()}</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Clicks</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.gsc.impressions.toLocaleString()}</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Impressions</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.gsc.ctr}%</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">CTR</p>
                              </div>
                              <div>
                                <p className={`text-lg font-semibold ${item.gsc.position <= 10 ? 'text-emerald-400' : item.gsc.position <= 20 ? 'text-amber-400' : 'text-[var(--brand-text-bright)]'}`}>
                                  #{item.gsc.position.toFixed(1)}
                                </p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Avg Position</p>
                              </div>
                            </div>
                          ) : (
                            <EmptyState icon={Search} title="No search data" description="This page may not have a matching slug in Google Search Console." className="py-2" />
                          )}
                        </div>

                        {/* GA4 detail */}
                        <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] p-3">
                          <h4 className="text-[11px] text-[var(--brand-text)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Icon as={Users} size="sm" /> Site Analytics (90d)
                          </h4>
                          {item.ga4 ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.ga4.sessions.toLocaleString()}</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Sessions</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.ga4.users.toLocaleString()}</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Users</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{item.ga4.bounceRate.toFixed(1)}%</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Bounce Rate</p>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-[var(--brand-text-bright)]">{formatEngagement(item.ga4.avgEngagementTime)}</p>
                                <p className="text-[10px] text-[var(--brand-text-muted)]">Avg Engagement</p>
                              </div>
                            </div>
                          ) : (
                            <EmptyState icon={BarChart3} title="No analytics data" description="No Google Analytics data available for this page." className="py-2" />
                          )}
                        </div>
                      </div>

                      {/* Trend chart */}
                      {trendLoading === item.requestId ? (
                        <div className="flex items-center gap-2 mt-4 text-xs text-[var(--brand-text-muted)]">
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
