/**
 * SchemaVersionHistory — self-contained version history panel.
 * Fetches history on mount and handles rollback via the server.
 */
import { useState, useEffect } from 'react';
import { getSafe, post } from '../../api/client';
import { Loader2, RotateCcw, ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';

interface PublishEntry {
  id: string;
  publishedAt: string;
  schemaJson: Record<string, unknown>;
}

interface SchemaVersionHistoryProps {
  siteId: string;
  pageId: string;
  workspaceId?: string;
  onRestore: (schema: Record<string, unknown>) => void;
}

export function SchemaVersionHistory({ siteId, pageId, workspaceId, onRestore }: SchemaVersionHistoryProps) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PublishEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSafe<{ history: PublishEntry[] }>(
      `/api/webflow/schema-history/${siteId}/${pageId}?workspaceId=${workspaceId || ''}`,
      { history: [] },
    )
      .then(({ history: h }) => setHistory(h))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [siteId, pageId, workspaceId]);

  const handleRollback = async (entry: PublishEntry) => {
    setRollingBack(entry.id);
    try {
      const result = await post<{ success: boolean; restoredSchema: Record<string, unknown> }>(
        `/api/webflow/schema-rollback/${siteId}?workspaceId=${workspaceId || ''}`,
        { pageId, historyId: entry.id },
      );
      if (result.success) {
        setRestored(entry.id);
        onRestore(result.restoredSchema);
      }
    } catch {
      // error handled silently — user can retry
    } finally {
      setRollingBack(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
        <span className="text-xs text-zinc-500 ml-2">Loading history…</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-zinc-500">
        No publish history yet. Publish to Webflow to start tracking versions.
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {history.map((entry, i) => {
        const isExpanded = expandedId === entry.id;
        const date = new Date(entry.publishedAt);
        const isLatest = i === 0;
        const isRestored = restored === entry.id;

        return (
          <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
              >
                {isExpanded
                  ? <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />}
                <span className="text-[11px] text-zinc-300">
                  {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {isLatest && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                    current
                  </span>
                )}
              </button>
              {!isLatest && !isRestored && (
                <button
                  onClick={() => handleRollback(entry)}
                  disabled={rollingBack !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                  title="Restore this version"
                >
                  {rollingBack === entry.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />}
                  Restore
                </button>
              )}
              {isRestored && (
                <span className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                  <CheckCircle className="w-3 h-3" /> Restored
                </span>
              )}
            </div>
            {isExpanded && (
              <div className="px-3 pb-2">
                <pre className="text-[11px] font-mono bg-zinc-900 rounded p-2 overflow-x-auto text-zinc-500 max-h-40 overflow-y-auto whitespace-pre-wrap border border-zinc-800">
                  {JSON.stringify(entry.schemaJson, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
