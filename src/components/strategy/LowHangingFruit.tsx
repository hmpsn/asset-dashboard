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
    <div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4">
      <h4 className="text-xs font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5" /> Low-Hanging Fruit
      </h4>
      <p className="text-[11px] text-zinc-500 mb-3">Pages ranking #4–20 with significant impressions — small improvements here drive major traffic gains.</p>
      <div className="space-y-1.5">
        {pages.map((page, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-lg">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-zinc-300 truncate">{page.pageTitle}</div>
              <div className="text-[11px] text-zinc-500 font-mono">{page.pagePath}</div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
              <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded truncate max-w-[160px]">{page.primaryKeyword}</span>
              <span className={`text-[11px] font-mono font-medium ${positionColor(page.currentPosition)}`}>#{page.currentPosition?.toFixed(0)}</span>
              <span className="text-[11px] text-zinc-500">{(page.impressions || 0).toLocaleString()} imp</span>
              {page.clicks !== undefined && page.clicks > 0 && <span className="text-[11px] text-zinc-500">{page.clicks} clicks</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
