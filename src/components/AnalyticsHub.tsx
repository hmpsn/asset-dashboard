// src/components/AnalyticsHub.tsx
import { useState } from 'react';
import { BarChart3, Search, Activity, StickyNote } from 'lucide-react';
import { PageHeader, TabBar } from './ui';
import { AnalyticsOverview } from './AnalyticsOverview';
import { SearchDetail } from './SearchDetail';
import { TrafficDetail } from './TrafficDetail';
import { AnalyticsAnnotations } from './AnalyticsAnnotations';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

type HubTab = 'overview' | 'search-performance' | 'site-traffic' | 'annotations';

const HUB_TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'annotations', label: 'Annotations', icon: StickyNote },
  { id: 'search-performance', label: 'Search Performance', icon: Search },
  { id: 'site-traffic', label: 'Site Traffic', icon: Activity },
] as const;

export function AnalyticsHub({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [tab, setTab] = useState<HubTab>('overview');

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Search performance, traffic insights, and annotations"
        icon={<BarChart3 className="w-5 h-5 text-teal-400" />}
      />

      {/* tab-deeplink-ok — analytics tabs are not navigated to via ?tab= from other components */}
      <TabBar
        tabs={[...HUB_TABS]}
        active={tab}
        onChange={id => setTab(id as HubTab)}
        className="mb-6 mt-4"
      />

      {tab === 'overview' && (
        <AnalyticsOverview
          workspaceId={workspaceId}
          siteId={siteId}
          gscPropertyUrl={gscPropertyUrl}
          ga4PropertyId={ga4PropertyId}
        />
      )}

      {tab === 'search-performance' && (
        <SearchDetail
          siteId={siteId ?? ''}
          workspaceId={workspaceId}
          gscPropertyUrl={gscPropertyUrl}
        />
      )}

      {tab === 'site-traffic' && (
        <TrafficDetail
          workspaceId={workspaceId}
          ga4PropertyId={ga4PropertyId}
        />
      )}

      {tab === 'annotations' && (
        <AnalyticsAnnotations workspaceId={workspaceId} />
      )}
    </div>
  );
}
