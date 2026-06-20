// ── IssueContentCard — a value-first content move (the money card) ──────────────
//
// Spec §5.2 / audit §16.4. One content recommendation, value-first ("publish X → capture
// ~Y searches/mo"), with ONE decision: "Act on this" (= a REQUEST / retainer greenlight,
// never "open the brief" — nothing is generated on the fly). Alongside the request, a
// Relevant / Not-relevant feedback pair (useStrategyKeywordFeedback) and a "See the details"
// link to the recommendation's details.
//
// Card body reuses the shared ContentGapRow with audience='issue' (teal target keyword,
// blue data, est-clicks). The card chrome (headline emphasis, CTA, feedback) lives here.
// NO pricing/cart copy (enforced by pricing-in-client-issue pr-check). NO purple.
//
// Two card kinds:
//   - 'request'  → a curated content rec the client can greenlight (Act on this).
//   - 'evaluating' → content-floor fallback (un-curated gap) framed "we're evaluating";
//     no Act-on (there's nothing to greenlight yet), feedback only.

import { ThumbsUp, ThumbsDown, ArrowRight, Check } from 'lucide-react';
import { Badge, Button, Icon } from '../../ui';
import { ContentGapRow, type ContentGapRowData, type ContentGapAudience } from '../../shared/ContentGapRow';
import type { BadgeTone } from '../../ui';
import { ISSUE_CTA } from './evergreenCopy';

export type IssueContentCardKind = 'request' | 'evaluating';

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
  /** Relevance feedback state for this card's target keyword. */
  feedbackStatus?: 'approved' | 'declined' | 'requested';
  onRelevant?: () => void;
  onNotRelevant?: () => void;
  /** Greenlight handler (request cards only). */
  onActOn?: () => void;
  isActingOn?: boolean;
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
  feedbackStatus,
  onRelevant,
  onNotRelevant,
  onActOn,
  isActingOn = false,
  onSeeDetails,
}: IssueContentCardProps) {
  const declined = feedbackStatus === 'declined';
  const relevant = feedbackStatus === 'approved';

  return (
    <div
      className={
        emphasized
          ? 'bg-gradient-to-br from-teal-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border border-teal-500/25 p-4'
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

      {/* Decision row: feedback (relevant / not relevant) + the act-on / details CTAs. */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--brand-border)]/40 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={onRelevant}
            disabled={!onRelevant}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm ${
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
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm ${
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
              className="t-caption-sm text-accent-brand no-underline hover:no-underline inline-flex items-center gap-1"
            >
              {ISSUE_CTA.seeDetails} <Icon as={ArrowRight} size="sm" />
            </Button>
          )}
          {kind === 'request' && onActOn && (
            <Button
              variant="primary"
              onClick={onActOn}
              disabled={isActingOn || declined}
              className="inline-flex items-center gap-1.5"
            >
              {isActingOn ? <Icon as={Check} size="sm" className="animate-pulse" /> : null}
              {ISSUE_CTA.actOnThis}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Re-export the audience constant for callers that build the row data shape. */
export type { ContentGapAudience };
