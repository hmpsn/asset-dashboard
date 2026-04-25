import { useState, useEffect } from 'react';
import { Icon } from '../ui';
import { RefreshCw, Plus, Minus, ArrowRight, ChevronDown } from 'lucide-react';
import { keywords } from '../../api/seo';
import type { StrategyDiff as StrategyDiffType } from '../../api/seo';

export interface StrategyDiffProps {
  workspaceId: string;
}

export function StrategyDiff({ workspaceId }: StrategyDiffProps) {
  const [diff, setDiff] = useState<StrategyDiffType | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    keywords.strategyDiff(workspaceId)
      .then(d => setDiff(d ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading || !diff) return null;

  const hasChanges = diff.newKeywords.length > 0 || diff.lostKeywords.length > 0 ||
    diff.newGaps.length > 0 || diff.resolvedGaps.length > 0 || diff.keywordChanges.length > 0;

  if (!hasChanges) return null;

  const totalChanges = diff.newKeywords.length + diff.lostKeywords.length +
    diff.newGaps.length + diff.resolvedGaps.length + diff.keywordChanges.length;

  return (
    // pr-check-disable-next-line -- brand asymmetric signature on StrategyDiff "What Changed" callout; amber-bordered non-SectionCard chrome
    <div className="bg-[var(--surface-2)] border border-amber-500/20 overflow-hidden rounded-[var(--radius-signature-lg)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon as={RefreshCw} size="sm" className="text-amber-400" />
          <span className="t-ui font-semibold text-amber-300">What Changed</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} since {new Date(diff.previousGeneratedAt).toLocaleDateString()}
          </span>
        </div>
        <Icon as={ChevronDown} size="sm" className={`text-[var(--brand-text-muted)] transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50 space-y-3 mt-3">
          {/* New site keywords */}
          {diff.newKeywords.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">New Keywords</div>
              <div className="flex flex-wrap gap-1">
                {diff.newKeywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 t-caption-sm text-emerald-400">
                    <Icon as={Plus} size="xs" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Lost site keywords */}
          {diff.lostKeywords.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Removed Keywords</div>
              <div className="flex flex-wrap gap-1">
                {diff.lostKeywords.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20 t-caption-sm text-red-400">
                    <Icon as={Minus} size="xs" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* New content gaps */}
          {diff.newGaps.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">New Content Gaps</div>
              <div className="flex flex-wrap gap-1">
                {diff.newGaps.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 t-caption-sm text-emerald-400">
                    <Icon as={Plus} size="xs" />{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resolved content gaps */}
          {diff.resolvedGaps.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Resolved Gaps</div>
              <div className="flex flex-wrap gap-1">
                {diff.resolvedGaps.map(kw => (
                  <span key={kw} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-zinc-700/30 border border-zinc-600/20 t-caption-sm text-[var(--brand-text)] line-through">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Keyword reassignments */}
          {diff.keywordChanges.length > 0 && (
            <div>
              <div className="t-micro text-[var(--brand-text-muted)] uppercase tracking-wider font-medium mb-1.5">Keyword Reassignments</div>
              <div className="space-y-1">
                {diff.keywordChanges.map((ch, i) => (
                  <div key={i} className="flex items-center gap-2 t-caption-sm px-2 py-1 bg-[var(--surface-3)]/40 rounded border border-[var(--brand-border)]">
                    <span className="t-mono text-[var(--brand-text-muted)] truncate max-w-[200px]">{ch.pagePath}</span>
                    <span className="text-amber-400">{ch.oldKeyword}</span>
                    <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-dim)] flex-shrink-0" />
                    <span className="text-teal-400">{ch.newKeyword}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
