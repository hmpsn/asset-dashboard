/**
 * Audit history panel — extracted from SeoAudit.tsx
 */
import { useState } from 'react';
import {
  CheckCircle, Globe, RefreshCw, Copy, ExternalLink, Clock,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { scoreColorClass } from '../ui';
import { ScoreTrendChart } from './ScoreTrendChart';
import { ActionItemsPanel } from './ActionItemsPanel';
import type { SnapshotSummary } from './types';

export function AuditHistory({ siteId, history, onRefresh }: { siteId: string; history: SnapshotSummary[]; onRefresh: () => void }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openReport = (id: string) => {
    window.open(`/report/${id}`, '_blank');
  };

  const copyLink = (id: string) => {
    setLoadingId(id);
    navigator.clipboard.writeText(`${window.location.origin}/report/${id}`);
    setTimeout(() => setLoadingId(null), 1500);
  };

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Clock className="w-8 h-8 text-zinc-500" />
        </div>
        <p className="text-zinc-400 text-sm">No audit history yet</p>
        <p className="text-xs text-zinc-500 max-w-md text-center">
          Run an SEO audit and click "Save & Share" to start tracking changes over time
        </p>
      </div>
    );
  }

  const latest = history[0];
  const previous = history.length > 1 ? history[1] : null;
  const scoreDelta = previous ? latest.siteScore - previous.siteScore : 0;
  const errorDelta = previous ? latest.errors - previous.errors : 0;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Latest Score</div>
          <div className="flex items-end gap-2">
            <span className={`text-3xl font-bold ${scoreColorClass(latest.siteScore)}`}>{latest.siteScore}</span>
            {scoreDelta !== 0 && (
              <span className={`flex items-center gap-0.5 text-xs font-medium pb-1 ${scoreDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {scoreDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {scoreDelta > 0 ? '+' : ''}{scoreDelta}
              </span>
            )}
            {scoreDelta === 0 && previous && (
              <span className="flex items-center gap-0.5 text-xs text-zinc-500 pb-1"><Minus className="w-3 h-3" /> No change</span>
            )}
          </div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Total Audits</div>
          <div className="text-3xl font-bold text-zinc-200">{history.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Error Trend</div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-red-400">{latest.errors}</span>
            {errorDelta !== 0 && previous && (
              <span className={`text-xs font-medium pb-1 ${errorDelta < 0 ? 'text-green-400' : 'text-red-400'}`}>
                {errorDelta > 0 ? '+' : ''}{errorDelta}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Score trend chart */}
      {history.length >= 2 && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-sm font-medium text-zinc-300 mb-3">Score Trend</div>
          <ScoreTrendChart history={history} />
        </div>
      )}

      {/* Action items for latest snapshot */}
      {history.length > 0 && <ActionItemsPanel snapshotId={history[0].id} />}

      {/* Audit report link */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800">
        <Globe className="w-4 h-4 flex-shrink-0 text-teal-400" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-300">Audit Report</div>
          <div className="text-xs text-zinc-500 truncate font-mono">{window.location.origin}/report/audit/{siteId}</div>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/report/audit/${siteId}`);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
        <a href={`/report/audit/${siteId}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-zinc-800 text-teal-400">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Snapshot list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-zinc-300">Audit History</div>
          <button onClick={onRefresh} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="space-y-1">
          {history.map((snap, i) => {
            const date = new Date(snap.createdAt);
            const prev = history[i + 1];
            const delta = prev ? snap.siteScore - prev.siteScore : 0;
            return (
              <div key={snap.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-zinc-900/50 transition-colors group">
                <div className={`text-lg font-bold tabular-nums w-10 ${scoreColorClass(snap.siteScore)}`}>{snap.siteScore}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300">
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    <span className="text-zinc-500 ml-2">{date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {snap.totalPages} pages · {snap.errors} errors · {snap.warnings} warnings
                    {delta !== 0 && (
                      <span className={`ml-2 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ({delta > 0 ? '+' : ''}{delta} pts)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copyLink(snap.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    title="Copy share link"
                  >
                    {loadingId === snap.id ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => openReport(snap.id)}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                    title="View report"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
