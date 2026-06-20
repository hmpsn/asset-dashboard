// ── IssueContentPlanSection — the hero content section (where the money is) ──────
//
// Spec §5.2 / audit §16.4. The prominent, dedicated content section that LEADS the plan.
// Multiple content moves, the highest-priority one emphasized. Each is a value-first
// IssueContentCard with Relevant/Not-relevant feedback + "Act on this" (= a REQUEST).
//
// Content FLOOR (audit D1): the lead content section is NEVER empty. When there are < 2
// curated content recs, it falls back to un-curated content gaps framed "opportunities
// we're evaluating" (no Act-on — there's nothing to greenlight yet). This mirrors the
// thin-client pattern so a new client always sees a content plan.
//
// "Act on this" is a content REQUEST — nothing is pre-generated. No pricing/cart copy.

import { FileText } from 'lucide-react';
import { SectionCard, EmptyState, Icon } from '../../ui';
import { IssueContentCard, type IssueContentCardData } from './IssueContentCard';
import { recArchetype } from '../../../lib/recArchetypeMap';
import type { Recommendation } from '../../../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../types';
import { ISSUE_SECTION_TITLES, ISSUE_SECTION_INTROS } from './evergreenCopy';

interface IssueContentPlanSectionProps {
  /** Curated, clientStatus='sent' recs (the feed). */
  recs: Recommendation[];
  /** Strategy data — supplies the content-gap fallback ladder for the floor. */
  strategyData: ClientKeywordStrategy | null;
  /** Relevance feedback lookup + writers. */
  getFeedbackStatus: (keyword: string) => 'approved' | 'declined' | 'requested' | undefined;
  onRelevant: (keyword: string) => void;
  onNotRelevant: (keyword: string) => void;
  /** Greenlight a curated content rec. */
  onActOn: (recId: string) => void;
  pendingRecId: string | null;
  /** Navigate to the recommendation's details (interior strategy/content page). */
  onSeeDetails: () => void;
}

/** Content archetype = authority_bet (content / keyword_gap / topic_cluster). */
function isContentRec(rec: Recommendation): boolean {
  return recArchetype(rec.type) === 'authority_bet';
}

/** Map a curated content rec → the value-first card shape. */
function recToCard(rec: Recommendation): IssueContentCardData {
  return {
    id: rec.id,
    headline: rec.title,
    valueLine: rec.estimatedGain || undefined,
    topic: rec.title,
    targetKeyword: rec.targetKeyword ?? '',
    rationale: rec.insight,
    opportunityScore: rec.opportunity ? Math.round(rec.opportunity.value) : undefined,
  };
}

/** Map an un-curated content gap → the "we're evaluating" floor card shape. */
function gapToCard(
  gap: NonNullable<ClientKeywordStrategy['contentGaps']>[number],
): IssueContentCardData {
  return {
    id: `gap:${gap.targetKeyword}:${gap.topic}`,
    headline: gap.topic,
    topic: gap.topic,
    targetKeyword: gap.targetKeyword,
    intent: gap.intent,
    rationale: gap.rationale,
    suggestedPageType: gap.suggestedPageType,
    volume: gap.volume,
    difficulty: gap.difficulty,
    impressions: gap.impressions,
    competitorProof: gap.competitorProof,
    trendDirection: gap.trendDirection,
    serpFeatures: gap.serpFeatures,
    questionKeywords: gap.questionKeywords,
    opportunityScore: gap.opportunityScore,
    backfilled: gap.backfilled,
  };
}

export function IssueContentPlanSection({
  recs,
  strategyData,
  getFeedbackStatus,
  onRelevant,
  onNotRelevant,
  onActOn,
  pendingRecId,
  onSeeDetails,
}: IssueContentPlanSectionProps) {
  // Curated content recs, sorted by opportunity (highest first → the emphasized lead).
  const contentRecs = recs
    .filter(isContentRec)
    .sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore));

  // Content FLOOR: < 2 curated content recs → un-curated content gaps ("we're evaluating").
  const useFloor = contentRecs.length < 2;
  const floorGaps = useFloor ? (strategyData?.contentGaps ?? []).slice(0, 4) : [];

  const header = (
    <SectionCard
      title={ISSUE_SECTION_TITLES.contentPlan}
      titleIcon={<Icon as={FileText} size="md" className="text-accent-brand" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        {useFloor ? ISSUE_SECTION_INTROS.contentPlanFloor : ISSUE_SECTION_INTROS.contentPlan}
      </p>

      {/* Curated request cards (primary path). */}
      {contentRecs.length > 0 && (
        <div className="space-y-3">
          {contentRecs.map((rec, i) => {
            const card = recToCard(rec);
            const kw = card.targetKeyword;
            return (
              <IssueContentCard
                key={rec.id}
                data={card}
                kind="request"
                emphasized={i === 0}
                feedbackStatus={kw ? getFeedbackStatus(kw) : undefined}
                onRelevant={kw ? () => onRelevant(kw) : undefined}
                onNotRelevant={kw ? () => onNotRelevant(kw) : undefined}
                onActOn={() => onActOn(rec.id)}
                isActingOn={pendingRecId === rec.id}
                onSeeDetails={onSeeDetails}
              />
            );
          })}
        </div>
      )}

      {/* Floor cards ("we're evaluating") — only when curated content is thin. */}
      {useFloor && floorGaps.length > 0 && (
        <div className={`space-y-3 ${contentRecs.length > 0 ? 'mt-3' : ''}`}>
          {floorGaps.map((gap) => {
            const card = gapToCard(gap);
            const kw = card.targetKeyword;
            return (
              <IssueContentCard
                key={card.id}
                data={card}
                kind="evaluating"
                feedbackStatus={kw ? getFeedbackStatus(kw) : undefined}
                onRelevant={kw ? () => onRelevant(kw) : undefined}
                onNotRelevant={kw ? () => onNotRelevant(kw) : undefined}
                onSeeDetails={onSeeDetails}
              />
            );
          })}
        </div>
      )}

      {/* Last-resort empty state — only when there is genuinely nothing in the ladder. */}
      {contentRecs.length === 0 && floorGaps.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Your content plan is taking shape"
          description="As we analyze your site, the content pieces we recommend writing next will appear here — each one a chance to win qualified search traffic."
        />
      )}
    </SectionCard>
  );

  return header;
}
