import { useState } from 'react';
import { LineChart, Target } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { TabBar } from '../ui';
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
}

export function DeepDiveTab({ analyticsSlot, healthSlot, rankingsSlot }: DeepDiveTabProps) {
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

      {subTab === 'rankings' && <ErrorBoundary>{rankingsSlot}</ErrorBoundary>}
    </div>
  );
}
