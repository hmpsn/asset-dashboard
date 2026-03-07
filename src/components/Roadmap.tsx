import { useState, useEffect } from 'react';
import {
  CheckCircle2, Circle, Clock, ChevronDown, ChevronUp,
  Sparkles, BarChart3, Zap, Users, Wrench, Rocket, Map,
  Loader2, CreditCard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader, SectionCard, Badge, StatCard } from './ui';

/* ── Roadmap data types (matches server JSON shape) ── */
interface RoadmapItem {
  id: number;
  title: string;
  source: string;
  est: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes: string;
  status: 'done' | 'in_progress' | 'pending';
}

interface SprintData {
  id: string;
  name: string;
  rationale: string;
  hours: string;
  items: RoadmapItem[];
}

/* ── Sprint icon mapping (client-side only) ── */
const SPRINT_ICONS: Record<string, LucideIcon> = {
  'sprint-1': Sparkles,
  'sprint-2': CreditCard,
  'sprint-3': BarChart3,
  'sprint-4': Zap,
  'sprint-5': Users,
  'sprint-6': Wrench,
  'backlog': Rocket,
};

const PRIORITY_BADGE: Record<string, { label: string; color: 'red' | 'orange' | 'amber' | 'green' | 'zinc' }> = {
  P0: { label: 'P0 — Do Now', color: 'red' },
  P1: { label: 'P1 — Do Next', color: 'orange' },
  P2: { label: 'P2 — Do Soon', color: 'amber' },
  P3: { label: 'P3 — Backlog', color: 'green' },
  P4: { label: 'P4 — Someday', color: 'zinc' },
};

const STATUS_ICON = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600" />,
};

export function Roadmap() {
  const [expanded, setExpanded] = useState<string | null>('sprint-1');
  const [roadmap, setRoadmap] = useState<SprintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPriority, setFilterPriority] = useState<string>('all');

  // Load full roadmap from server
  useEffect(() => {
    fetch('/api/roadmap')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.sprints && Array.isArray(data.sprints)) {
          setRoadmap(data.sprints);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleStatus = async (itemId: number) => {
    const statusCycle: Array<'pending' | 'in_progress' | 'done'> = ['pending', 'in_progress', 'done'];
    let newStatus = 'pending';
    setRoadmap(prev => {
      return prev.map(sprint => ({
        ...sprint,
        items: sprint.items.map(item => {
          if (item.id !== itemId) return item;
          const idx = statusCycle.indexOf(item.status);
          newStatus = statusCycle[(idx + 1) % statusCycle.length];
          return { ...item, status: newStatus as 'pending' | 'in_progress' | 'done' };
        }),
      }));
    });
    // Persist single item via PATCH
    fetch(`/api/roadmap/item/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  // Stats
  const allItems = roadmap.flatMap(s => s.items);
  const done = allItems.filter(i => i.status === 'done').length;
  const inProgress = allItems.filter(i => i.status === 'in_progress').length;
  const pending = allItems.filter(i => i.status === 'pending').length;
  const total = allItems.length;

  // Current sprint (first sprint with non-done items)
  const currentSprint = roadmap.find(s => s.items.some(i => i.status !== 'done'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        subtitle={`${total} items · ${done} done · ${inProgress} active · ${pending} pending`}
        icon={<Map className="w-5 h-5 text-teal-400" />}
        actions={
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200"
          >
            <option value="all">All Priorities</option>
            <option value="P0">🔴 P0 — Do Now</option>
            <option value="P1">🟠 P1 — Do Next</option>
            <option value="P2">🟡 P2 — Do Soon</option>
            <option value="P3">🟢 P3 — Backlog</option>
            <option value="P4">⚪ P4 — Someday</option>
          </select>
        }
      />

      {/* Progress overview */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total Items" value={total} icon={Map} iconColor="#2dd4bf" />
        <StatCard label="Completed" value={done} icon={CheckCircle2} iconColor="#4ade80" />
        <StatCard label="In Progress" value={inProgress} icon={Clock} iconColor="#fbbf24" />
        <StatCard label="Completion" value={total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'} icon={Rocket} iconColor="#60a5fa" />
      </div>

      {/* Overall progress bar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
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

      {/* Sprint sections */}
      {roadmap.map(sprint => {
        const SprintIcon = SPRINT_ICONS[sprint.id] || Rocket;
        const isExpanded = expanded === sprint.id;
        const sprintDone = sprint.items.filter(i => i.status === 'done').length;
        const sprintTotal = sprint.items.length;
        const filteredItems = filterPriority === 'all' ? sprint.items : sprint.items.filter(i => i.priority === filterPriority);

        if (filterPriority !== 'all' && filteredItems.length === 0) return null;

        return (
          <SectionCard
            key={sprint.id}
            title={sprint.name}
            titleIcon={<SprintIcon className="w-4 h-4 text-teal-400" />}
            titleExtra={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500">{sprint.hours} hrs</span>
                <span className="text-[11px] text-zinc-500">·</span>
                <span className="text-[11px] text-zinc-400">{sprintDone}/{sprintTotal}</span>
                {sprintDone === sprintTotal && sprintTotal > 0 && <CheckCircle2 className="w-3 h-3 text-green-400" />}
              </div>
            }
            action={
              <button onClick={() => setExpanded(isExpanded ? null : sprint.id)} className="p-1 rounded hover:bg-zinc-800 transition-colors">
                {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
              </button>
            }
            noPadding
          >
            {/* Sprint progress bar */}
            <div className="px-4 py-2 border-b border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-zinc-500">{sprint.rationale}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${sprintTotal > 0 ? (sprintDone / sprintTotal) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Items */}
            {isExpanded && (
              <div className="divide-y divide-zinc-800/50">
                {filteredItems.map(item => {
                  const pb = PRIORITY_BADGE[item.priority];
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                      <button
                        onClick={() => toggleStatus(item.id)}
                        className="flex-shrink-0 hover:scale-110 transition-transform"
                        title={`Status: ${item.status} — Click to cycle`}
                      >
                        {STATUS_ICON[item.status]}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${item.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                            {item.title}
                          </span>
                          <Badge label={pb.label} color={pb.color} />
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">{item.notes}</div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-[11px] text-zinc-500">{item.est}</div>
                        <div className="text-[11px] text-zinc-600">{item.source}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
