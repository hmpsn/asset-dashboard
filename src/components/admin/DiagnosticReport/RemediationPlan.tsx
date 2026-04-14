import { SectionCard } from '../../ui/SectionCard.js';
import type { RemediationAction } from '../../../../shared/types/diagnostics.js';

const PRIORITY_COLORS = {
  P0: 'bg-red-500/10 text-red-400',
  P1: 'bg-amber-500/10 text-amber-400',
  P2: 'bg-blue-500/10 text-blue-400',
  P3: 'bg-zinc-500/10 text-zinc-400',
} as const;

const EFFORT_LABELS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' } as const;
const IMPACT_LABELS = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' } as const;
const OWNER_LABELS = { dev: 'Dev', content: 'Content', seo: 'SEO' } as const;

interface Props {
  actions: RemediationAction[];
}

export function RemediationPlan({ actions }: Props) {
  const sorted = [...actions].sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return order[a.priority] - order[b.priority];
  });

  return (
    <div className="space-y-2">
      {sorted.map((action, i) => (
        <SectionCard key={i}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLORS[action.priority]}`}>
                {action.priority}
              </span>
              <h4 className="text-sm font-medium text-zinc-200">{action.title}</h4>
            </div>
            <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">
              {OWNER_LABELS[action.owner]}
            </span>
          </div>
          <p className="text-sm text-zinc-400 mb-2">{action.description}</p>
          <div className="flex gap-3 text-xs text-zinc-500">
            <span>{EFFORT_LABELS[action.effort]}</span>
            <span className="text-zinc-700">|</span>
            <span>{IMPACT_LABELS[action.impact]}</span>
          </div>
          {action.pageUrls && action.pageUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {action.pageUrls.map((url) => (
                <span key={url} className="text-xs bg-zinc-800/50 text-blue-400 px-2 py-0.5 rounded font-mono truncate max-w-[200px]">
                  {url}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      ))}
    </div>
  );
}
