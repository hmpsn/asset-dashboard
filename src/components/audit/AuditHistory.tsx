/**
 * Audit history panel — extracted from SeoAudit.tsx
 */
import { useState } from 'react';
import {
  CheckCircle, Globe, RefreshCw, Copy, ExternalLink, Clock, Minus,
} from 'lucide-react';
import { scoreColorClass, EmptyState, TrendBadge, Icon, SectionCard, Button, IconButton, cn } from '../ui';
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
      <EmptyState icon={Clock} title="No audit history yet" description="Run an SEO audit and click 'Save & Share' to start tracking changes over time" />
    );
  }

  const latest = history[0];
  const previous = history.length > 1 ? history[1] : null;
  const scoreDelta = previous ? latest.siteScore - previous.siteScore : 0;
  const errorDelta = previous ? latest.errors - previous.errors : 0;

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-4">
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Latest Score</div>
          <div className="flex items-end gap-2">
            <span className={cn('text-3xl font-bold', scoreColorClass(latest.siteScore))}>{latest.siteScore}</span>
            {scoreDelta !== 0 && (
              <TrendBadge value={scoreDelta} suffix="" showSign size="md" className="pb-1" />
            )}
            {scoreDelta === 0 && previous && (
              <span className="flex items-center gap-0.5 t-caption text-[var(--brand-text-muted)] pb-1">
                <Icon as={Minus} size="sm" /> No change
              </span>
            )}
          </div>
        </div>
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-4">
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Total Audits</div>
          <div className="text-3xl font-bold text-[var(--brand-text-bright)]">{history.length}</div>
        </div>
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-4">
          <div className="t-caption text-[var(--brand-text-muted)] mb-1">Error Trend</div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-red-400">{latest.errors}</span>
            {errorDelta !== 0 && previous && (
              <TrendBadge value={errorDelta} suffix="" showSign invert size="md" className="pb-1" />
            )}
          </div>
        </div>
      </div>

      {/* Score trend chart */}
      {history.length >= 2 && (
        <SectionCard>
          <div className="t-body font-medium text-[var(--brand-text-bright)] mb-3">Score Trend</div>
          <ScoreTrendChart history={history} />
        </SectionCard>
      )}

      {/* Action items for latest snapshot */}
      {history.length > 0 && <ActionItemsPanel snapshotId={history[0].id} />}

      {/* Audit report link */}
      <SectionCard>
        <div className="flex items-center gap-3">
          <Icon as={Globe} size="md" className="flex-shrink-0 text-teal-400" />
          <div className="flex-1 min-w-0">
            <div className="t-caption font-medium text-[var(--brand-text-bright)]">Audit Report</div>
            <div className="t-caption text-[var(--brand-text-muted)] truncate font-mono">{window.location.origin}/report/audit/{siteId}</div>
          </div>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/report/audit/${siteId}`);
            }}
            icon={Copy}
            size="sm"
            variant="secondary"
            className="px-2.5 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)]"
          >
            Copy
          </Button>
          <a href={`/report/audit/${siteId}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] text-teal-400">
            <Icon as={ExternalLink} size="md" />
          </a>
        </div>
      </SectionCard>

      {/* Snapshot list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="t-body font-medium text-[var(--brand-text-bright)]">Audit History</div>
          <Button onClick={onRefresh} icon={RefreshCw} variant="ghost" size="sm" className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]">
            Refresh
          </Button>
        </div>
        <div className="space-y-1">
          {history.map((snap, i) => {
            const date = new Date(snap.createdAt);
            const prev = history[i + 1];
            const delta = prev ? snap.siteScore - prev.siteScore : 0;
            return (
              <div key={snap.id} className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] hover:bg-[var(--surface-2)]/50 transition-colors group">
                <div className={cn('text-lg font-bold tabular-nums w-10', scoreColorClass(snap.siteScore))}>{snap.siteScore}</div>
                <div className="flex-1 min-w-0">
                  <div className="t-body text-[var(--brand-text-bright)]">
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    <span className="text-[var(--brand-text-muted)] ml-2">{date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="t-caption text-[var(--brand-text-muted)]">
                    {snap.totalPages} pages · {snap.errors} errors · {snap.warnings} warnings
                    {delta !== 0 && (
                      <TrendBadge value={delta} suffix=" pts" showSign className="ml-2" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton
                    onClick={() => copyLink(snap.id)}
                    icon={loadingId === snap.id ? CheckCircle : Copy}
                    label="Copy share link"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'rounded-[var(--radius-md)] hover:bg-[var(--surface-2)]',
                      loadingId === snap.id ? 'text-emerald-400' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]',
                    )}
                    title="Copy share link"
                  />
                  <IconButton
                    onClick={() => openReport(snap.id)}
                    icon={ExternalLink}
                    label="View report"
                    variant="ghost"
                    size="sm"
                    className="rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
                    title="View report"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
