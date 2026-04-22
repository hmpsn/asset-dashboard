import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { SprintData } from '../../shared/types/roadmap.js';

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priorities' },
  { value: 'P0', label: '🔴 P0 — Do Now' },
  { value: 'P1', label: '🟠 P1 — Do Next' },
  { value: 'P2', label: '🟡 P2 — Do Soon' },
  { value: 'P3', label: '🟢 P3 — Backlog' },
  { value: 'P4', label: '⚪ P4 — Someday' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: '○ Pending' },
  { value: 'in_progress', label: '◑ In Progress' },
  { value: 'done', label: '● Done' },
];

interface Props {
  sprints: SprintData[];
  featureMap: Map<number, string>;
  allTags: string[];
}

export function RoadmapFilterBar({ sprints, featureMap, allTags }: Props) {
  const [params, setParams] = useSearchParams();

  const priority = params.get('priority') ?? 'all';
  const status = params.get('status') ?? 'all';
  const sprint = params.get('sprint') ?? 'all';
  const feature = params.get('feature') ?? 'all';
  const tags = params.get('tags') ?? 'all';

  const setParam = (key: string, val: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (val === 'all') next.delete(key);
      else next.set(key, val);
      return next;
    }, { replace: true });
  };

  const clearAll = () => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      ['priority', 'status', 'sprint', 'feature', 'tags'].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  };

  const hasActiveFilter = [priority, status, sprint, feature, tags].some(v => v !== 'all');

  const cls = 'px-2.5 py-1.5 rounded-lg text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-200 cursor-pointer hover:border-zinc-600 transition-colors';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={priority} onChange={e => setParam('priority', e.target.value)} className={cls}>
        {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select value={status} onChange={e => setParam('status', e.target.value)} className={cls}>
        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select value={sprint} onChange={e => setParam('sprint', e.target.value)} className={cls}>
        <option value="all">All Sprints</option>
        {sprints.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {featureMap.size > 0 && (
        <select value={feature} onChange={e => setParam('feature', e.target.value)} className={cls}>
          <option value="all">All Features</option>
          {Array.from(featureMap.entries()).map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
      )}

      {allTags.length > 0 && (
        <select value={tags} onChange={e => setParam('tags', e.target.value)} className={cls}>
          <option value="all">All Tags</option>
          {allTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      )}

      {hasActiveFilter && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 transition-colors"
        >
          <X className="w-3 h-3" />
          Clear filters
        </button>
      )}
    </div>
  );
}
