import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, TrendingUp, Minus, Plus, Trash2, Pin, RefreshCw,
  Target, ArrowUp, ArrowDown, LineChart, ChevronDown, MapPin,
} from 'lucide-react';
import { get } from '../api/client';
import { rankTracking } from '../api/seo';
import { Badge, EmptyState, SectionCard, Icon, Button, IconButton, PageHeader, FormInput, LoadingState, ErrorState } from './ui';
import { FeatureFlag } from './ui/FeatureFlag';
import { cn } from '../lib/utils';
import { chartGridColor, chartAxisColor, CHART_SERIES_COLORS } from './ui/constants';
import { queryKeys } from '../lib/queryKeys';
import { adminPath } from '../routes';
import { formatDateShort } from '../utils/formatDates';
import type { LatestRank } from '../../shared/types/rank-tracking';

// ── Trend colors (blue/teal/green family per design system — no violet/indigo) ──
// chart-hex-ok — multi-keyword trend chart needs 7+ visually distinct cool-hue steps
const TREND_COLORS = [CHART_SERIES_COLORS.blue, '#38bdf8', '#22d3ee', CHART_SERIES_COLORS.teal, CHART_SERIES_COLORS.emerald, '#06b6d4', '#0ea5e9'];

// ── Sparkline: compact position-over-time for a single keyword ──
function PositionSparkline({ data }: { data: { date: string; position: number }[] }) {
  if (data.length < 2) return <span className="t-caption text-[var(--brand-text-muted)] italic">Not enough snapshots for trend</span>;

  const W = 200, H = 40, P = 4;
  const positions = data.map(d => d.position);
  const min = Math.min(...positions), max = Math.max(...positions);
  const range = max - min || 1;

  const pts = data.map((d, i) => ({
    x: P + (i / (data.length - 1)) * (W - P * 2),
    y: P + ((d.position - min) / range) * (H - P * 2), // lower position = higher on chart
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = data[0], latest = data[data.length - 1];
  const improved = latest.position < first.position;
  const dateRange = `${formatDateShort(first.date)} – ${formatDateShort(latest.date)}`;

  return (
    <div className="flex items-center gap-4">
      <svg width={W} height={H} className="flex-shrink-0">
        <path d={pathD} fill="none" stroke={CHART_SERIES_COLORS.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="2.5" fill={CHART_SERIES_COLORS.blue} />
      </svg>
      <div className="t-caption-sm text-[var(--brand-text-muted)] space-y-0.5">
        <div>Best: <span className="text-emerald-400 font-medium">#{min.toFixed(1)}</span> · Worst: <span className="text-red-400 font-medium">#{max.toFixed(1)}</span></div>
        <div className="flex items-center gap-1">
          <span>{data.length} snapshots</span>
          <span className="text-[var(--brand-border-hover)]">·</span>
          <span>{dateRange}</span>
        </div>
        <div className={improved ? 'text-emerald-400' : latest.position > first.position ? 'text-red-400' : 'text-[var(--brand-text-muted)]'}>
          {improved ? '↑' : latest.position > first.position ? '↓' : '—'} {Math.abs(latest.position - first.position).toFixed(1)} positions over period
        </div>
      </div>
    </div>
  );
}

// ── TrendsChart: multi-keyword position history ──
function TrendsChart({ data, keywords }: { data: HistoryPoint[]; keywords: string[] }) {
  if (data.length < 2 || keywords.length === 0) return null;

  const W = 640, H = 220, padL = 40, padR = 16, padT = 16, padB = 36;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  // Global position range
  let minPos = Infinity, maxPos = 0;
  for (const snap of data) {
    for (const kw of keywords) {
      const pos = snap.positions[kw];
      if (pos !== undefined) {
        minPos = Math.min(minPos, pos);
        maxPos = Math.max(maxPos, pos);
      }
    }
  }
  if (minPos === Infinity) return null;
  // Add some padding so lines don't touch edges
  const yMin = Math.max(0, minPos - 1), yMax = maxPos + 1;
  const yRange = yMax - yMin || 1;

  const toX = (i: number) => padL + (i / (data.length - 1)) * chartW;
  const toY = (pos: number) => padT + ((pos - yMin) / yRange) * chartH;

  // Y-axis tick positions (3-5 ticks)
  const yTicks: number[] = [];
  const step = Math.max(1, Math.round(yRange / 4));
  for (let v = Math.ceil(yMin); v <= yMax; v += step) yTicks.push(v);
  if (yTicks.length === 0) yTicks.push(Math.round(yMin), Math.round(yMax));

  // X-axis date labels (first, middle, last)
  const xLabels = [
    { idx: 0, date: data[0].date },
    ...(data.length > 4 ? [{ idx: Math.floor(data.length / 2), date: data[Math.floor(data.length / 2)].date }] : []),
    { idx: data.length - 1, date: data[data.length - 1].date },
  ];
  return (
    // pr-check-disable-next-line -- brand asymmetric signature on RankTracker trends-chart card; non-SectionCard chrome
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-5 rounded-[var(--radius-signature-lg)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-[var(--brand-text-bright)]">Position History — Pinned Keywords</h4>
        <span className="t-caption-sm text-[var(--brand-text-muted)]">{data.length} snapshots · lower is better</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="overflow-visible">
        {/* Y gridlines + labels */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke={chartGridColor()} strokeDasharray="3,3" />
            <text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill={chartAxisColor()} fontSize="9">#{v}</text>
          </g>
        ))}
        {/* Keyword lines */}
        {keywords.map((kw, ki) => {
          const pts: { x: number; y: number }[] = [];
          data.forEach((snap, i) => {
            if (snap.positions[kw] !== undefined) pts.push({ x: toX(i), y: toY(snap.positions[kw]) });
          });
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          const last = pts[pts.length - 1];
          return (
            <g key={kw}>
              <path d={d} fill="none" stroke={TREND_COLORS[ki % TREND_COLORS.length]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={last.x} cy={last.y} r="3" fill={TREND_COLORS[ki % TREND_COLORS.length]} />
            </g>
          );
        })}
        {/* X-axis date labels */}
        {xLabels.map(({ idx, date }) => (
          <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill={chartAxisColor()} fontSize="9">
            {formatDateShort(date)}
          </text>
        ))}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[var(--brand-border)]">
        {keywords.map((kw, ki) => {
          const latest = data[data.length - 1]?.positions[kw];
          return (
            <div key={kw} className="flex items-center gap-1.5 t-caption">
              <span className="w-2.5 h-2.5 rounded-[var(--radius-pill)] flex-shrink-0" style={{ backgroundColor: TREND_COLORS[ki % TREND_COLORS.length] }} />
              <span className="text-[var(--brand-text)]">{kw}</span>
              {latest !== undefined && <span className="text-[var(--brand-text-dim)]">#{latest.toFixed(1)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type HistoryPoint = { date: string; positions: Record<string, number> };

interface Props {
  workspaceId: string;
  hasGsc?: boolean;
  onNavigate?: (to: string, options?: { state?: unknown }) => void;
}

export function RankTracker({ workspaceId, hasGsc, onNavigate }: Props) {
  const queryClient = useQueryClient();
  const [newKeyword, setNewKeyword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Trend/sparkline state
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);
  const [showTrends, setShowTrends] = useState(false);
  const trackedKeywordsQuery = useQuery({
    queryKey: queryKeys.admin.rankTrackingKeywordRows(workspaceId),
    queryFn: () => rankTracking.keywords(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });

  const latestRanksQuery = useQuery({
    queryKey: queryKeys.admin.rankTrackingLatest(workspaceId),
    queryFn: () => get<LatestRank[]>(`/api/rank-tracking/${workspaceId}/latest`),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });

  const keywords = trackedKeywordsQuery.data ?? [];
  const latestRanks = latestRanksQuery.data ?? [];

  const pinnedKeywords = useMemo(
    () => latestRanks.filter(rank => rank.pinned).map(rank => rank.query),
    [latestRanks],
  );

  const expandedHistoryQuery = useQuery({
    queryKey: queryKeys.admin.rankTrackingHistoryQueries(
      workspaceId,
      expandedQuery ? [expandedQuery] : [],
    ),
    queryFn: async () => {
      if (!expandedQuery) return [] as HistoryPoint[];
      return get<HistoryPoint[]>(`/api/rank-tracking/${workspaceId}/history?queries=${encodeURIComponent(expandedQuery)}`);
    },
    enabled: !!workspaceId && !!expandedQuery,
    staleTime: 60 * 1000,
  });

  const trendsQuery = useQuery({
    queryKey: queryKeys.admin.rankTrackingHistoryQueries(workspaceId, pinnedKeywords),
    queryFn: () => get<HistoryPoint[]>(`/api/rank-tracking/${workspaceId}/history?queries=${encodeURIComponent(pinnedKeywords.join(','))}`),
    enabled: !!workspaceId && showTrends && pinnedKeywords.length > 0,
    staleTime: 60 * 1000,
  });

  const addKeywordMutation = useMutation({
    mutationFn: (query: string) => rankTracking.addKeyword(workspaceId, { query }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywordRows(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
    },
  });

  const removeKeywordMutation = useMutation({
    mutationFn: (query: string) => rankTracking.removeKeyword(workspaceId, query),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywordRows(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(workspaceId) });
    },
  });

  const togglePinMutation = useMutation({
    mutationFn: (query: string) => rankTracking.togglePin(workspaceId, query),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywordRows(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(workspaceId) });
    },
  });

  const snapshotMutation = useMutation({
    mutationFn: () => rankTracking.snapshot(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywordRows(workspaceId) });
    },
  });

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    setError(null);
    try {
      await addKeywordMutation.mutateAsync(newKeyword.trim());
      setNewKeyword('');
    } catch {
      setError('Failed to add keyword');
    }
  };

  const removeKeyword = async (query: string) => {
    setError(null);
    try {
      await removeKeywordMutation.mutateAsync(query);
    } catch {
      setError('Failed to remove keyword');
    }
  };

  const togglePin = async (query: string) => {
    setError(null);
    try {
      await togglePinMutation.mutateAsync(query);
    } catch {
      setError('Failed to update pin state');
    }
  };

  const takeSnapshot = async () => {
    setError(null);
    try {
      await snapshotMutation.mutateAsync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot failed');
    }
  };

  // Expand a keyword row to show its sparkline
  const toggleExpand = (query: string) => {
    if (expandedQuery === query) {
      setExpandedQuery(null);
      return;
    }
    setExpandedQuery(query);
  };

  const queryHistory = useMemo(() => {
    if (!expandedQuery || !expandedHistoryQuery.data) return [];
    return expandedHistoryQuery.data
      .filter(point => point.positions[expandedQuery] !== undefined)
      .map(point => ({ date: point.date, position: point.positions[expandedQuery] }));
  }, [expandedHistoryQuery.data, expandedQuery]);

  const loading = trackedKeywordsQuery.isLoading || latestRanksQuery.isLoading;
  const historyLoading = expandedHistoryQuery.isFetching;
  const trendsLoading = trendsQuery.isFetching;
  const trendsData = trendsQuery.data ?? [];
  const adding = addKeywordMutation.isPending;
  const snapshotting = snapshotMutation.isPending;
  const initialLoadError =
    (trackedKeywordsQuery.error instanceof Error && trackedKeywordsQuery.error.message)
    || (latestRanksQuery.error instanceof Error && latestRanksQuery.error.message)
    || null;
  const effectiveError = error || initialLoadError;

  if (loading) {
    return (
      <LoadingState message="Loading rank tracking snapshots and keyword positions..." size="lg" />
    );
  }

  const sorted = [...latestRanks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.position - b.position;
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Rank Tracker"
        subtitle={`${keywords.length} keyword${keywords.length === 1 ? '' : 's'} tracked`}
        icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            {pinnedKeywords.length > 0 && (
              <Button
                onClick={() => setShowTrends(prev => !prev)}
                disabled={trendsLoading}
                variant="ghost"
                size="sm"
                className={cn(
                  'gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] t-caption font-medium border',
                  showTrends
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    : 'bg-[var(--surface-3)]/50 border-[var(--brand-border-hover)]/50 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)]',
                )}
              >
                {trendsLoading ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={LineChart} size="sm" />}
                Trends
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={snapshotting ? undefined : RefreshCw}
              loading={snapshotting}
              disabled={!hasGsc || snapshotting || keywords.length === 0}
              title={!hasGsc ? 'Connect Google Search Console in Workspace Settings to enable snapshots' : undefined}
              onClick={takeSnapshot}
            >
              {snapshotting ? 'Capturing...' : 'Capture Snapshot'}
            </Button>
          </div>
        }
      />

      {!hasGsc && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-[var(--radius-sm)] px-4 py-3 text-xs text-amber-300">
          Connect Google Search Console in Workspace Settings to enable rank tracking snapshots.
        </div>
      )}

      <FeatureFlag flag="local-seo-visibility">
        <SectionCard variant="subtle">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Icon as={MapPin} size="md" className="text-blue-400" />
            </div>
            <div>
              <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Rank Tracker is Search Console measurement</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                Local SEO visibility is measured separately by market and local-pack evidence. Use Keywords for local visibility posture; use this page for GSC query positions, clicks, and impressions.
              </p>
            </div>
          </div>
        </SectionCard>
      </FeatureFlag>

      {effectiveError && (
        <ErrorState
          title="Couldn't load rank tracker data"
          message={effectiveError}
          action={{
            label: 'Retry',
            onClick: () => {
              void trackedKeywordsQuery.refetch();
              void latestRanksQuery.refetch();
            },
          }}
          type="data"
          className="py-4"
        />
      )}

      {/* Add keyword */}
      <div className="flex items-center gap-2">
        <FormInput
          type="text"
          value={newKeyword}
          onChange={setNewKeyword}
          placeholder="Add keyword to track..."
          className="flex-1"
          onKeyDown={e => e.key === 'Enter' && !adding && addKeyword()}
        />
        <Button
          variant="primary"
          size="sm"
          icon={adding ? undefined : Plus}
          loading={adding}
          disabled={!newKeyword.trim() || adding}
          onClick={addKeyword}
        >
          Add
        </Button>
      </div>

      {/* Trends chart for pinned keywords */}
      {showTrends && !trendsLoading && trendsData.length >= 2 && (
        <TrendsChart data={trendsData} keywords={pinnedKeywords} />
      )}
      {showTrends && trendsLoading && (
        <LoadingState message="Loading pinned keyword trend history..." size="sm" className="py-8" />
      )}

      {/* Rankings table */}
      {sorted.length > 0 ? (
        // pr-check-disable-next-line -- brand asymmetric signature on RankTracker rank-table card; non-SectionCard chrome
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
          <div className="grid grid-cols-[1fr_80px_80px_80px_80px_60px] gap-2 px-4 py-2 t-caption font-medium text-[var(--brand-text-muted)] uppercase tracking-wider border-b border-[var(--brand-border)]">
            <span>Keyword</span>
            <span className="text-right">Position</span>
            <span className="text-right">Change</span>
            <span className="text-right">Clicks</span>
            <span className="text-right">Impressions</span>
            <span></span>
          </div>
          {sorted.map(rank => {
            const isExpanded = expandedQuery === rank.query;
            return (
              <div key={rank.query}>
                <div
                  className="grid grid-cols-[1fr_80px_80px_80px_80px_60px] gap-2 px-4 py-2.5 items-center border-b border-[var(--brand-border)]/50 last:border-0 hover:bg-[var(--surface-3)]/20 cursor-pointer"
                  onClick={() => toggleExpand(rank.query)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); togglePin(rank.query); }}
                      icon={Pin}
                      label={rank.pinned ? 'Unpin keyword' : 'Pin keyword'}
                      size="sm"
                      variant="ghost"
                      className={cn('flex-shrink-0', rank.pinned ? 'text-amber-400' : 'text-[var(--brand-border-hover)] hover:text-[var(--brand-text)]')}
                    />
                    <Icon as={ChevronDown} size="sm" className={cn('text-[var(--brand-text-dim)] flex-shrink-0 transition-transform', isExpanded && 'rotate-180')} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-[var(--brand-text-bright)] truncate">{rank.query}</span>
                        {rank.source?.startsWith('strategy_') && <Badge tone="teal" size="sm" label="Strategy" />}
                        {rank.source === 'client_requested' && <Badge tone="blue" size="sm" label="Client" />}
                      </div>
                      {rank.pagePath && (
                        <div className="mt-0.5 flex items-center gap-2 min-w-0">
                          <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{rank.pageTitle || rank.pagePath}</div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-1.5 py-0.5 t-caption-sm text-accent-brand flex-shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (onNavigate) {
                                onNavigate(adminPath(workspaceId, 'page-intelligence'), {
                                  state: {
                                    fixContext: {
                                      targetRoute: 'page-intelligence',
                                      pageSlug: rank.pagePath,
                                      pageName: rank.pageTitle || rank.pagePath,
                                    },
                                  },
                                });
                                return;
                              }
                              window.location.assign(adminPath(workspaceId, 'page-intelligence'));
                            }}
                          >
                            Open page
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={cn('text-sm font-bold', rank.position <= 3 ? 'text-emerald-400' : rank.position <= 10 ? 'text-teal-400' : rank.position <= 20 ? 'text-amber-400' : 'text-[var(--brand-text)]')}>
                      {Math.round(rank.position * 10) / 10}
                    </span>
                  </div>
                  <div className="text-right">
                    {rank.change != null ? (
                      <span className={cn('flex items-center justify-end gap-0.5 text-xs font-medium', rank.change < 0 ? 'text-emerald-400' : rank.change > 0 ? 'text-red-400' : 'text-[var(--brand-text-muted)]')}>
                        {rank.change < 0 ? <Icon as={ArrowUp} size="sm" /> : rank.change > 0 ? <Icon as={ArrowDown} size="sm" /> : <Icon as={Minus} size="sm" />}
                        {rank.change !== 0 ? Math.abs(Math.round(rank.change * 10) / 10) : '—'}
                      </span>
                    ) : (
                      <span className="t-caption text-[var(--brand-text-muted)]">—</span>
                    )}
                  </div>
                  <div className="text-right text-xs text-[var(--brand-text)]">{rank.clicks}</div>
                  <div className="text-right text-xs text-[var(--brand-text-muted)]">{rank.impressions.toLocaleString()}</div>
                  <div className="text-right">
                    <IconButton
                      onClick={(e) => { e.stopPropagation(); removeKeyword(rank.query); }}
                      icon={Trash2}
                      label="Remove keyword"
                      size="sm"
                      variant="ghost"
                      className="text-[var(--brand-border-hover)] hover:text-red-400"
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 bg-[var(--surface-1)]/40">
                    {historyLoading ? (
                      <LoadingState message="Loading position history..." size="sm" className="py-2" />
                    ) : (
                      <PositionSparkline data={queryHistory} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : keywords.length > 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Keywords added but no rank data yet"
          description="Capture a snapshot to start tracking"
          className="py-8"
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={snapshotting ? undefined : RefreshCw}
              loading={snapshotting}
              disabled={!hasGsc || snapshotting}
              title={!hasGsc ? 'Connect Google Search Console in Workspace Settings to enable snapshots' : undefined}
              onClick={takeSnapshot}
            >
              {snapshotting ? 'Capturing...' : 'Take First Snapshot'}
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={Target}
          title="No keywords tracked yet"
          description="Add keywords above, or generate a Keyword Strategy from the sidebar to discover target keywords"
          className="py-8"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (onNavigate) {
                  onNavigate(adminPath(workspaceId, 'seo-strategy'));
                  return;
                }
                window.location.assign(adminPath(workspaceId, 'seo-strategy'));
              }}
            >
              Open Strategy
            </Button>
          }
        />
      )}

      {/* Keywords without rank data */}
      {keywords.filter(k => !latestRanks.find(r => r.query === k.query)).length > 0 && (
        <SectionCard variant="subtle">
          <div className="space-y-2">
          <p className="t-caption text-[var(--brand-text-muted)]">Tracked but no rank data:</p>
          <div className="flex flex-wrap gap-1.5">
            {keywords.filter(k => !latestRanks.find(r => r.query === k.query)).map(k => (
              <span key={k.query} className="flex items-center gap-1 t-caption px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text)]">
                {k.query}
                <IconButton
                  onClick={() => removeKeyword(k.query)}
                  icon={Trash2}
                  label={`Remove ${k.query}`}
                  size="sm"
                  variant="ghost"
                  className="text-[var(--brand-text-muted)] hover:text-red-400"
                />
              </span>
            ))}
          </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
