import { useState, useEffect } from 'react';
import {
  Loader2, TrendingUp, Minus, Plus, Trash2, Pin, RefreshCw,
  Target, ArrowUp, ArrowDown,
} from 'lucide-react';
import { get, post, patch, del } from '../api/client';

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Rank Tracker</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{keywords.length} keywords</span>
        </div>
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

      {/* Rankings table */}
      {sorted.length > 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
            <span>Keyword</span>
            <span className="text-right">Position</span>
            <span className="text-right">Change</span>
            <span className="text-right">Clicks</span>
            <span className="text-right">Impressions</span>
            <span></span>
          </div>
          {sorted.map(rank => (
            <div key={rank.query} className="grid grid-cols-[1fr,80px,80px,80px,80px,60px] gap-2 px-4 py-2.5 items-center border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => togglePin(rank.query)} className={`flex-shrink-0 ${rank.pinned ? 'text-amber-400' : 'text-zinc-700 hover:text-zinc-400'}`} aria-label={rank.pinned ? 'Unpin keyword' : 'Pin keyword'}>
                  <Pin className="w-3 h-3" />
                </button>
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
                <button onClick={() => removeKeyword(rank.query)} className="text-zinc-700 hover:text-red-400 transition-colors" aria-label="Remove keyword">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : keywords.length > 0 ? (
        <div className="text-center py-8">
          <TrendingUp className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">Keywords added but no rank data yet</p>
          <p className="text-[11px] text-zinc-500 mt-1">Capture a snapshot to start tracking</p>
        </div>
      ) : (
        <div className="text-center py-8">
          <Target className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">No keywords tracked yet</p>
          <p className="text-[11px] text-zinc-500 mt-1">Add keywords above, or generate a <strong className="text-teal-400">Keyword Strategy</strong> from the sidebar to discover target keywords</p>
        </div>
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
