import { Badge, Icon } from '../ui';
import { Eye, Users } from 'lucide-react';

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
    <div className="bg-[var(--surface-2)] border border-orange-500/20 p-5 rounded-[var(--radius-signature)]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h4 className="t-caption-sm font-semibold text-orange-300 flex items-center gap-1.5">
          <Icon as={Users} size="md" className="text-orange-300" /> Raw Competitor Evidence
        </h4>
        <Badge tone="orange" size="sm" label="Evidence only" icon={Eye} />
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
        Provider terms competitors rank for. These stay visible for auditability, but selected strategy actions are filtered separately.
      </p>
      <div className="space-y-1">
        {keywordGaps.map((gap, i) => (
          <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]">
            <span className="t-caption-sm text-[var(--brand-text-bright)]">{gap.keyword}</span>
            <div className="flex items-center gap-2">
              <span className="t-mono text-[var(--brand-text-muted)]">{gap.volume.toLocaleString()}/mo</span>
              <span className={`t-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{gap.competitorDomain} #{gap.competitorPosition}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
