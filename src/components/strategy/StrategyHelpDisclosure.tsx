import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { ClickableRow, Icon } from '../ui';
import { StrategyHowItWorks } from './StrategyHowItWorks';
import { METRIC_GLOSSARY } from './KeywordStrategyGuide';
import type { StrategyHowItWorksProps } from './types';

/**
 * Reference-band-only collapsed help disclosure (Phase 4c). Replaces the standalone Guide tab in the
 * decision-bands layout: it consolidates the "How it works" footer prose (StrategyHowItWorks) with the
 * metric glossary (the durable, reusable part of the old Guide tab) into one collapsible at the foot of
 * the Reference band. The verbose 6-step walkthrough — including a stale "Rank Tracker" reference (a
 * feature retired in the Keyword Hub cutover) — is intentionally dropped. Legacy keeps the full Guide tab.
 */
export function StrategyHelpDisclosure({ displayedSeoDataMode, hasAnyRanking }: StrategyHowItWorksProps) {
  const [open, setOpen] = useState(false);
  return (
    // pr-check-disable-next-line -- brand asymmetric signature on the help disclosure; intentional non-SectionCard chrome (collapsible, button-as-first-child)
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
      <ClickableRow
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon as={HelpCircle} size="md" className="text-accent-brand" />
          <span className="t-caption font-semibold text-[var(--brand-text-bright)]">How it works &amp; metric glossary</span>
        </div>
        <Icon as={open ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />
      </ClickableRow>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <StrategyHowItWorks displayedSeoDataMode={displayedSeoDataMode} hasAnyRanking={hasAnyRanking} />
          <div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Metric glossary</div>
            <dl className="space-y-1.5">
              {METRIC_GLOSSARY.map(({ term, def }) => (
                <div key={term} className="t-caption-sm">
                  <dt className="inline font-semibold text-accent-brand">{term}</dt>
                  <dd className="inline text-[var(--brand-text-muted)]"> — {def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
