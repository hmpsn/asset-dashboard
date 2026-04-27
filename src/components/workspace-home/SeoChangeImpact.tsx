import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Clock, Pencil } from 'lucide-react';
import { SectionCard, EmptyState, TrendBadge, Icon } from '../ui';
import { getOptional } from '../../api/client';

interface SeoChangeEvent {
  id: string;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  fields: string[];
  source: string;
  changedAt: string;
}

interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageImpact {
  change: SeoChangeEvent;
  before: Metrics | null;
  after: Metrics | null;
  daysSinceChange: number;
  tooRecent: boolean;
}

interface SeoChangeImpactProps {
  workspaceId: string;
  hasGsc: boolean;
  embedded?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  editor: 'SEO Editor',
  'bulk-fix': 'Bulk Fix',
  approval: 'Approval',
  'cart-fix': 'Cart Fix',
  'content-delivery': 'Content',
  schema: 'Schema',
  'schema-template': 'CMS Schema',
};

function DeltaBadge({ before, after, label, invert }: { before: number; after: number; label: string; invert?: boolean }) {
  if (before === 0 && after === 0) return null;
  const diff = after - before;
  const pct = before > 0 ? ((diff / before) * 100) : (after > 0 ? 100 : 0);

  return (
    <div className="flex items-center gap-1.5">
      <span className="t-micro text-[var(--brand-text-muted)] w-12">{label}</span>
      <span className="t-caption-sm font-medium text-[var(--brand-text)] tabular-nums w-10 text-right">
        {label === 'CTR' ? `${after.toFixed(1)}%` : label === 'Pos' ? after.toFixed(1) : after.toLocaleString()}
      </span>
      <TrendBadge value={Math.round(pct)} invert={invert} showSign hideOnZero={false} />
    </div>
  );
}

export function SeoChangeImpact({ workspaceId, hasGsc, embedded }: SeoChangeImpactProps) {
  const [changes, setChanges] = useState<SeoChangeEvent[]>([]);
  const [impact, setImpact] = useState<PageImpact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showImpact, setShowImpact] = useState(false);

  useEffect(() => {
    getOptional<{ changes?: SeoChangeEvent[] }>(`/api/seo-changes/${workspaceId}?limit=20`)
      .then(d => { if (d?.changes) setChanges(d.changes); })
      .catch((err) => { console.error('SeoChangeImpact operation failed:', err); });
  }, [workspaceId]);

  const loadImpact = () => {
    if (!hasGsc || loading) return;
    setLoading(true);
    setShowImpact(true);
    getOptional<{ impact?: PageImpact[] }>(`/api/seo-change-impact/${workspaceId}?limit=10`)
      .then(d => { if (d?.impact) setImpact(d.impact); })
      .catch((err) => { console.error('SeoChangeImpact operation failed:', err); })
      .finally(() => setLoading(false));
  };

  const recentCount = changes.length;
  const daySpan = useMemo(() => {
    if (changes.length === 0) return 0;
    const oldestDate = new Date(changes[changes.length - 1].changedAt);
    return Math.ceil((new Date().getTime() - oldestDate.getTime()) / 86400_000);
  }, [changes]);

  if (changes.length === 0) return null;

  const actionButton = hasGsc && !showImpact ? (
    <button
      onClick={loadImpact}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-lg)] t-caption-sm font-medium text-teal-400 bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
    >
      <Icon as={TrendingUp} size="sm" /> Compare GSC Impact
    </button>
  ) : null;

  const innerContent = (
    <>
      {/* Summary */}
      <div className="flex items-center gap-4 mb-3">
        <div className="t-caption-sm text-[var(--brand-text-muted)]">
          <span className="text-[var(--brand-text-bright)] font-medium">{recentCount}</span> SEO changes in the last <span className="text-[var(--brand-text-bright)] font-medium">{daySpan}</span> days
        </div>
      </div>

      {/* Impact view */}
      {showImpact && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[var(--brand-text-muted)] t-caption">
              <div className="w-4 h-4 border-2 border-[var(--surface-3)] border-t-teal-400 rounded-full animate-spin" />
              Fetching GSC data for comparison...
            </div>
          ) : impact && impact.length > 0 ? (
            impact.map(item => (
              <div key={item.change.id} className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border)] p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">
                      {item.change.pageTitle || `/${item.change.pageSlug}`}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="t-micro text-[var(--brand-text-muted)]">/{item.change.pageSlug}</span>
                      <span className="t-micro px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--brand-border-hover)] text-[var(--brand-text-muted)]">
                        {item.change.fields.join(', ')}
                      </span>
                      <span className="t-micro text-zinc-600">
                        via {SOURCE_LABELS[item.change.source] || item.change.source}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 t-micro text-zinc-600 flex-shrink-0">
                    <Icon as={Clock} size="sm" />
                    {item.daysSinceChange}d ago
                  </div>
                </div>

                {item.tooRecent ? (
                  <div className="t-caption-sm text-zinc-600 italic flex items-center gap-1.5 py-1">
                    <Icon as={Clock} size="sm" /> Too recent for comparison (need 7+ days)
                  </div>
                ) : item.before && item.after ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    <DeltaBadge before={item.before.clicks} after={item.after.clicks} label="Clicks" />
                    <DeltaBadge before={item.before.impressions} after={item.after.impressions} label="Impr" />
                    <DeltaBadge before={item.before.ctr} after={item.after.ctr} label="CTR" />
                    <DeltaBadge before={item.before.position} after={item.after.position} label="Pos" invert />
                  </div>
                ) : (
                  <div className="t-caption-sm text-zinc-600 italic py-1">
                    {!item.before && !item.after ? 'No GSC data found for this page' : 'Partial data available'}
                  </div>
                )}
              </div>
            ))
          ) : impact && impact.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No impact data available yet" className="py-6" />
          ) : null}
        </div>
      )}

      {/* Recent changes list (when impact not loaded) */}
      {!showImpact && (
        <div className="space-y-1">
          {changes.slice(0, 5).map(c => (
            <div key={c.id} className="flex items-center gap-3 py-1.5">
              <Icon as={Pencil} size="sm" className="text-teal-400/60 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="t-caption-sm text-[var(--brand-text)] truncate block">
                  {c.pageTitle || `/${c.pageSlug}`}
                </span>
              </div>
              <span className="t-micro px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--brand-border-hover)] text-[var(--brand-text-muted)] flex-shrink-0">
                {c.fields.join(', ')}
              </span>
              <span className="t-micro text-zinc-600 flex-shrink-0">
                {new Date(c.changedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
          {changes.length > 5 && (
            <div className="t-caption-sm text-[var(--brand-text-muted)] pt-1">
              +{changes.length - 5} more changes
            </div>
          )}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="border-t border-[var(--brand-border)] px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="t-caption-sm font-medium text-[var(--brand-text-muted)] flex items-center gap-1.5">
            <Icon as={Pencil} size="sm" className="text-teal-400" /> SEO Change Tracker
          </span>
          {actionButton}
        </div>
        {innerContent}
      </div>
    );
  }

  return (
    <SectionCard
      title="SEO Change Tracker"
      titleIcon={<Icon as={Pencil} size="md" className="text-teal-400" />}
      action={actionButton}
    >
      {innerContent}
    </SectionCard>
  );
}
