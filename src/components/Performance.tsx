import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Gauge } from 'lucide-react';
import { PageWeight } from './PageWeight';
import { PageSpeedPanel } from './PageSpeedPanel';
import { PageHeader, TabBar } from './ui';

type PerfTab = 'weight' | 'speed';

export function Performance({ siteId, workspaceId }: { siteId: string; workspaceId?: string }) {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<PerfTab>(() => {
    const initialTab = searchParams.get('tab');
    return initialTab === 'speed' || initialTab === 'weight' ? initialTab : 'weight';
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Performance"
        subtitle="Track page weight and Core Web Vitals performance."
        icon={<BarChart3 className="w-5 h-5 text-accent-brand" />}
      />
      <TabBar
        tabs={[
          { id: 'weight', label: 'Page Weight', icon: BarChart3 },
          { id: 'speed', label: 'Page Speed', icon: Gauge },
        ]}
        active={tab}
        onChange={id => setTab(id as PerfTab)}
      />
      {tab === 'weight' && <PageWeight siteId={siteId} workspaceId={workspaceId} />}
      {tab === 'speed' && <PageSpeedPanel siteId={siteId} workspaceId={workspaceId} showHeader={false} />}
    </div>
  );
}
