import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, TrendingUp, Minus, Plus, Trash2, Pin, RefreshCw,
  Target, ArrowUp, ArrowDown, LineChart, ChevronDown,
} from 'lucide-react';
import { get, post, patch, del } from '../api/client';
import { EmptyState } from './ui';

// ── Trend colors (blue/teal/green family per design system — no violet/indigo) ──
const TREND_COLORS = ['#60a5fa', '#38bdf8', '#22d3ee', '#2dd4bf', '#34d399', '#06b6d4', '#0ea5e9'];

// ── Sparkline: compact position-over-time for a single keyword ──
function PositionSparkline({ data }: { data: { date: string; position: number }[] }) {
  if (data.length < 2) return <span className="text-[11px] text-zinc-600 italic">Not enough snapshots for trend</span>;

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
      <div className="text-[10px] text-zinc-500 space-y-0.5">
        <div>Best: <span className="text-emerald-400 font-medium">#{min.toFixed(1)}</span> · Worst: <span className="text-red-400 font-medium">#{max.toFixed(1)}</span></div>
        <div className="flex items-center gap-1">
          <span>{data.length} snapshots</span>
          <span className="text-zinc-700">·</span>
          <span>{dateRange}</span>
        </div>
        <div className={improved ? 'text-emerald-400' : latest.position > first.position ? 'text-red-400' : 'text-zinc-500'}>
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
    <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-zinc-300">Position History — Pinned Keywords</h4>
        <span className="text-[10px] text-zinc-600">{data.length} snapshots · lower is better</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="overflow-visible">
        {/* Y gridlines + labels */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="#27272a" strokeDasharray="3,3" />
            <text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill="#52525b" fontSize="9">#{v}</text>
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
          <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill="#52525b" fontSize="9">
            {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-zinc-800">
        {keywords.map((kw, ki) => {
          const latest = data[data.length - 1]?.positions[kw];
          return (
            <div key={kw} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TREND_COLORS[ki % TREND_COLORS.length] }} />
              <span className="text-zinc-400">{kw}</span>
              {latest !== undefined && <span className="text-zinc-600">#{latest.toFixed(1)}</span>}
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
    } catch (err) { console.error('RankTracker operation failed:', err); }
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
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
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
          <Target className="w-5 h-5 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Rank Tracker</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{keywords.length} keywords</span>
        </div>
        <div className="flex items-center gap-2">
          {latestRanks.some(r => r.pinned) && (
            <button
              onClick={() => showTrends ? setShowTrends(false) : loadTrends()}
              disabled={trendsLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                showTrends
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                  : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
              }`}
            >
              {trendsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <LineChart className="w-3 h-3" />}
              Trends
            </button>
          )}
          {hasGsc && (
            <button
              onClick={takeSnapshot}
              disabled={snapshotting || keywords.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
            >
              {snapshotting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {snapshotting ? 'Capturing...' : 'Capture Snapshot'}
            </button>
          )}
        </div>
      </div>

      {!hasGsc && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-300">
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
          className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600"
          onKeyDown={e => e.key === 'Enter' && !adding && addKeyword()}
        />
        <button
          onClick={addKeyword}
          disabled={!newKeyword.trim() || adding}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
        >
          {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add
        </button>
      </div>

      {/* Trends chart for pinned keywords */}
      {showTrends && !trendsLoading && trendsData.length >= 2 && (
        <TrendsChart data={trendsData} keywords={latestRanks.filter(r => r.pinned).map(r => r.query)} />
      )}
      {showTrends && trendsLoading && (
        <div className="flex items-center justify-center py-8 gap-2 text-zinc-500 text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" /> Loading trend data...
        </div>
      )}

      {/* Rankings table */}
      {sorted.length > 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
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
                  className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2.5 items-center border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20 cursor-pointer"
                  onClick={() => toggleExpand(rank.query)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button onClick={(e) => { e.stopPropagation(); togglePin(rank.query); }} className={`flex-shrink-0 ${rank.pinned ? 'text-amber-400' : 'text-zinc-700 hover:text-zinc-400'}`} aria-label={rank.pinned ? 'Unpin keyword' : 'Pin keyword'}>
                      <Pin className="w-3 h-3" />
                    </button>
                    <ChevronDown className={`w-3 h-3 text-zinc-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    <span className="text-xs text-zinc-200 truncate">{rank.query}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${rank.position <= 3 ? 'text-green-400' : rank.position <= 10 ? 'text-teal-400' : rank.position <= 20 ? 'text-amber-400' : 'text-zinc-400'}`}>
                      {Math.round(rank.position * 10) / 10}
                    </span>
                  </div>
                  <div className="text-right">
                    {rank.change != null ? (
                      <span className={`flex items-center justify-end gap-0.5 text-xs font-medium ${rank.change < 0 ? 'text-green-400' : rank.change > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                        {rank.change < 0 ? <ArrowUp className="w-3 h-3" /> : rank.change > 0 ? <ArrowDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {rank.change !== 0 ? Math.abs(Math.round(rank.change * 10) / 10) : '—'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-zinc-500">—</span>
                    )}
                  </div>
                  <div className="text-right text-xs text-zinc-400">{rank.clicks}</div>
                  <div className="text-right text-xs text-zinc-500">{rank.impressions.toLocaleString()}</div>
                  <div className="text-right">
                    <button onClick={(e) => { e.stopPropagation(); removeKeyword(rank.query); }} className="text-zinc-700 hover:text-red-400 transition-colors" aria-label="Remove keyword">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 py-3 border-b border-zinc-800/50 bg-zinc-950/40">
                    {historyLoading ? (
                      <div className="flex items-center gap-2 py-2 text-zinc-500 text-xs">
                        <Loader2 className="w-3 h-3 animate-spin text-blue-400" /> Loading history...
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
        <EmptyState icon={TrendingUp} title="Keywords added but no rank data yet" description="Capture a snapshot to start tracking" className="py-8" />
      ) : (
        <EmptyState icon={Target} title="No keywords tracked yet" description="Add keywords above, or generate a Keyword Strategy from the sidebar to discover target keywords" className="py-8" />
      )}

      {/* Keywords without rank data */}
      {keywords.filter(k => !latestRanks.find(r => r.query === k.query)).length > 0 && (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-3">
          <div className="text-[11px] text-zinc-500 mb-2">Tracked but no rank data:</div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.filter(k => !latestRanks.find(r => r.query === k.query)).map(k => (
              <span key={k.query} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-400">
                {k.query}
                <button onClick={() => removeKeyword(k.query)} className="text-zinc-500 hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
