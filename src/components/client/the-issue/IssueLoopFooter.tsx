// ── IssueLoopFooter — the quiet loop footer (close the loop, client side) ───────
//
// Spec §5.5 / audit §16.8. The quiet footer: "ask your strategist" (reuse the existing
// advisor via the onOpenChat/onAskAi props threaded from the dashboard) + the loop status
// ("you've greenlit N moves · M in discussion", from the client-safe recResponses
// projection). This is the NET-NEW client render of the loop — no component reads
// recResponses today.
//
// Evergreen copy only (no time anchors). Teal = the action (ask), emerald = greenlit
// proof, blue = in-discussion data. No purple.

import { Sparkles, CheckCircle2, MessageCircle } from 'lucide-react';
import { SectionCard, Button, ClickableRow, Icon } from '../../ui';
import type { ClientRecResponseSummary } from '../../../api/theIssue';
import { ISSUE_SECTION_TITLES, ISSUE_SECTION_INTROS, loopStatusLine, workInFlightLine } from './evergreenCopy';

interface IssueLoopFooterProps {
  /** Pre-aggregated client response counts (greenlit / discussing). */
  responses?: ClientRecResponseSummary;
  /** Count of briefs currently in progress (work-in-flight proof). */
  briefsInProgress?: number;
  /** A few quick questions to seed the advisor. */
  quickQuestions: string[];
  onOpenChat: () => void;
  onAskAi: (q: string) => void;
}

export function IssueLoopFooter({
  responses,
  briefsInProgress = 0,
  quickQuestions,
  onOpenChat,
  onAskAi,
}: IssueLoopFooterProps) {
  const approved = responses?.approved ?? 0;
  const discussing = responses?.discussing ?? 0;
  const loopLine = loopStatusLine(approved, discussing);
  const flightLine = workInFlightLine(briefsInProgress);

  return (
    <SectionCard
      title={ISSUE_SECTION_TITLES.ask}
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
      className="bg-gradient-to-br from-teal-500/5 via-[var(--surface-2)] to-[var(--surface-2)] border-teal-500/15"
    >
      <p className="t-body text-[var(--brand-text-muted)] mb-3">{ISSUE_SECTION_INTROS.ask}</p>

      {/* Quick questions → advisor. */}
      <div className="space-y-1.5">
        {quickQuestions.slice(0, 3).map((q, i) => (
          <ClickableRow
            key={i}
            onClick={() => { onOpenChat(); setTimeout(() => onAskAi(q), 100); }}
            className="px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/30 hover:border-teal-500/20 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
          >
            {q}
          </ClickableRow>
        ))}
      </div>

      <div className="mt-3">
        <Button variant="secondary" onClick={onOpenChat} className="inline-flex items-center gap-1.5">
          <Icon as={MessageCircle} size="sm" /> Ask your strategist
        </Button>
      </div>

      {/* The loop status + work-in-flight proof — evergreen, omitted when empty. */}
      {(loopLine || flightLine) && (
        <div className="mt-3 pt-3 border-t border-[var(--brand-border)]/40 flex flex-wrap items-center gap-x-4 gap-y-1">
          {loopLine && (
            <span className="inline-flex items-center gap-1.5 t-caption-sm text-accent-success">
              <Icon as={CheckCircle2} size="sm" className="text-accent-success" />
              {loopLine}
            </span>
          )}
          {flightLine && (
            <span className="inline-flex items-center gap-1.5 t-caption-sm text-accent-info">
              <Icon as={Sparkles} size="sm" className="text-accent-info" />
              {flightLine}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  );
}
