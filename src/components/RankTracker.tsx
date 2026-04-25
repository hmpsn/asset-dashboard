import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, TrendingUp, Minus, Plus, Trash2, Pin, RefreshCw,
  Target, ArrowUp, ArrowDown, LineChart, ChevronDown,
} from 'lucide-react';
import { get, post, patch, del } from '../api/client';
import { EmptyState, SectionCard, Icon, Button } from './ui';
import { cn } from '../lib/utils';
import { chartGridColor, chartAxisColor } from './ui/constants';

// ── Trend colors (blue/teal/green family per design system — no violet/indigo) ──
const TREND_COLORS = ['#60a5fa', '#38bdf8', '#22d3ee', '#2dd4bf', '#34d399', '#06b6d4', '#0ea5e9'];

// ── Sparkline: compact position-over-time for a single keyword ──
function PositionSparkline({ data }: { data: { date: string; position: number }[] }) {
  if (data.length < 2) return <span className="t-caption text-[var(--brand-text-dim)] italic">Not enough snapshots for trend</span>;

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
  const dateRange = `${new Date(first.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(latest.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="flex items-center gap-4">
      <svg width={W} height={H} className="flex-shrink-0">
        <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="2.5" fill="#60a5fa" />
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
        <span className="t-caption-sm text-[var(--brand-text-dim)]">{data.length} snapshots · lower is better</span>
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
            {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[var(--brand-border)]">
        {keywords.map((kw, ki) => {
          const latest = data[data.length - 1]?.positions[kw];
          return (
            <div key={kw} className="flex items-center gap-1.5 t-caption">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TREND_COLORS[ki % TREND_COLORS.length] }} />
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

interface TrackedKeyword {
  query: string;
  pinned: boolean;
  addedAt: string;
}

interface LatestRank {
  query: string;
  position: number;
  previousPosition: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  change: number | null;
  pinned: boolean;
}

interface Props {
  workspaceId: string;
  hasGsc?: boolean;
}

export function RankTracker({ workspaceId, hasGsc }: Props) {
  const [keywords, setKeywords] = useState<TrackedKeyword[]>([]);
  const [latestRanks, setLatestRanks] = useState<LatestRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState('');
  const [adding, setAdding] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [error, setError] = useState('');

  // Trend/sparkline state
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<{ date: string; position: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [trendsData, setTrendsData] = useState<HistoryPoint[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const expandedQueryRef = useRef<string | null>(null);

  const load = async () => {
    try {
      const [kw, ranks] = await Promise.all([
        get<TrackedKeyword[]>(`/api/rank-tracking/${workspaceId}/keywords`),
        get<LatestRank[]>(`/api/rank-tracking/${workspaceId}/latest`),
      ]);
      if (Array.isArray(kw)) setKeywords(kw);
      if (Array.isArray(ranks)) setLatestRanks(ranks);
    } catch (err) {
      console.error('RankTracker operation failed:', err);
      setError('Failed to load rank data');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [workspaceId]);

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    setAdding(true);
    setError('');
    try {
      await post(`/api/rank-tracking/${workspaceId}/keywords`, { query: newKeyword.trim() });
      setNewKeyword('');
      await load();
    } catch { setError('Failed to add keyword'); }
    setAdding(false);
  };

  const removeKeyword = async (query: string) => {
    await del(`/api/rank-tracking/${workspaceId}/keywords/${encodeURIComponent(query)}`);
    setKeywords(prev => prev.filter(k => k.query !== query));
    setLatestRanks(prev => prev.filter(r => r.query !== query));
  };

  const togglePin = async (query: string) => {
    await patch(`/api/rank-tracking/${workspaceId}/keywords/${encodeURIComponent(query)}/pin`, {});
    setKeywords(prev => prev.map(k => k.query === query ? { ...k, pinned: !k.pinned } : k));
    setLatestRanks(prev => prev.map(r => r.query === query ? { ...r, pinned: !r.pinned } : r));
  };

  const takeSnapshot = async () => {
    setSnapshotting(true);
    setError('');
    try {
      await post(`/api/rank-tracking/${workspaceId}/snapshot`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot failed');
    }
    setSnapshotting(false);
  };

  // Expand a keyword row to show its sparkline
  const toggleExpand = useCallback(async (query: string) => {
    if (expandedQueryRef.current === query) {
      expandedQueryRef.current = null;
      setExpandedQuery(null);
      return;
    }
    expandedQueryRef.current = query;
    setExpandedQuery(query);
    setHistoryLoading(true);
    try {
      const history = await get<HistoryPoint[]>(`/api/rank-tracking/${workspaceId}/history?queries=${encodeURIComponent(query)}`);
      // Guard against stale response — only update if this query is still expanded
      if (expandedQueryRef.current !== query) return;
      setQueryHistory(
        (history || []).filter(h => h.positions[query] !== undefined).map(h => ({ date: h.date, position: h.positions[query] }))
      );
    } catch {
      if (expandedQueryRef.current !== query) return;
      setQueryHistory([]);
    }
    setHistoryLoading(false);
  }, [workspaceId]);

  // Load trends data for all pinned keywords
  const loadTrends = useCallback(async () => {
    const pinned = latestRanks.filter(r => r.pinned).map(r => r.query);
    if (pinned.length === 0) { setShowTrends(false); return; }
    setShowTrends(true);
    setTrendsLoading(true);
    try {
      const history = await get<HistoryPoint[]>(`/api/rank-tracking/${workspaceId}/history?queries=${encodeURIComponent(pinned.join(','))}`);
      setTrendsData(history || []);
    } catch { setTrendsData([]); }
    setTrendsLoading(false);
  }, [workspaceId, latestRanks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icon as={Loader2} size="lg" className="animate-spin text-teal-400" />
      </div>
    );
  }

  const sorted = [...latestRanks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.position - b.position;
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon as={Target} size="lg" className="text-teal-400" />
          <h2 className="text-sm font-semibold text-[var(--brand-text-bright)]">Rank Tracker</h2>
          <span className="t-caption px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{keywords.length} keywords</span>
        </div>
        <div className="flex items-center gap-2">
          {latestRanks.some(r => r.pinned) && (
            <button
              onClick={() => showTrends ? setShowTrends(false) : loadTrends()}
              disabled={trendsLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] t-caption font-medium border transition-colors',
                showTrends
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                  : 'bg-[var(--surface-3)]/50 border-[var(--brand-border-hover)]/50 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)]',
              )}
            >
              {trendsLoading ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={LineChart} size="sm" />}
              Trends
            </button>
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
      </div>

      {!hasGsc && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-[var(--radius-sm)] px-4 py-3 text-xs text-amber-300">
          Connect Google Search Console in Workspace Settings to enable rank tracking snapshots.
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Add keyword */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          placeholder="Add keyword to track..."
          className="flex-1 px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-dim)]"
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
        <TrendsChart data={trendsData} keywords={latestRanks.filter(r => r.pinned).map(r => r.query)} />
      )}
      {showTrends && trendsLoading && (
        <div className="flex items-center justify-center py-8 gap-2 text-[var(--brand-text-muted)] text-xs">
          <Icon as={Loader2} size="md" className="animate-spin text-blue-400" /> Loading trend data...
        </div>
      )}

      {/* Rankings table */}
      {sorted.length > 0 ? (
        // pr-check-disable-next-line -- brand asymmetric signature on RankTracker rank-table card; non-SectionCard chrome
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
          <div className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2 t-caption font-medium text-[var(--brand-text-muted)] uppercase tracking-wider border-b border-[var(--brand-border)]">
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
                  className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2.5 items-center border-b border-[var(--brand-border)]/50 last:border-0 hover:bg-[var(--surface-3)]/20 cursor-pointer"
                  onClick={() => toggleExpand(rank.query)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button onClick={(e) => { e.stopPropagation(); togglePin(rank.query); }} className={cn('flex-shrink-0', rank.pinned ? 'text-amber-400' : 'text-[var(--brand-border-hover)] hover:text-[var(--brand-text)]')} aria-label={rank.pinned ? 'Unpin keyword' : 'Pin keyword'}>
                      <Icon as={Pin} size="sm" />
                    </button>
                    <Icon as={ChevronDown} size="sm" className={cn('text-[var(--brand-text-dim)] flex-shrink-0 transition-transform', isExpanded && 'rotate-180')} />
                    <span className="text-xs text-[var(--brand-text-bright)] truncate">{rank.query}</span>
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
                    <button onClick={(e) => { e.stopPropagation(); removeKeyword(rank.query); }} className="text-[var(--brand-border-hover)] hover:text-red-400 transition-colors" aria-label="Remove keyword">
                      <Icon as={Trash2} size="sm" />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 bg-[var(--surface-1)]/40">
                    {historyLoading ? (
                      <div className="flex items-center gap-2 py-2 text-[var(--brand-text-muted)] text-xs">
                        <Icon as={Loader2} size="sm" className="animate-spin text-blue-400" /> Loading history...
                      </div>
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
        <EmptyState icon={Target} title="No keywords tracked yet" description="Add keywords above, or generate a Keyword Strategy from the sidebar to discover target keywords" className="py-8" />
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
                <button onClick={() => removeKeyword(k.query)} className="text-[var(--brand-text-muted)] hover:text-red-400" aria-label={`Remove ${k.query}`}>
                  <Icon as={Trash2} size="xs" />
                </button>
              </span>
            ))}
          </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
