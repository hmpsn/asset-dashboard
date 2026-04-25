import { Icon } from '../ui';
import { AlertTriangle, Copy, Link2, ArrowRight, GitBranch, EyeOff } from 'lucide-react';

interface CannibalizationItem {
  keyword: string;
  pages: { path: string; position?: number; impressions?: number; clicks?: number; source: 'keyword_map' | 'gsc' }[];
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  action?: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
}

export interface CannibalizationAlertProps {
  items: CannibalizationItem[];
}

const sevColor = (sev: string) =>
  sev === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20'
  : sev === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  : 'text-[var(--brand-text)] bg-zinc-700/30 border-zinc-600/20';

const actionLabel = (action?: string) => {
  switch (action) {
    case 'canonical_tag': return { label: 'Canonical Tag', icon: Link2, color: 'text-blue-400 bg-blue-500/10' };
    case 'redirect_301': return { label: '301 Redirect', icon: ArrowRight, color: 'text-orange-400 bg-orange-500/10' };
    case 'differentiate': return { label: 'Differentiate', icon: GitBranch, color: 'text-[var(--brand-text)] bg-[var(--brand-text-muted)]/10' };
    case 'noindex': return { label: 'Noindex', icon: EyeOff, color: 'text-[var(--brand-text)] bg-zinc-700/30' };
    default: return null;
  }
};

export function CannibalizationAlert({ items }: CannibalizationAlertProps) {
  if (items.length === 0) return null;

  const highCount = items.filter(i => i.severity === 'high').length;

  return (
    <div className="bg-[var(--surface-2)] border border-red-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-red-300 mb-1 flex items-center gap-1.5">
        <Icon as={Copy} size="sm" className="text-red-300" /> Keyword Cannibalization
        {highCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/20 t-micro text-red-400 font-medium">{highCount} critical</span>
        )}
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Multiple pages competing for the same keyword dilute your ranking power. Consolidate to one canonical page.</p>
      <div className="space-y-2">
        {items.slice(0, 10).map((item, i) => (
          <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
            <div className="flex items-center justify-between">
              <span className="t-ui font-medium text-[var(--brand-text-bright)]">&ldquo;{item.keyword}&rdquo;</span>
              <div className="flex items-center gap-2">
                <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${sevColor(item.severity)}`}>
                  {item.severity}
                </span>
                <span className="t-micro text-[var(--brand-text-muted)]">{item.pages.length} pages</span>
              </div>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {item.pages.map((page, pi) => (
                <div key={pi} className="flex items-center gap-2 t-micro">
                  <span className={`font-mono ${pi === 0 ? 'text-emerald-400' : 'text-[var(--brand-text)]'}`}>{page.path}</span>
                  {page.position && <span className="text-[var(--brand-text-muted)]">pos #{Math.round(page.position)}</span>}
                  {page.impressions != null && page.impressions > 0 && <span className="text-blue-400">{page.impressions} impr</span>}
                  {page.clicks != null && page.clicks > 0 && <span className="text-teal-400">{page.clicks} clicks</span>}
                  <span className={`px-1 rounded ${page.source === 'gsc' ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-700/50 text-[var(--brand-text)]'}`}>
                    {page.source === 'gsc' ? 'GSC' : 'map'}
                  </span>
                </div>
              ))}
            </div>
            {item.action && (() => {
              const a = actionLabel(item.action);
              if (!a) return null;
              const ActionIcon = a.icon;
              return (
                <div className={`flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded t-micro font-medium ${a.color} w-fit`}>
                  <Icon as={ActionIcon} size="xs" />
                  {a.label}
                  {item.canonicalPath && <span className="font-mono ml-1 opacity-70">→ {item.canonicalPath}</span>}
                </div>
              );
            })()}
            <div className="flex items-start gap-1 mt-1">
              <Icon as={AlertTriangle} size="sm" className="text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="t-caption-sm text-amber-400">{item.recommendation}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
