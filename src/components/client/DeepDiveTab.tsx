import { useState } from 'react';
import { ChevronDown, LineChart, Target } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { TabBar, Icon } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Client IA v2 — the single opt-in depth tab.
 *
 * SLOT-BASED: the heavy folded tabs (PerformanceTab, HealthTab, StrategyTab) own
 * their data props in the parent (ClientDashboard) and are passed in here as
 * ReactNode slots. DeepDiveTab only arranges them, owns the sub-tab UX, and
 * seeds the active sub-tab from the URL for deep-linking.
 *
 * Sub-tabs:
 *   - Analytics → analyticsSlot (GSC search + GA4) with healthSlot pinned below
 *   - Rankings  → rankingsSlot (page→keyword map, validate/decline, gaps, roadmap)
 *
 * The top-level `?tab=deep-dive` route contract is owned by the parent route.
 * This internal bar uses `?sub=` for sub-tab deep-linking — exempt from the
 * top-level ?tab= contract via the tab-deeplink-ok hatch below (same pattern as
 * PerformanceTab). It still reads useSearchParams/searchParams.get, satisfying
 * the deep-link receiver half.
 */

type DeepDiveSubTab = 'analytics' | 'rankings';

function isSubTab(value: string | null): value is DeepDiveSubTab {
  return value === 'analytics' || value === 'rankings';
}

export interface DeepDiveTabProps {
  analyticsSlot: React.ReactNode; // PerformanceTab (GSC search + GA4 analytics)
  healthSlot: React.ReactNode; // HealthTab (site-health fix-list), pinned under Analytics
  rankingsSlot: React.ReactNode; // StrategyTab (page→keyword map, validate/decline, gaps, authority, roadmap)
  /** P3: the content-plan roadmap (matrix + per-cell flag), re-homed here as a default-collapsed
   *  section under Rankings when a plan exists. Omitted (undefined) → the section is absent. */
  contentPlanSlot?: React.ReactNode;
}

export function DeepDiveTab({ analyticsSlot, healthSlot, rankingsSlot, contentPlanSlot }: DeepDiveTabProps) {
  const [searchParams] = useSearchParams();
  const [subTab, setSubTab] = useState<DeepDiveSubTab>(() => {
    const param = searchParams.get('sub');
    return isSubTab(param) ? param : 'analytics';
  });

  return (
    <div className="space-y-4">
      {/* tab-deeplink-ok — internal sub-tab bar; parent route owns ?tab=deep-dive, this bar uses ?sub= */}
      <TabBar
        tabs={[
          { id: 'analytics', label: 'Analytics', icon: LineChart },
          { id: 'rankings', label: 'Rankings', icon: Target },
        ]}
        active={subTab}
        onChange={(id) => {
          if (isSubTab(id)) setSubTab(id);
        }}
        className="w-fit"
      />

      {subTab === 'analytics' && (
        <div className="space-y-4">
          <ErrorBoundary>{analyticsSlot}</ErrorBoundary>
          <ErrorBoundary>{healthSlot}</ErrorBoundary>
        </div>
      )}

      {subTab === 'rankings' && (
        <div className="space-y-4">
          <ErrorBoundary>{rankingsSlot}</ErrorBoundary>
          {/* P3: content-plan roadmap, re-homed as a default-collapsed reference section (it lost
              its own tab in the IA v2 collapse). Only rendered when a plan slot is provided. */}
          {contentPlanSlot != null && (
            <details className="group bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature)] overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 [&::-webkit-details-marker]:hidden">
                <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">Content roadmap</span>
                <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand flex-shrink-0">
                  View plan
                  <Icon as={ChevronDown} size="sm" className="transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="px-4 pb-4 pt-1">
                <ErrorBoundary>{contentPlanSlot}</ErrorBoundary>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
