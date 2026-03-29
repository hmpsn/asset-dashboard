import { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2, Circle, Clock, ChevronDown, ChevronUp,
  Sparkles, BarChart3, Zap, Users, Wrench, Rocket, Map,
  Loader2, CreditCard, Package, Brain, TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader, SectionCard, Badge, StatCard } from './ui';
import { roadmap as roadmapApi } from '../api/misc';

/* ── Roadmap data types (from shared types) ── */
import type { RoadmapItem, SprintData } from '../../shared/types/roadmap.ts';

/* ── Sprint icon mapping (client-side only) ── */
const SPRINT_ICONS: Record<string, LucideIcon> = {
  'sprint-B': TrendingUp,
  'sprint-C': Package,
  'sprint-D': Rocket,
  'sprint-E': Wrench,
  'sprint-F': Brain,
  'sprint-G-new': Users,
  'backlog': Map,
  'sprint-1': Sparkles,
  'sprint-2': CreditCard,
  'sprint-3': BarChart3,
  'sprint-4': Zap,
  'sprint-5': Users,
  'sprint-6': Wrench,
};

/* ── Shipping Velocity Chart (pure SVG) ── */
function ShippingVelocityChart({ items }: { items: RoadmapItem[] }) {
  const data = useMemo(() => {
    const shipped = items.filter(i => i.status === 'done' && i.shippedAt);
    const byMonth: Record<string, number> = {};
    shipped.forEach(i => {
      const key = i.shippedAt!.slice(0, 7); // YYYY-MM
      byMonth[key] = (byMonth[key] || 0) + 1;
    });
    const sorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.reduce<Array<{ month: string; count: number; cumulative: number }>>((acc, [month, count]) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ month, count, cumulative: prev + count });
      return acc;
    }, []);
  }, [items]);

  if (data.length < 2) return null;

  const W = 600, H = 180, PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxY = Math.max(...data.map(d => d.cumulative));
  const xStep = chartW / (data.length - 1);

  const points = data.map((d, i) => ({
    x: PAD_L + i * xStep,
    y: PAD_T + chartH - (d.cumulative / maxY) * chartH,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD_T + chartH} L${points[0].x},${PAD_T + chartH} Z`;

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatMonth = (m: string) => {
    const [, mo] = m.split('-');
    return MONTH_NAMES[parseInt(mo, 10) - 1] || mo;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-zinc-400">Shipping Velocity</span>
        <span className="text-[11px] text-zinc-500">{data[data.length - 1].cumulative} features shipped</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        <defs>
          <linearGradient id="vel-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Y-axis gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = PAD_T + chartH - f * chartH;
          return (
            <g key={f}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#27272a" strokeWidth="1" />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" className="fill-zinc-600" fontSize="10">
                {Math.round(f * maxY)}
              </text>
            </g>
          );
        })}
        {/* Area + line */}
        <path d={areaPath} fill="url(#vel-grad)" />
        <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Data points + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="#0f0f0f" stroke="#2dd4bf" strokeWidth="2" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-teal-400" fontSize="10" fontWeight="600">
              +{p.count}
            </text>
            <text x={p.x} y={PAD_T + chartH + 16} textAnchor="middle" className="fill-zinc-500" fontSize="10">
              {formatMonth(p.month)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

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
    roadmapApi.get()
      .then(data => {
        const d = data as { sprints?: SprintData[] };
        if (d?.sprints && Array.isArray(d.sprints)) {
          setRoadmap(d.sprints);
        }
      })
      .catch((err) => { console.error('Roadmap operation failed:', err); })
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
    roadmapApi.updateItem(itemId, { status: newStatus }).catch((err) => { console.error('Roadmap operation failed:', err); });
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
    <div className="space-y-8">
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
        <StatCard label="Total Items" value={total} icon={Map} iconColor="#2dd4bf" size="hero" staggerIndex={0} />
        <StatCard label="Completed" value={done} icon={CheckCircle2} iconColor="#4ade80" size="hero" staggerIndex={1} />
        <StatCard label="In Progress" value={inProgress} icon={Clock} iconColor="#fbbf24" size="hero" staggerIndex={2} />
        <StatCard label="Completion" value={total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'} icon={Rocket} iconColor="#60a5fa" size="hero" staggerIndex={3} />
      </div>

      {/* Shipping velocity chart */}
      <ShippingVelocityChart items={allItems} />

      {/* Overall progress bar */}
      <div className="bg-zinc-900 border border-zinc-800 px-4 py-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
