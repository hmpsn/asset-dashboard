// ── IssueContentCard — a value-first content move (the money card) ──────────────
//
// Spec §5.2 / audit §16.4 + blocker #1 (D1). One content recommendation, value-first
// ("publish X → capture ~Y searches/mo"), with ONE primary decision rendered from the
// SERVER-COMPUTED actOn descriptor (never re-derived client-side):
//   - actOn.mode === 'locked'   → a <TierGate> upsell naming actOn.requiredTier (NOT an
//     active button; the request route also 403s). Reuses the CompetitorGaps gate pattern.
//   - actOn.mode === 'included' → the active "Request this" / "Discuss this" button. On a
//     paid-tier request a single <ConfirmDialog> (rec headline + the no-charge consequence
//     line) precedes the act-on POST; Cancel writes nothing.
//   - actOn absent → flag-OFF path never renders this surface, so the active button shows
//     (the curated feed only mounts under strategy-the-issue).
// The retired act-on label never appears: monetizable moves read "Request this",
// non-monetizable moves read "Discuss this".
//
// Alongside the request, a Relevant / Not-relevant feedback pair, a "See the details"
// link, and an in-card "Let us talk" soft-yes (audit blocker #1 soft-yes) that opens the
// advisor pre-seeded with the move (warm-lead valve). All CTAs are ≥44px touch targets;
// the request + soft-yes stack vertically on mobile.
//
// Card body reuses the shared ContentGapRow with audience='issue' (teal target keyword,
// blue data, est-clicks). NO pricing/cart copy (enforced by pricing-in-client-issue
// pr-check). NO purple.
//
// Two card kinds:
//   - 'request'  → a curated content rec the client can greenlight.
//   - 'evaluating' → content-floor fallback (un-curated gap); no Act-on, feedback only.

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, ArrowRight, Check, MessageCircle } from 'lucide-react';
import { Badge, Button, Icon, TierGate, ConfirmDialog, cardToneClasses, type Tier } from '../../ui';
import { ContentGapRow, type ContentGapRowData, type ContentGapAudience } from '../../shared/ContentGapRow';
import type { BadgeTone } from '../../ui';
import type { ClientFacingRecommendation } from '../../../../shared/types/recommendations';
import { ISSUE_CTA, ISSUE_REQUEST_CONFIRM_CONSEQUENCE } from './evergreenCopy';

export type IssueContentCardKind = 'request' | 'evaluating';

/** Server-computed act-on descriptor (projected onto ClientFacingRecommendation, blocker #1). */
export type IssueActOnDescriptor = NonNullable<ClientFacingRecommendation['actOn']>;

export interface IssueContentCardData extends ContentGapRowData {
  /** Stable id for keys + act-on (the rec id for 'request' cards). */
  id: string;
  /** Value-first headline shown above the metric body. */
  headline: string;
  /** Optional value statement ("publish → capture ~Y searches/mo"). */
  valueLine?: string;
}

interface IssueContentCardProps {
  data: IssueContentCardData;
  kind: IssueContentCardKind;
  /** Emphasize the lead (highest-priority) card. */
  emphasized?: boolean;
  /** The client's effective tier — drives the TierGate upsell when actOn.mode === 'locked'. */
  tier: Tier;
  /** Server-computed act-on descriptor. Absent on the flag-OFF path (surface never mounts then)
   *  and on 'evaluating' floor cards (nothing to greenlight yet). */
  actOn?: IssueActOnDescriptor;
  /** False for non-monetizable moves → the greenlight verb reads "Discuss this", not "Request this". */
  monetizable?: boolean;
  /** Relevance feedback state for this card's target keyword. */
  feedbackStatus?: 'approved' | 'declined' | 'requested';
  onRelevant?: () => void;
  onNotRelevant?: () => void;
  /** Greenlight handler (request cards only). Fires only AFTER the confirm dialog on paid paths. */
  onActOn?: () => void;
  isActingOn?: boolean;
  /** In-card soft-yes — opens the advisor pre-seeded with this move (title + targetKeyword). */
  onLetsTalk?: () => void;
  /** Link to the recommendation's details (NOT a brief). */
  onSeeDetails?: () => void;
}

// Client intent tone map (commercial → teal per the briefing/strategy-tab client convention).
const issueIntentTone = (intent?: string): BadgeTone => {
  switch ((intent ?? '').toLowerCase()) {
    case 'transactional': return 'emerald';
    case 'commercial': return 'teal';
    case 'informational': return 'blue';
    default: return 'zinc';
  }
};

export function IssueContentCard({
  data,
  kind,
  emphasized = false,
  tier,
  actOn,
  monetizable = true,
  feedbackStatus,
  onRelevant,
  onNotRelevant,
  onActOn,
  isActingOn = false,
  onLetsTalk,
  onSeeDetails,
}: IssueContentCardProps) {
  const declined = feedbackStatus === 'declined';
  const relevant = feedbackStatus === 'approved';
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The greenlight verb: monetizable moves "Request this", non-monetizable "Discuss this".
  const greenlightLabel = monetizable ? ISSUE_CTA.requestThis : ISSUE_CTA.discussThis;
  // A locked descriptor → render an upsell, never an active button. Absent descriptor (flag-OFF
  // path never mounts this surface) → treat as an active request.
  const isLocked = actOn?.mode === 'locked';
  const lockedTier: Tier = actOn?.requiredTier ?? 'growth';

  return (
    <div
      className={
        emphasized
          ? `${cardToneClasses('teal')} border p-4`
          : 'bg-[var(--surface-2)] border border-[var(--brand-border)] p-4'
      }
      style={{ borderRadius: 'var(--radius-signature)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          {emphasized && (
            <span className="t-caption-sm font-semibold text-accent-brand uppercase tracking-wider">Top move</span>
          )}
          <h3 className="t-page font-semibold text-[var(--brand-text-bright)] leading-snug">{data.headline}</h3>
          {data.valueLine && (
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">{data.valueLine}</p>
          )}
        </div>
        {kind === 'evaluating' && (
          <Badge label="We're evaluating" tone="zinc" variant="outline" shape="pill" />
        )}
      </div>

      {/* Shared metric/badge body — audience='issue' (teal kw, blue data). */}
      <ContentGapRow data={data} audience="issue" intentTone={issueIntentTone} />

      {/* Decision row: feedback (relevant / not relevant) + the act-on / soft-yes / details CTAs. */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--brand-border)]/40 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={onRelevant}
            disabled={!onRelevant}
            className={`inline-flex items-center gap-1 px-2 py-1 min-h-[44px] rounded-[var(--radius-md)] t-caption-sm ${
              relevant
                ? 'text-accent-success bg-emerald-500/10 border border-emerald-500/20'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
            }`}
            aria-pressed={relevant}
          >
            <Icon as={ThumbsUp} size="sm" /> {ISSUE_CTA.relevant}
          </Button>
          <Button
            variant="ghost"
            onClick={onNotRelevant}
            disabled={!onNotRelevant}
            className={`inline-flex items-center gap-1 px-2 py-1 min-h-[44px] rounded-[var(--radius-md)] t-caption-sm ${
              declined
                ? 'text-accent-danger bg-red-500/10 border border-red-500/20'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
            }`}
            aria-pressed={declined}
          >
            <Icon as={ThumbsDown} size="sm" /> {ISSUE_CTA.notRelevant}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {onSeeDetails && (
            <Button
              variant="link"
              onClick={onSeeDetails}
              className="t-caption-sm text-accent-brand no-underline hover:no-underline inline-flex items-center gap-1 min-h-[44px]"
            >
              {ISSUE_CTA.seeDetails} <Icon as={ArrowRight} size="sm" />
            </Button>
          )}
          {/* Request cards: the act-on affordance. locked → upsell; otherwise the request +
              soft-yes pair (stacks vertically on mobile so both stay ≥44px touch targets). */}
          {kind === 'request' && (
            isLocked ? (
              <TierGate
                tier={tier}
                required={lockedTier}
                feature="Requesting this move"
                teaser={`Upgrade to ${lockedTier === 'growth' ? 'Growth' : 'Premium'} to request curated content moves and put them on your plan.`}
                compact
              >
                {/* Children are only rendered when access is granted; with a locked descriptor the
                    tier is below requirement, so the compact upsell card renders instead. */}
                <span />
              </TierGate>
            ) : (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {onLetsTalk && (
                  <Button
                    variant="secondary"
                    onClick={onLetsTalk}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <Icon as={MessageCircle} size="sm" /> {ISSUE_CTA.letsTalk}
                  </Button>
                )}
                {onActOn && (
                  <Button
                    variant="primary"
                    onClick={() => setConfirmOpen(true)}
                    disabled={isActingOn || declined}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    {isActingOn ? <Icon as={Check} size="sm" className="animate-pulse" /> : null}
                    {greenlightLabel}
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Single ConfirmDialog before the act-on POST (blocker #1 / D3). Names the rec headline +
          the no-charge consequence line; Cancel writes nothing. */}
      {kind === 'request' && onActOn && !isLocked && (
        <ConfirmDialog
          open={confirmOpen}
          title={data.headline}
          message={ISSUE_REQUEST_CONFIRM_CONSEQUENCE}
          confirmLabel={greenlightLabel}
          cancelLabel="Cancel"
          onConfirm={() => { setConfirmOpen(false); onActOn(); }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

/** Re-export the audience constant for callers that build the row data shape. */
export type { ContentGapAudience };
