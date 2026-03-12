import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Clock, Pencil, Minus } from 'lucide-react';
import { SectionCard } from '../ui';

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
  const isPositive = invert ? diff < 0 : diff > 0;
  const isNeutral = diff === 0;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-zinc-500 w-12">{label}</span>
      <span className="text-[11px] font-medium text-zinc-300 tabular-nums w-10 text-right">
        {label === 'CTR' ? `${after.toFixed(1)}%` : label === 'Pos' ? after.toFixed(1) : after.toLocaleString()}
      </span>
      {isNeutral ? (
        <span className="flex items-center gap-0.5 text-[10px] text-zinc-600">
          <Minus className="w-2.5 h-2.5" /> 0%
        </span>
      ) : (
        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
          {pct > 0 ? '+' : ''}{pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

export function SeoChangeImpact({ workspaceId, hasGsc }: SeoChangeImpactProps) {
  const [changes, setChanges] = useState<SeoChangeEvent[]>([]);
  const [impact, setImpact] = useState<PageImpact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showImpact, setShowImpact] = useState(false);

  useEffect(() => {
    fetch(`/api/seo-changes/${workspaceId}?limit=20`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.changes) setChanges(d.changes); })
      .catch(() => {});
  }, [workspaceId]);

  const loadImpact = () => {
    if (!hasGsc || loading) return;
    setLoading(true);
    setShowImpact(true);
    fetch(`/api/seo-change-impact/${workspaceId}?limit=10`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.impact) setImpact(d.impact); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const recentCount = changes.length;
  const daySpan = useMemo(() => {
    if (changes.length === 0) return 0;
    const oldestDate = new Date(changes[changes.length - 1].changedAt);
    return Math.ceil((new Date().getTime() - oldestDate.getTime()) / 86400_000);
  }, [changes]);

  if (changes.length === 0) return null;

  return (
    <SectionCard
      title="SEO Change Tracker"
      titleIcon={<Pencil className="w-4 h-4 text-violet-400" />}
      action={
        hasGsc && !showImpact ? (
          <button
            onClick={loadImpact}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-violet-400 bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 transition-all"
          >
            <TrendingUp className="w-3 h-3" /> Compare GSC Impact
          </button>
        ) : null
      }
    >
      {/* Summary */}
      <div className="flex items-center gap-4 mb-3">
        <div className="text-[11px] text-zinc-500">
          <span className="text-zinc-300 font-medium">{recentCount}</span> SEO changes in the last <span className="text-zinc-300 font-medium">{daySpan}</span> days
        </div>
      </div>

      {/* Impact view */}
      {showImpact && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-zinc-500 text-xs">
              <div className="w-4 h-4 border-2 border-zinc-600 border-t-violet-400 rounded-full animate-spin" />
              Fetching GSC data for comparison...
            </div>
          ) : impact && impact.length > 0 ? (
            impact.map(item => (
              <div key={item.change.id} className="rounded-lg bg-zinc-800/40 border border-zinc-800 p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-200 truncate">
                      {item.change.pageTitle || `/${item.change.pageSlug}`}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-zinc-500">/{item.change.pageSlug}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-400">
                        {item.change.fields.join(', ')}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        via {SOURCE_LABELS[item.change.source] || item.change.source}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-600 flex-shrink-0">
                    <Clock className="w-3 h-3" />
                    {item.daysSinceChange}d ago
                  </div>
                </div>

                {item.tooRecent ? (
                  <div className="text-[11px] text-zinc-600 italic flex items-center gap-1.5 py-1">
                    <Clock className="w-3 h-3" /> Too recent for comparison (need 7+ days)
                  </div>
                ) : item.before && item.after ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    <DeltaBadge before={item.before.clicks} after={item.after.clicks} label="Clicks" />
                    <DeltaBadge before={item.before.impressions} after={item.after.impressions} label="Impr" />
                    <DeltaBadge before={item.before.ctr} after={item.after.ctr} label="CTR" />
                    <DeltaBadge before={item.before.position} after={item.after.position} label="Pos" invert />
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-600 italic py-1">
                    {!item.before && !item.after ? 'No GSC data found for this page' : 'Partial data available'}
                  </div>
                )}
              </div>
            ))
          ) : impact && impact.length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-xs">No impact data available yet</div>
          ) : null}
        </div>
      )}

      {/* Recent changes list (when impact not loaded) */}
      {!showImpact && (
        <div className="space-y-1">
          {changes.slice(0, 5).map(c => (
            <div key={c.id} className="flex items-center gap-3 py-1.5">
              <Pencil className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] text-zinc-300 truncate block">
                  {c.pageTitle || `/${c.pageSlug}`}
                </span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50 text-zinc-400 flex-shrink-0">
                {c.fields.join(', ')}
              </span>
              <span className="text-[10px] text-zinc-600 flex-shrink-0">
                {new Date(c.changedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
          {changes.length > 5 && (
            <div className="text-[11px] text-zinc-500 pt-1">
              +{changes.length - 5} more changes
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
