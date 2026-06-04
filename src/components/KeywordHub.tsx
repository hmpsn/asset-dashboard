/**
 * KeywordHub — the unified Keyword Hub surface (Wave 4, Phase P1).
 *
 * P1-T1: minimal stub shell — a SectionCard placeholder so the parallel batch
 * (P1-T2, P1-T3) can import and use `useKeywordHubState` without waiting for
 * the full assembly. P1-T4 replaces this file with the full shell.
 *
 * Gate: rendered only when the 'keyword-hub' feature flag is ON (gate lives in
 * App.tsx, not here — per plan "the component is NOT itself wrapped in
 * <FeatureFlag>").
 */
import { SectionCard } from './ui/SectionCard';

export interface KeywordHubProps {
  workspaceId: string;
}

export function KeywordHub({ workspaceId: _workspaceId }: KeywordHubProps) {
  // P1-T4 will replace this stub with the full shell:
  //   useKeywordHubState → HubSegmentBar + FormInput search + HubAdvancedFilters + HubKeywordList
  return (
    <SectionCard title="Keyword Hub">
      <p className="t-body text-[var(--brand-text-muted)]">
        Keyword Hub is coming soon.
      </p>
    </SectionCard>
  );
}
