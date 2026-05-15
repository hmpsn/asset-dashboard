import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { SprintData } from '../../shared/types/roadmap';
import { Button } from './ui';

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

  const cls = 'px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption bg-[var(--surface-2)] border border-[var(--brand-border)] text-[var(--brand-text-bright)] cursor-pointer hover:border-[var(--brand-border-hover)] transition-colors';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select aria-label="Filter by priority" value={priority} onChange={e => setParam('priority', e.target.value)} className={cls}>
        {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select aria-label="Filter by status" value={status} onChange={e => setParam('status', e.target.value)} className={cls}>
        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select aria-label="Filter by sprint" value={sprint} onChange={e => setParam('sprint', e.target.value)} className={cls}>
        <option value="all">All Sprints</option>
        {sprints.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {featureMap.size > 0 && (
        <select aria-label="Filter by feature" value={feature} onChange={e => setParam('feature', e.target.value)} className={cls}>
          <option value="all">All Features</option>
          {Array.from(featureMap.entries()).map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
      )}

      {allTags.length > 0 && (
        <select aria-label="Filter by tag" value={tags} onChange={e => setParam('tags', e.target.value)} className={cls}>
          <option value="all">All Tags</option>
          {allTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      )}

      {hasActiveFilter && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={clearAll}
          icon={X}
          className="gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]"
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
