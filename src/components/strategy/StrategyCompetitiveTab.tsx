import type { NavigateFunction } from 'react-router-dom';
import { Users } from 'lucide-react';
import { EmptyState } from '../ui';
import { ShareBar } from './ShareBar';
import { CompetitiveIntel } from './CompetitiveIntel';
import { BacklinkProfile } from './BacklinkProfile';
import { KeywordGaps } from './KeywordGaps';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { adminPath } from '../../routes';

/** Competitor-gap row (mirrors the standalone KeywordGaps item shape). */
interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

interface StrategyCompetitiveTabProps {
  workspaceId: string;
  competitors: string[];
  seoDataAvailable: boolean;
  keywordGaps: KeywordGapItem[];
  navigate: NavigateFunction;
  /** Passed through from KeywordStrategy (strategy-command-center flag). */
  commandCenterEnabled?: boolean;
  /** Passed through from KeywordStrategy (strategy-competitor-send doubly-gated flag). */
  competitorSendEnabled?: boolean;
}

/**
 * Strategy v2 Competitive tab — the "research mode" surface. Composes (in research order): share of
 * voice → head-to-head competitor comparison (CompetitiveIntel `merged`: no own-domain stat grid,
 * deduped to ShareBar/Orient; no embedded gaps, deduped to the standalone surface below) → keyword gaps
 * with a per-row Create-brief CTA → backlink/authority profile. Admin-only and ungated — the operator
 * sees the full competitive picture; the Premium gate is a Phase 6 client-reframe concern, not here.
 */
export function StrategyCompetitiveTab({ workspaceId, competitors, seoDataAvailable, keywordGaps, navigate, commandCenterEnabled, competitorSendEnabled }: StrategyCompetitiveTabProps) {
  if (!seoDataAvailable) {
    return (
      <EmptyState
        icon={Users}
        title="Competitive analysis requires DataForSEO"
        description="Configure a DataForSEO provider to compare share of voice, keyword gaps, and backlinks against your competitor set."
      />
    );
  }
  if (competitors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Add competitor domains"
        description="Enter competitors in Strategy Settings → Competitor Domains, then refresh your strategy to unlock share of voice, keyword gaps, and backlink comparisons."
      />
    );
  }

  return (
    <div className="space-y-8">
      <ShareBar workspaceId={workspaceId} competitors={competitors} seoDataAvailable={seoDataAvailable} />
      <CompetitiveIntel
        workspaceId={workspaceId}
        competitors={competitors}
        seoDataAvailable={seoDataAvailable}
        variant="merged"
        commandCenterEnabled={commandCenterEnabled}
        competitorSendEnabled={competitorSendEnabled}
      />
      <KeywordGaps
        keywordGaps={keywordGaps}
        difficultyColor={kdColor}
        workspaceId={workspaceId}
        navigate={navigate}
        onCreateBrief={(keyword) =>
          navigate(adminPath(workspaceId, 'seo-briefs'), {
            state: { fixContext: { targetRoute: 'seo-briefs', pageName: keyword } },
          })
        }
      />
      <BacklinkProfile workspaceId={workspaceId} />
    </div>
  );
}
