import { Users } from 'lucide-react';

interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface KeywordGapsProps {
  keywordGaps: KeywordGapItem[];
  difficultyColor: (kd?: number) => string;
}

export function KeywordGaps({ keywordGaps, difficultyColor }: KeywordGapsProps) {
  if (keywordGaps.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-orange-500/20 p-5" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <h4 className="text-xs font-semibold text-orange-300 mb-2 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> Competitor Keyword Gaps
      </h4>
      <p className="text-[11px] text-zinc-500 mb-2">Keywords your competitors rank for that you don't — high-priority opportunities.</p>
      <div className="space-y-1">
        {keywordGaps.map((gap, i) => (
          <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/50 rounded-lg">
            <span className="text-[11px] text-zinc-300">{gap.keyword}</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 font-mono">{gap.volume.toLocaleString()}/mo</span>
              <span className={`text-[11px] font-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
              <span className="text-[11px] text-zinc-500">{gap.competitorDomain} #{gap.competitorPosition}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
