/**
 * SchemaVersionHistory — self-contained version history panel.
 * Fetches history on mount and handles rollback via the server.
 */
import { useState, useEffect } from 'react';
import { getSafe, post } from '../../api/client';
import { Loader2, RotateCcw, ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';
import { Icon, Button } from '../ui';

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
        <Icon as={Loader2} size="md" className="animate-spin text-[var(--brand-text-muted)]" />
        <span className="t-caption text-[var(--brand-text-muted)] ml-2">Loading history…</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-3 text-center t-caption text-[var(--brand-text-muted)]">
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
          <div key={entry.id} className="border border-[var(--brand-border)] bg-[var(--surface-1)] overflow-hidden rounded-[var(--radius-signature)]">
            <div className="flex items-center gap-2 px-3 py-2">
              <Button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                variant="ghost"
                size="sm"
                className="flex-1 min-w-0 justify-start h-auto px-0 py-0 text-left hover:opacity-80 hover:bg-transparent"
              >
                {isExpanded
                  ? <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  : <Icon as={ChevronRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
                <span className="t-caption-sm text-[var(--brand-text)]">
                  {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {isLatest && (
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                    current
                  </span>
                )}
              </Button>
              {!isLatest && !isRestored && (
                <Button
                  onClick={() => handleRollback(entry)}
                  disabled={rollingBack !== null}
                  loading={rollingBack === entry.id}
                  icon={RotateCcw}
                  size="sm"
                  variant="secondary"
                  className="px-2 py-1 rounded t-caption-sm font-medium disabled:opacity-50 bg-amber-500/8 text-amber-400/80 border border-amber-500/20 hover:bg-amber-500/15"
                  title="Restore this version"
                >
                  Restore
                </Button>
              )}
              {isRestored && (
                <span className="flex items-center gap-1 px-2 py-1 rounded t-caption-sm font-medium bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20">
                  <Icon as={CheckCircle} size="sm" /> Restored
                </span>
              )}
            </div>
            {isExpanded && (
              <div className="px-3 pb-2">
                <pre className="t-caption-sm font-mono bg-[var(--surface-2)] rounded p-2 overflow-x-auto text-[var(--brand-text-muted)] max-h-40 overflow-y-auto whitespace-pre-wrap border border-[var(--brand-border)]">
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
