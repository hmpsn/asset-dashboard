import { useState } from 'react';
import { BarChart3, Gauge } from 'lucide-react';
import { PageWeight } from './PageWeight';
import { PageSpeedPanel } from './PageSpeedPanel';
import { TabBar } from './ui';

type PerfTab = 'weight' | 'speed';

export function Performance({ siteId, workspaceId }: { siteId: string; workspaceId?: string }) {
  const [tab, setTab] = useState<PerfTab>('weight');

  return (
    <div className="space-y-8">
      <TabBar
        tabs={[
          { id: 'weight', label: 'Page Weight', icon: BarChart3 },
          { id: 'speed', label: 'Page Speed', icon: Gauge },
        ]}
        active={tab}
        onChange={id => setTab(id as PerfTab)}
      />
      {tab === 'weight' && <PageWeight siteId={siteId} workspaceId={workspaceId} />}
      {tab === 'speed' && <PageSpeedPanel siteId={siteId} workspaceId={workspaceId} />}
    </div>
  );
}
