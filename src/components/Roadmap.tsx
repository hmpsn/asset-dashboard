import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, Clock, Rocket, Map as MapIcon, Loader2, LayoutList, Table2,
} from 'lucide-react';
import { PageHeader, StatCard, TabBar, SectionCard } from './ui/index';
import { ShippingVelocityChart } from './RoadmapVelocityChart';
import { RoadmapFilterBar } from './RoadmapFilterBar';
import { RoadmapSprintView } from './RoadmapSprintView';
import { RoadmapBacklogView } from './RoadmapBacklogView';
import { roadmap as roadmapApi, features as featuresApi } from '../api/misc';
import { queryKeys } from '../lib/queryKeys';
import { filtersFromParams, deriveAllTags } from '../lib/roadmapFilters';
import type { SprintData } from '../../shared/types/roadmap';
import type { FeaturesData } from '../../shared/types/features';

const VIEW_TABS = [
  { id: 'sprint', label: 'Sprint View', icon: LayoutList },
  { id: 'backlog', label: 'Backlog View', icon: Table2 },
];

export function Roadmap() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const view = params.get('view') ?? 'sprint';

  const { data: roadmap = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.roadmap(),
    queryFn: async () => {
      const data = await roadmapApi.get() as { sprints?: SprintData[] };
      return Array.isArray(data?.sprints) ? data.sprints : [];
    },
  });

  const { data: featuresData } = useQuery({
    queryKey: queryKeys.shared.features(),
    queryFn: () => featuresApi.get(),
  });

  const featureMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of ((featuresData as FeaturesData | undefined)?.features ?? [])) {
      map.set(f.id, f.title);
    }
    return map;
  }, [featuresData]);

  const allTags = useMemo(() => deriveAllTags(roadmap), [roadmap]);
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const toggleStatus = async (itemId: number | string) => {
    const cycle: Array<'pending' | 'in_progress' | 'done'> = ['pending', 'in_progress', 'done'];
    let newStatus: 'pending' | 'in_progress' | 'done' = 'pending';
    const previousSnapshot = queryClient.getQueryData<SprintData[]>(queryKeys.admin.roadmap());
    queryClient.setQueryData(queryKeys.admin.roadmap(), (prev: SprintData[] = []) =>
      prev.map(sprint => ({
        ...sprint,
        items: sprint.items.map(item => {
          if (item.id !== itemId) return item;
          const idx = cycle.indexOf(item.status);
          newStatus = cycle[(idx + 1) % cycle.length];
          return { ...item, status: newStatus };
        }),
      })),
    );
    roadmapApi.updateItem(itemId, { status: newStatus }).catch(err => {
      console.error('Roadmap status update failed:', err);
      if (previousSnapshot !== undefined) {
        queryClient.setQueryData(queryKeys.admin.roadmap(), previousSnapshot);
      }
    });
  };

  const handleViewChange = (id: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', id);
      return next;
    }, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  const allItems = roadmap.flatMap(s => s.items);
  const done = allItems.filter(i => i.status === 'done').length;
  const inProgress = allItems.filter(i => i.status === 'in_progress').length;
  const pending = allItems.filter(i => i.status === 'pending').length;
  const total = allItems.length;
  const currentSprint = roadmap.find(s => s.items.some(i => i.status !== 'done'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        subtitle={`${total} items · ${done} done · ${inProgress} active · ${pending} pending`}
        icon={<MapIcon className="w-5 h-5 text-teal-400" />}
      />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Items" value={total} icon={MapIcon} iconColor="#2dd4bf" size="hero" staggerIndex={0} />
        <StatCard label="Completed" value={done} icon={CheckCircle2} iconColor="#4ade80" size="hero" staggerIndex={1} />
        <StatCard label="In Progress" value={inProgress} icon={Clock} iconColor="#fbbf24" size="hero" staggerIndex={2} />
        <StatCard label="Completion" value={total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'} icon={Rocket} iconColor="#60a5fa" size="hero" staggerIndex={3} />
      </div>

      <ShippingVelocityChart items={allItems} />

      <SectionCard noPadding>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400">Overall Progress</span>
            {currentSprint && <span className="text-[11px] text-teal-400">Current: {currentSprint.name}</span>}
          </div>
          <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden flex">
            {done > 0 && <div className="h-full bg-green-500 transition-all" style={{ width: `${(done / total) * 100}%` }} />}
            {inProgress > 0 && <div className="h-full bg-teal-400 transition-all" style={{ width: `${(inProgress / total) * 100}%` }} />}
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Done ({done})</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" /> Active ({inProgress})</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-700" /> Pending ({pending})</span>
          </div>
        </div>
      </SectionCard>

      <div className="space-y-3">
        {/* tab-deeplink-ok — uses ?view= param (not ?tab=) which is read from useSearchParams above */}
        <TabBar tabs={VIEW_TABS} active={view} onChange={handleViewChange} />
        <RoadmapFilterBar sprints={roadmap} featureMap={featureMap} allTags={allTags} />
      </div>

      {view === 'sprint' ? (
        <RoadmapSprintView
          sprints={roadmap}
          filters={filters}
          featureMap={featureMap}
          onToggleStatus={toggleStatus}
        />
      ) : (
        <RoadmapBacklogView
          sprints={roadmap}
          filters={filters}
          featureMap={featureMap}
          onToggleStatus={toggleStatus}
        />
      )}
    </div>
  );
}
