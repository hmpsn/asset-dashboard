// ── IssueContentPlanSection — the hero content section (where the money is) ──────
//
// Spec §5.2 / audit §16.4 + content-floor (blocker, 2-state). The prominent, dedicated
// content section that LEADS the plan. Multiple content moves, the highest-priority one
// emphasized. Each is a value-first IssueContentCard with Relevant/Not-relevant feedback,
// the server-computed "Request this" descriptor, and an in-card "Let us talk" soft-yes.
//
// Content FLOOR (audit content-floor — now exactly TWO states): the hero is NEVER a wall of
// non-actionable filler. Either:
//   (a) the curated request cards render (the real money), OR
//   (b) when there are NO curated content recs, ONE honest line shows ("Your strategist is
//       sizing up your next content opportunities") — NOT the old up-to-4 "we're evaluating"
//       filler cards + cross-tier dedup, which made the hero mostly non-actionable.
//
// "Request this" is a content REQUEST — nothing is pre-generated. No pricing/cart copy.

import { FileText } from 'lucide-react';
import { SectionCard, Icon, type Tier } from '../../ui';
import { IssueContentCard, type IssueContentCardData, type IssueActOnDescriptor } from './IssueContentCard';
import { recArchetype } from '../../../lib/recArchetypeMap';
import type { Recommendation, ClientFacingRecommendation } from '../../../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../types';
import { ISSUE_SECTION_TITLES, ISSUE_SECTION_INTROS } from './evergreenCopy';

interface IssueContentPlanSectionProps {
  /** Curated, clientStatus='sent' recs (the feed). At runtime these are the projected
   *  ClientFacingRecommendation shape (they carry the server-computed actOn descriptor). */
  recs: Recommendation[];
  /** Strategy data — retained for parity; the floor is now an honest line, not gap cards. */
  strategyData: ClientKeywordStrategy | null;
  /** The client's effective tier — drives each card's actOn TierGate when 'locked'. */
  tier: Tier;
  /** Relevance feedback lookup + writers. */
  getFeedbackStatus: (keyword: string) => 'approved' | 'declined' | 'requested' | undefined;
  onRelevant: (keyword: string) => void;
  onNotRelevant: (keyword: string) => void;
  /** Greenlight a curated content rec. */
  onActOn: (recId: string) => void;
  pendingRecId: string | null;
  /** In-card soft-yes — opens the advisor pre-seeded with a move (title + targetKeyword). */
  onLetsTalk: (rec: Recommendation) => void;
  /** Navigate to the recommendation's details (interior strategy/content page). */
  onSeeDetails: () => void;
}

/** Content archetype = authority_bet (content / keyword_gap / topic_cluster). */
function isContentRec(rec: Recommendation): boolean {
  return recArchetype(rec.type) === 'authority_bet';
}

/** Read the server-computed act-on descriptor off a curated rec. At runtime the feed recs are
 *  the projected ClientFacingRecommendation (which carries actOn); the static array type is
 *  Recommendation, so we narrow via the projection type. Absent ⇒ flag-OFF path (this surface
 *  never mounts then) ⇒ the card renders the active request button. */
function recActOn(rec: Recommendation): IssueActOnDescriptor | undefined {
  return (rec as Recommendation & Pick<ClientFacingRecommendation, 'actOn'>).actOn;
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
    // L3: NO opportunityScore on curated cards. The shared ContentGapRow renders it as a bare
    // `N/100` badge — internal admin jargon (an OV score) that must not surface on the client
    // money surface.
  };
}

export function IssueContentPlanSection({
  recs,
  tier,
  getFeedbackStatus,
  onRelevant,
  onNotRelevant,
  onActOn,
  pendingRecId,
  onLetsTalk,
  onSeeDetails,
}: IssueContentPlanSectionProps) {
  // Curated content recs, sorted by opportunity (highest first → the emphasized lead).
  const contentRecs = recs
    .filter(isContentRec)
    .sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore));

  // Content FLOOR — exactly TWO states (blocker content-floor). Either the curated request
  // cards render, OR (when there are NONE) one honest line. The old up-to-4 "we're evaluating"
  // filler cards + cross-tier dedup are gone: a hero that is mostly non-actionable filler reads
  // as the agency having nothing to offer. An honest single line is higher-trust.
  const hasContent = contentRecs.length > 0;

  return (
    <SectionCard
      title={ISSUE_SECTION_TITLES.contentPlan}
      titleIcon={<Icon as={FileText} size="md" className="text-accent-brand" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        {hasContent ? ISSUE_SECTION_INTROS.contentPlan : ISSUE_SECTION_INTROS.contentPlanFloor}
      </p>

      {hasContent ? (
        /* Curated request cards (the money). */
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
                tier={tier}
                actOn={recActOn(rec)}
                monetizable={recActOn(rec)?.monetizable ?? true}
                feedbackStatus={kw ? getFeedbackStatus(kw) : undefined}
                onRelevant={kw ? () => onRelevant(kw) : undefined}
                onNotRelevant={kw ? () => onNotRelevant(kw) : undefined}
                onActOn={() => onActOn(rec.id)}
                isActingOn={pendingRecId === rec.id}
                onLetsTalk={() => onLetsTalk(rec)}
                onSeeDetails={onSeeDetails}
              />
            );
          })}
        </div>
      ) : (
        /* State 2: one honest line — never a wall of non-actionable filler. */
        <p className="t-body text-[var(--brand-text-muted)]">
          Your strategist is sizing up your next content opportunities.
        </p>
      )}
    </SectionCard>
  );
}
