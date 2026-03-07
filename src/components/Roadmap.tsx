import { useState, useEffect } from 'react';
import {
  CheckCircle2, Circle, Clock, ChevronDown, ChevronUp,
  Sparkles, Shield, BarChart3, Zap, Users, Wrench, Rocket, Map,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge, StatCard } from './ui';

/* ── Roadmap data types ── */
interface RoadmapItem {
  id: number;
  title: string;
  source: string;
  est: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  notes: string;
  status: 'done' | 'in_progress' | 'pending';
}

interface Sprint {
  id: string;
  name: string;
  rationale: string;
  hours: string;
  icon: typeof Sparkles;
  items: RoadmapItem[];
}

/* ── Static roadmap data (mirrors ACTION_PLAN.md) ── */
const SPRINTS: Sprint[] = [
  {
    id: 'sprint-1',
    name: 'AI Chatbot Revenue Engine',
    rationale: 'Fastest path to visible client value and upsell potential. No dependencies.',
    hours: '10-13',
    icon: Sparkles,
    items: [
      { id: 1, title: 'Client AI: Full dashboard context', source: 'AI_CHATBOT_ROADMAP Phase 1', est: '3-4h', priority: 'P0', notes: 'Feed audit, strategy, ranks, content pipeline, approvals, activity, annotations into chatbot', status: 'pending' },
      { id: 2, title: 'Client AI: Global knowledge base', source: 'AI_CHATBOT_ROADMAP Phase 2', est: '4-5h', priority: 'P0', notes: 'SEO fundamentals, industry benchmarks, per-workspace business context', status: 'pending' },
      { id: 3, title: 'Client AI: Sales engine behavior', source: 'AI_CHATBOT_ROADMAP Phase 3', est: '3-4h', priority: 'P0', notes: 'Opportunity detection, soft upsell prompts, action deep-links', status: 'pending' },
    ],
  },
  {
    id: 'sprint-2',
    name: 'Authentication Foundation',
    rationale: 'Blocks team scaling and client professionalism.',
    hours: '15-20',
    icon: Shield,
    items: [
      { id: 4, title: 'Internal user accounts', source: 'AUTH_ROADMAP Phase 1', est: '6-8h', priority: 'P0', notes: 'User model, bcrypt, JWT/sessions, login by email, req.user on all routes', status: 'pending' },
      { id: 5, title: 'Workspace access control', source: 'AUTH_ROADMAP Phase 2', est: '3-4h', priority: 'P0', notes: 'Restrict workspaces by user, role-based middleware', status: 'pending' },
      { id: 6, title: 'Client user accounts', source: 'AUTH_ROADMAP Phase 4', est: '6-8h', priority: 'P0', notes: 'Individual client logins, client_admin/member roles, team management UI', status: 'pending' },
    ],
  },
  {
    id: 'sprint-3',
    name: 'Data Quality & Dashboard Polish',
    rationale: 'Clean up recently shipped work, extend to client side.',
    hours: '8-12',
    icon: BarChart3,
    items: [
      { id: 7, title: 'Admin Search Console: primitives audit', source: 'Memory/Roadmap', est: '1-2h', priority: 'P1', notes: 'Verify new panels use shared UI primitives', status: 'pending' },
      { id: 8, title: 'Client dashboard: simplified search data', source: 'Memory/Roadmap', est: '3-4h', priority: 'P1', notes: 'Traffic growth direction, top pages (plain language), device split', status: 'pending' },
      { id: 9, title: 'Admin GA4 dashboard upgrade', source: 'Memory/Roadmap', est: '3-4h', priority: 'P1', notes: 'Add landing pages, organic overview, period comparison, new vs returning', status: 'pending' },
      { id: 10, title: 'Client dashboard: simplified analytics data', source: 'Memory/Roadmap', est: '2-3h', priority: 'P1', notes: 'Simplified GA4 organic overview for client portal', status: 'pending' },
    ],
  },
  {
    id: 'sprint-4',
    name: 'Intelligence Upgrades',
    rationale: 'Cross-pollinate data across tools for smarter recommendations.',
    hours: '6-9',
    icon: Zap,
    items: [
      { id: 11, title: 'SEO Audit Intelligence', source: 'Memory/Roadmap', est: '3-4h', priority: 'P1', notes: 'Cross-reference audit findings with GSC/GA4 performance data', status: 'pending' },
      { id: 12, title: 'Content brief enrichment', source: 'Memory/Roadmap', est: '1-2h', priority: 'P1', notes: 'Inject real GSC queries + GA4 landing page performance', status: 'pending' },
      { id: 13, title: 'Monthly report enrichment', source: 'Memory/Roadmap', est: '1h', priority: 'P2', notes: 'Period comparison data in auto-generated report narratives', status: 'pending' },
      { id: 14, title: 'AI chatbot: conversation memory', source: 'AI_CHATBOT_ROADMAP Phase 4', est: '3-4h', priority: 'P2', notes: 'Session history, cross-session summaries, client preferences', status: 'pending' },
    ],
  },
  {
    id: 'sprint-5',
    name: 'Team & Permissions',
    rationale: 'Only needed when actually hiring/contracting.',
    hours: '7-9',
    icon: Users,
    items: [
      { id: 15, title: 'Internal team management', source: 'AUTH_ROADMAP Phase 3', est: '4-5h', priority: 'P2', notes: 'Invite, manage, assign workspaces, disable accounts', status: 'pending' },
      { id: 16, title: 'Permission-based feature access', source: 'AUTH_ROADMAP Phase 5', est: '3-4h', priority: 'P2', notes: 'Fine-grained: client_member view-only on approvals', status: 'pending' },
    ],
  },
  {
    id: 'sprint-6',
    name: 'Platform Polish',
    rationale: 'Quality-of-life improvements. Do in batches.',
    hours: '10-15',
    icon: Wrench,
    items: [
      { id: 17, title: 'AI chatbot: proactive insights', source: 'AI_CHATBOT_ROADMAP Phase 5', est: '4-5h', priority: 'P2', notes: 'Auto-surface 2-3 contextual insights on dashboard load', status: 'pending' },
      { id: 18, title: 'Custom date range picker', source: 'FEATURE_AUDIT', est: '2-3h', priority: 'P2', notes: 'Replace preset buttons with full calendar selector', status: 'pending' },
      { id: 19, title: 'Notification preferences', source: 'AUTH_ROADMAP Phase 6', est: '2-3h', priority: 'P3', notes: 'Per-user email settings, digest frequency, in-app bell', status: 'pending' },
      { id: 20, title: 'Content calendar', source: 'FEATURE_AUDIT', est: '3-4h', priority: 'P3', notes: 'Visual calendar of content in production with due dates', status: 'pending' },
    ],
  },
  {
    id: 'backlog',
    name: 'Backlog',
    rationale: 'Revisit quarterly. Do when a specific need justifies it.',
    hours: '50+',
    icon: Rocket,
    items: [
      { id: 21, title: 'AI chatbot: multi-modal responses', source: 'AI_CHATBOT_ROADMAP Phase 6', est: '3-4h', priority: 'P3', notes: 'Inline charts, data tables, export', status: 'pending' },
      { id: 22, title: 'Writer assignment', source: 'FEATURE_AUDIT', est: '2-3h', priority: 'P3', notes: 'Assign content to specific writers', status: 'pending' },
      { id: 23, title: 'Multi-competitor analysis', source: 'FEATURE_AUDIT', est: '3-4h', priority: 'P3', notes: 'Compare against 2-3 competitors simultaneously', status: 'pending' },
      { id: 24, title: 'Client onboarding wizard', source: 'New', est: '2-3h', priority: 'P0', notes: 'Guided first-time experience for new clients', status: 'pending' },
      { id: 25, title: 'Webhook / Zapier triggers', source: 'New', est: '3-4h', priority: 'P0', notes: 'Fire webhooks on key events', status: 'pending' },
      { id: 26, title: 'White-label domain support', source: 'New', est: '2-3h', priority: 'P1', notes: 'CNAME + reverse proxy for client portals', status: 'pending' },
      { id: 27, title: 'ROI calculator / value dashboard', source: 'New', est: '3-4h', priority: 'P1', notes: 'Show dollar value of organic traffic', status: 'pending' },
      { id: 28, title: 'Automated competitive monitoring', source: 'New', est: '3-4h', priority: 'P1', notes: 'Monthly competitor audit, alert on improvements', status: 'pending' },
      { id: 29, title: '"What happened this month" summary', source: 'New', est: '2-3h', priority: 'P1', notes: 'Auto-generated plain-English monthly summary', status: 'pending' },
      { id: 30, title: 'Content performance tracker', source: 'New', est: '3-4h', priority: 'P2', notes: 'Track GSC/GA4 performance per published post', status: 'pending' },
      { id: 31, title: 'AI anomaly detection', source: 'New', est: '4-5h', priority: 'P2', notes: 'Background job to flag traffic/conversion anomalies', status: 'pending' },
      { id: 32, title: 'GSC: URL Inspection API', source: 'Memory/Roadmap', est: '3-4h', priority: 'P4', notes: 'Per-URL indexing status, crawl info', status: 'pending' },
      { id: 33, title: 'GA4: Exit pages + attribution', source: 'Memory/Roadmap', est: '3-4h', priority: 'P4', notes: 'Advanced analytics', status: 'pending' },
      { id: 34, title: 'Responsive mobile layout', source: 'FEATURE_AUDIT', est: '4-6h', priority: 'P4', notes: 'Sidebar → bottom nav, stacked cards', status: 'pending' },
    ],
  },
];

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
  const [roadmap, setRoadmap] = useState<Sprint[]>(SPRINTS);
  const [filterPriority, setFilterPriority] = useState<string>('all');

  // Load persisted roadmap status from server
  useEffect(() => {
    fetch('/api/roadmap-status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data === 'object') {
          setRoadmap(prev => prev.map(sprint => ({
            ...sprint,
            items: sprint.items.map(item => ({
              ...item,
              status: (data as Record<string, string>)[String(item.id)] as 'done' | 'in_progress' | 'pending' || item.status,
            })),
          })));
        }
      })
      .catch(() => {});
  }, []);

  const toggleStatus = async (itemId: number) => {
    const statusCycle: Array<'pending' | 'in_progress' | 'done'> = ['pending', 'in_progress', 'done'];
    setRoadmap(prev => {
      const updated = prev.map(sprint => ({
        ...sprint,
        items: sprint.items.map(item => {
          if (item.id !== itemId) return item;
          const idx = statusCycle.indexOf(item.status);
          return { ...item, status: statusCycle[(idx + 1) % statusCycle.length] };
        }),
      }));
      // Persist to server
      const statusMap: Record<string, string> = {};
      for (const s of updated) for (const i of s.items) statusMap[String(i.id)] = i.status;
      fetch('/api/roadmap-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusMap),
      }).catch(() => {});
      return updated;
    });
  };

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
        const SprintIcon = sprint.icon;
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
