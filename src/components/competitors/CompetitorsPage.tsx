import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { PageHeader, Icon, LoadingState } from '../ui';
import { useKeywordStrategy } from '../../hooks/admin';
import { useStrategySettings, StrategyCompetitiveTab } from '../strategy';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { CompetitorAlertsPanel } from './CompetitorAlertsPanel';

interface CompetitorsPageProps {
  workspaceId: string;
}

/**
 * The Issue — Phase 6: dedicated admin Competitors page. A NON_REGISTRY Page (no global nav item) —
 * reached via a flag-ON deep-link from The Issue cockpit, so flag-OFF nav stays byte-identical.
 *
 * Composes (in order): PageHeader → the net-new CompetitorAlertsPanel → the EXISTING
 * StrategyCompetitiveTab composition (ShareBar + CompetitiveIntel + KeywordGaps + BacklinkProfile),
 * fed the same props the cockpit feeds it. Strategy is loaded via the exact pattern KeywordStrategyPanel
 * uses (useKeywordStrategy → useStrategySettings → derived competitorList/seoDataAvailable/keywordGaps).
 */
export function CompetitorsPage({ workspaceId }: CompetitorsPageProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useKeywordStrategy(workspaceId);
  const strategy = data?.strategy ?? null;
  const settings = useStrategySettings(data, strategy, workspaceId);

  // Competitor domains as a clean array — consumed by StrategyCompetitiveTab (mirrors KeywordStrategyPanel).
  const competitorList = (settings.competitors || '')
    .split(/[,\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const seoDataAvailable = settings.seoDataAvailable;
  const keywordGaps = strategy?.keywordGaps ?? [];

  // Each useFeatureFlag MUST be read on its own line — NEVER on the RHS of `&&` (short-circuit makes
  // the hook conditional → Rules-of-Hooks crash, the documented Phase-1 bug). Mirror KeywordStrategy.tsx.
  const commandCenterEnabled = useFeatureFlag('strategy-command-center');
  const competitorSendFlag = useFeatureFlag('strategy-competitor-send');
  const competitorSendEnabled = commandCenterEnabled && competitorSendFlag;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Competitors"
        subtitle="Share of voice, keyword gaps, backlinks, and competitor movement."
        icon={<Icon as={Users} size="lg" className="text-accent-brand" />}
      />
      {isLoading ? (
        <LoadingState message="Loading competitor intelligence..." />
      ) : (
        <>
          <CompetitorAlertsPanel workspaceId={workspaceId} />
          <StrategyCompetitiveTab
            workspaceId={workspaceId}
            competitors={competitorList}
            seoDataAvailable={seoDataAvailable}
            keywordGaps={keywordGaps}
            navigate={navigate}
            commandCenterEnabled={commandCenterEnabled}
            competitorSendEnabled={competitorSendEnabled}
          />
        </>
      )}
    </div>
  );
}
