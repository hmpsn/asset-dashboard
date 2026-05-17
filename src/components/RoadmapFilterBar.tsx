import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { SprintData } from '../../shared/types/roadmap';
import { Button, FormSelect } from './ui';

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
      <FormSelect aria-label="Filter by priority" value={priority} onChange={value => setParam('priority', value)} options={PRIORITY_OPTIONS} className={cls} />

      <FormSelect aria-label="Filter by status" value={status} onChange={value => setParam('status', value)} options={STATUS_OPTIONS} className={cls} />

      <FormSelect
        aria-label="Filter by sprint"
        value={sprint}
        onChange={value => setParam('sprint', value)}
        options={[{ value: 'all', label: 'All Sprints' }, ...sprints.map(s => ({ value: s.id, label: s.name }))]}
        className={cls}
      />

      {featureMap.size > 0 && (
        <FormSelect
          aria-label="Filter by feature"
          value={feature}
          onChange={value => setParam('feature', value)}
          options={[{ value: 'all', label: 'All Features' }, ...Array.from(featureMap.entries()).map(([id, name]) => ({ value: String(id), label: name }))]}
          className={cls}
        />
      )}

      {allTags.length > 0 && (
        <FormSelect
          aria-label="Filter by tag"
          value={tags}
          onChange={value => setParam('tags', value)}
          options={[{ value: 'all', label: 'All Tags' }, ...allTags.map(tag => ({ value: tag, label: tag }))]}
          className={cls}
        />
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
