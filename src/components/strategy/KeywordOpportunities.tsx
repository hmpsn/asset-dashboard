/**
 * KeywordOpportunities — displays AI-generated keyword opportunity suggestions.
 *
 * P3 Lane C — adds an "Interested in this one?" inline confirm per row when
 * `enableSend={true}` and `workspaceId` are provided. Calls recommendations.send()
 * (the rec-lifecycle API wrapper) for the keyword_gap rec minted at regen.
 *
 * After send: muted-teal "Sent" pill. Client response shown inline:
 *   approved  → emerald "Client approved"
 *   declined  → red "Client declined"
 *   discussing → amber "Discussing"
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ArrowUpRight, Send } from 'lucide-react';
import { Badge, Button, SectionCard, Icon, IconButton } from '../ui';
import { adminPath } from '../../routes';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { useShowMore } from '../../hooks/useShowMore';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { WhyHowResult, isSendable } from './shared/WhyHowResult';
import type { KeywordOpportunitiesProps } from './types';
import type { Recommendation } from '../../../shared/types/recommendations';

/** Map clientStatus → display label + tone */
const CLIENT_STATUS_DISPLAY: Record<string, { label: string; tone: 'emerald' | 'red' | 'amber' }> = {
  approved: { label: 'Client approved', tone: 'emerald' },
  declined: { label: 'Client declined', tone: 'red' },
  discussing: { label: 'Discussing', tone: 'amber' },
};

export function KeywordOpportunities({ opportunities, workspaceId, navigate, maxVisible, enableSend, onAddToStrategySet }: KeywordOpportunitiesProps) {
  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(opportunities, maxVisible);
  const qc = useQueryClient();

  // Only fetch recs when send is enabled and workspaceId is available
  const { data: recSet } = useAdminRecommendationSet(
    enableSend && workspaceId ? workspaceId : undefined,
    { enabled: !!(enableSend && workspaceId) }
  );

  // Track optimistic "sent" state per opportunity string
  const [sentOpps, setSentOpps] = useState<Set<string>>(new Set());
  // Track which opportunity is in "confirm" state (inline confirm before send)
  const [confirmingOpp, setConfirmingOpp] = useState<string | null>(null);

  if (opportunities.length === 0) return null;

  const showExplore = !!(workspaceId && navigate);
  const showSend = !!(enableSend && workspaceId);

  /**
   * Find the keyword_gap rec for an opportunity string.
   * Matches against targetKeyword (primary) or affectedPages as fallback.
   */
  function findKeywordGapRec(opp: string): Recommendation | undefined {
    if (!recSet) return undefined;
    const norm = opp.toLowerCase().trim();
    return recSet.recommendations.find(r => {
      if (r.type !== 'keyword_gap') return false;
      if (r.targetKeyword?.toLowerCase().trim() === norm) return true;
      return r.affectedPages.some(p => p.toLowerCase().trim() === norm);
    });
  }

  return (
    <SectionCard
      title="Keyword Opportunities"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      <p className="text-[var(--brand-text-muted)] t-caption-sm mb-2">
        These opportunities are AI-generated suggestions based on your site's content and competitive landscape. Validate with keyword research before acting.
      </p>
      <div className="space-y-1.5">
        {visible.map((opp: string, i: number) => {
          if (showSend) {
            const rec = findKeywordGapRec(opp);
            return (
              <OpportunityRow
                key={i}
                index={i}
                opp={opp}
                workspaceId={workspaceId!}
                rec={rec}
                alreadySent={sentOpps.has(opp)}
                isConfirming={confirmingOpp === opp}
                onConfirm={() => setConfirmingOpp(opp)}
                onCancelConfirm={() => setConfirmingOpp(null)}
                onSent={() => {
                  setSentOpps(prev => new Set([...prev, opp]));
                  setConfirmingOpp(null);
                }}
                onAddToStrategySet={onAddToStrategySet}
                showExplore={showExplore}
                navigate={navigate}
                queryClient={qc}
              />
            );
          }

          if (!showExplore) {
            return (
              <div key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
                <Badge label={`${i + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
                {opp}
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
              <Badge label={`${i + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
              <span className="flex-1">{opp}</span>
              <IconButton
                onClick={() => navigate!(adminPath(workspaceId!, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: opp }))}
                title="Explore in Hub"
                label="Explore in Hub"
                icon={ArrowUpRight}
                size="sm"
                variant="ghost"
                className="flex-shrink-0 text-[var(--brand-text-muted)] hover:text-accent-brand"
              />
            </div>
          );
        })}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-3 w-full text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
    </SectionCard>
  );
}

// ── Per-row component (isolates mutation state) ───────────────────

interface OpportunityRowProps {
  index: number;
  opp: string;
  workspaceId: string;
  rec: Recommendation | undefined;
  alreadySent: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onSent: () => void;
  /** FIX 2 — callback fired after a successful send so the parent (Lane D) can add the keyword to the managed set. */
  onAddToStrategySet?: (keyword: string) => void;
  showExplore: boolean;
  navigate: ((path: string) => void) | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
}

function OpportunityRow({
  index,
  opp,
  workspaceId,
  rec,
  alreadySent,
  isConfirming,
  onConfirm,
  onCancelConfirm,
  onSent,
  onAddToStrategySet,
  showExplore,
  navigate,
  queryClient,
}: OpportunityRowProps) {
  const sendMutation = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.send(workspaceId, recId), // strategy-send-must-route-through-lifecycle-ok: KeywordOpportunities — routes through rec lifecycle send()
    onSuccess: () => {
      onSent();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
      // FIX 2 — fire the seam callback so Lane D can add the keyword to the managed set
      const keyword = rec?.targetKeyword ?? opp;
      onAddToStrategySet?.(keyword);
    },
  });

  const isSent = alreadySent || rec?.clientStatus === 'sent';
  const clientFeedback = rec?.clientStatus ? CLIENT_STATUS_DISPLAY[rec.clientStatus] : undefined;
  const showFeedback = clientFeedback && rec?.clientStatus !== 'sent';

  // isSendable gate — "Interested?" affordance is only shown when the rec has a why + result
  const sendable = rec
    ? isSendable({ insight: rec.insight, description: rec.description, estimatedGain: rec.estimatedGain, impactBand: rec.impactBand })
    : false;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
        <Badge label={`${index + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
        <span className="flex-1">{opp}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {showExplore && navigate && (
            <IconButton
              onClick={() => navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: opp }))}
              title="Explore in Hub"
              label="Explore in Hub"
              icon={ArrowUpRight}
              size="sm"
              variant="ghost"
              className="text-[var(--brand-text-muted)] hover:text-accent-brand"
            />
          )}
          {/* Send affordance — only when a rec exists AND isSendable passes */}
          {rec && sendable && (
            isSent ? (
              // Muted-teal "Sent" badge — shown after send or when clientStatus is 'sent'
              <Badge
                tone="teal"
                size="sm"
                icon={Send}
                label="Sent"
                variant="outline"
                className="opacity-70"
              />
            ) : isConfirming ? (
              // Inline confirm state — "Yes, send it" + cancel
              <span role="group" aria-label="Confirm send" className="inline-flex items-center gap-1.5">
                <Button
                  onClick={() => sendMutation.mutate(rec.id)}
                  disabled={sendMutation.isPending}
                  variant="ghost"
                  size="sm"
                  className="px-2 py-0.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 disabled:opacity-50"
                >
                  {sendMutation.isPending ? 'Sending…' : 'Yes, send it'}
                </Button>
                <Button
                  onClick={onCancelConfirm}
                  variant="ghost"
                  size="sm"
                  className="px-2 py-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
                >
                  Cancel
                </Button>
              </span>
            ) : (
              // Initial "Interested in this one?" prompt
              <Button
                onClick={onConfirm}
                variant="ghost"
                size="sm"
                className="px-2 py-0.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-brand hover:bg-teal-600/10 rounded-[var(--radius-lg)]"
              >
                Interested in this one?
              </Button>
            )
          )}
        </div>
      </div>
      {/* WhyHowResult — compact Why line from the keyword_gap rec */}
      {rec && sendable && (
        <WhyHowResult
          insight={rec.insight}
          description={rec.description}
          estimatedGain={rec.estimatedGain}
          impactBand={rec.impactBand}
          className="ml-6"
        />
      )}
      {/* Client response feedback */}
      {showFeedback && (
        <div className="ml-6">
          <Badge tone={clientFeedback.tone} size="sm" label={clientFeedback.label} />
        </div>
      )}
      {/* Send error */}
      {sendMutation.isError && (
        <div className="ml-6 t-caption-sm text-red-400">
          {sendMutation.error instanceof Error ? sendMutation.error.message : 'Send failed'}
        </div>
      )}
    </div>
  );
}
