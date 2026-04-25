import { Icon } from '../ui';
import { Zap } from 'lucide-react';

interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

export interface LowHangingFruitProps {
  pages: PageKeywordMap[];
  positionColor: (pos?: number) => string;
}

export function LowHangingFruit({ pages, positionColor }: LowHangingFruitProps) {
  if (pages.length === 0) return null;

  return (
    <div className="bg-[var(--surface-2)] border border-amber-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
        <Icon as={Zap} size="sm" className="text-amber-300" /> Low-Hanging Fruit
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Pages ranking #4–20 with significant impressions — small improvements here drive major traffic gains.</p>
      <div className="space-y-1.5">
        {pages.map((page, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]">
            <div className="flex-1 min-w-0">
              <div className="t-caption-sm text-[var(--zinc-300)] truncate">{page.pageTitle}</div>
              <div className="t-mono text-[var(--brand-text-muted)]">{page.pagePath}</div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
              <span className="t-caption-sm text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded truncate max-w-[160px]">{page.primaryKeyword}</span>
              <span className={`t-mono font-medium ${positionColor(page.currentPosition)}`}>#{page.currentPosition?.toFixed(0)}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{(page.impressions || 0).toLocaleString()} imp</span>
              {page.clicks !== undefined && page.clicks > 0 && <span className="t-caption-sm text-[var(--brand-text-muted)]">{page.clicks} clicks</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
