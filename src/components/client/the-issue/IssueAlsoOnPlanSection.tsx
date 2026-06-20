// ── IssueAlsoOnPlanSection — the compact, de-emphasized rest of the plan ────────
//
// Spec §5.3 / audit §16.5. The NON-content moves (refresh & reclaim, technical, keyword/
// topic, defend) grouped and lighter, below the content hero. Each group links out to its
// interior page. "Act on this" where relevant — but the section is intentionally compact
// (links + counts), not a second wall of full cards.
//
// Uses the shared archetype contract (recArchetype) but with CLIENT-FRIENDLY labels — no
// admin jargon ("Defend cannibalized" → "Protecting your rankings"). The content
// archetype (authority_bet) is excluded — it lives in the hero IssueContentPlanSection.
// No purple; teal = the link action, blue/zinc = data counts.

import { RefreshCw, Wrench, Search, Shield, ArrowRight } from 'lucide-react';
import { SectionCard, ClickableRow, Icon } from '../../ui';
import { recArchetype, type Archetype } from '../../../lib/recArchetypeMap';
import type { Recommendation } from '../../../../shared/types/recommendations';
import { ISSUE_SECTION_TITLES, ISSUE_SECTION_INTROS } from './evergreenCopy';

interface IssueAlsoOnPlanSectionProps {
  recs: Recommendation[];
  /** Navigate to an interior page for a given archetype group. */
  onOpenGroup: (archetype: Archetype) => void;
}

// Client-facing labels + icons — NO admin jargon. authority_bet is handled by the hero,
// so it is intentionally absent here.
const CLIENT_GROUP_META: Record<Exclude<Archetype, 'authority_bet'>, { label: string; description: string; icon: typeof RefreshCw }> = {
  refresh_reclaim: { label: 'Refreshing existing pages', description: 'Updating content to win back rankings', icon: RefreshCw },
  defend: { label: 'Protecting your rankings', description: 'Resolving overlap so the right page wins', icon: Shield },
  quick_win: { label: 'Quick wins', description: 'Small changes with outsized impact', icon: Search },
  technical: { label: 'Technical improvements', description: 'Behind-the-scenes fixes that help every page', icon: Wrench },
  local: { label: 'Local visibility', description: 'Getting found in your service area', icon: Search },
};

const GROUP_ORDER: Exclude<Archetype, 'authority_bet'>[] = [
  'refresh_reclaim', 'defend', 'quick_win', 'technical', 'local',
];

export function IssueAlsoOnPlanSection({ recs, onOpenGroup }: IssueAlsoOnPlanSectionProps) {
  // Bucket non-content recs by archetype.
  const counts = new Map<Exclude<Archetype, 'authority_bet'>, number>();
  for (const rec of recs) {
    const arch = recArchetype(rec.type);
    if (arch === 'authority_bet') continue;
    counts.set(arch, (counts.get(arch) ?? 0) + 1);
  }

  const groups = GROUP_ORDER.filter((a) => (counts.get(a) ?? 0) > 0);
  if (groups.length === 0) return null;

  return (
    <SectionCard title={ISSUE_SECTION_TITLES.alsoOnPlan}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">{ISSUE_SECTION_INTROS.alsoOnPlan}</p>
      <div className="space-y-1.5">
        {groups.map((arch) => {
          const meta = CLIENT_GROUP_META[arch];
          const count = counts.get(arch) ?? 0;
          return (
            <ClickableRow
              key={arch}
              onClick={() => onOpenGroup(arch)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 border border-[var(--brand-border)]/60"
            >
              <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
                <Icon as={meta.icon} size="md" className="text-[var(--brand-text-muted)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">{meta.label}</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{meta.description}</div>
              </div>
              <span className="t-caption-sm font-semibold text-blue-400 flex-shrink-0">
                {count} move{count === 1 ? '' : 's'}
              </span>
              <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
            </ClickableRow>
          );
        })}
      </div>
    </SectionCard>
  );
}
