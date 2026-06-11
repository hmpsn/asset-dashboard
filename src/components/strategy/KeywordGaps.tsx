import { Badge, Icon, IconButton } from '../ui';
import { ArrowUpRight, Eye, Users } from 'lucide-react';
import { adminPath } from '../../routes';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';

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
  /** When provided with keywordHubEnabled=true, each row gets a "View in Hub" link. */
  workspaceId?: string;
  navigate?: (path: string) => void;
  keywordHubEnabled?: boolean;
}

export function KeywordGaps({ keywordGaps, difficultyColor, workspaceId, navigate, keywordHubEnabled }: KeywordGapsProps) {
  if (keywordGaps.length === 0) return null;

  const showHubLink = !!(keywordHubEnabled && workspaceId && navigate);

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
              {showHubLink && (
                <IconButton
                  onClick={() => navigate!(adminPath(workspaceId!, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: gap.keyword }))}
                  title="View in Hub"
                  label="View in Hub"
                  icon={ArrowUpRight}
                  size="sm"
                  variant="ghost"
                  className="text-[var(--brand-text-muted)] hover:text-accent-brand"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
