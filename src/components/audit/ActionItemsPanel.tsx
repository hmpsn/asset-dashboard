/**
 * Action items panel — extracted from SeoAudit.tsx
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, CheckCircle, Plus, ListChecks, Trash2, Circle,
} from 'lucide-react';
import { get, post, patch, del } from '../../api/client';
import { EmptyState, Icon, SectionCard, cn } from '../ui';

interface ActionItem {
  id: string;
  snapshotId: string;
  title: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  category?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG = {
  planned: { label: 'Planned', color: 'text-[var(--brand-text)]', bg: 'bg-[var(--surface-2)] border-[var(--brand-border)]', icon: Circle },
  'in-progress': { label: 'In Progress', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Loader2 },
  completed: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle },
} as const;

const PRIORITY_CONFIG = {
  high: { label: 'High', dot: 'bg-red-400' },
  medium: { label: 'Med', dot: 'bg-amber-400' },
  low: { label: 'Low', dot: 'bg-emerald-400' },
} as const;

export function ActionItemsPanel({ snapshotId }: { snapshotId: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    get<ActionItem[]>(`/api/reports/snapshot/${snapshotId}/actions`)
      .then(d => { if (Array.isArray(d)) setItems(d); })
      .catch((err) => {
        console.error('ActionItemsPanel operation failed:', err);
        setLoadError(true);
      });
  }, [snapshotId]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    if (!newTitle.trim()) return;
    await post(`/api/reports/snapshot/${snapshotId}/actions`, { title: newTitle.trim(), description: newDesc.trim(), priority: newPriority });
    setNewTitle('');
    setNewDesc('');
    setAdding(false);
    load();
  };

  const cycleStatus = async (item: ActionItem) => {
    const next = item.status === 'planned' ? 'in-progress' : item.status === 'in-progress' ? 'completed' : 'planned';
    await patch(`/api/reports/snapshot/${snapshotId}/actions/${item.id}`, { status: next });
    load();
  };

  const deleteItem = async (id: string) => {
    await del(`/api/reports/snapshot/${snapshotId}/actions/${id}`);
    load();
  };

  const sorted = [...items].sort((a, b) => {
    const order = { 'in-progress': 0, planned: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  const counts = {
    completed: items.filter(i => i.status === 'completed').length,
    'in-progress': items.filter(i => i.status === 'in-progress').length,
    planned: items.filter(i => i.status === 'planned').length,
  };

  return (
    <SectionCard noPadding>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)]">
        <div className="flex items-center gap-2">
          <Icon as={ListChecks} size="md" className="text-teal-400" />
          <span className="t-body font-medium text-[var(--brand-text-bright)]">Action Items</span>
          {items.length > 0 && (
            <span className="t-caption text-[var(--brand-text-muted)]">
              {counts.completed}/{items.length} done
            </span>
          )}
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption font-medium hover:bg-[var(--surface-3)] transition-colors text-teal-400"
        >
          <Icon as={Plus} size="sm" /> Add
        </button>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="px-4 pt-3">
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-[var(--surface-2)]">
            {counts.completed > 0 && <div className="bg-emerald-500 rounded-full" style={{ width: `${(counts.completed / items.length) * 100}%` }} />}
            {counts['in-progress'] > 0 && <div className="bg-blue-500 rounded-full" style={{ width: `${(counts['in-progress'] / items.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="px-4 py-3 border-b border-[var(--brand-border)] space-y-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-body text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
            onKeyDown={e => e.key === 'Enter' && addItem()}
            autoFocus
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-body text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['high', 'medium', 'low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  className={cn('px-2 py-1 rounded t-caption font-medium border', newPriority === p ? 'border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--brand-text-bright)]' : 'border-transparent text-[var(--brand-text-muted)]')}
                >
                  <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1', PRIORITY_CONFIG[p].dot)} />
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-[var(--radius-md)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]">Cancel</button>
              <button onClick={addItem} className="px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-400 text-[#0f1219]" /* arbitrary-text-ok: has .dashboard-light override */>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="px-4 py-2 border-b border-[var(--brand-border)] t-caption-sm text-red-400/80">
          Couldn't load action items. <button onClick={load} className="underline hover:text-red-400">Retry</button>
        </div>
      )}

      {/* Items list */}
      <div className="divide-y divide-[var(--brand-border)]/50">
        {sorted.map(item => {
          const cfg = STATUS_CONFIG[item.status];
          const StatusIcon = cfg.icon;
          return (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3 group">
              <button onClick={() => cycleStatus(item)} className={cn('mt-0.5', cfg.color)} title={`Click to change status (${cfg.label})`}>
                <StatusIcon className={cn('w-4 h-4', item.status === 'in-progress' && 'animate-spin')} />
              </button>
              <div className="flex-1 min-w-0">
                <div className={cn('t-body', item.status === 'completed' ? 'line-through text-[var(--brand-text-muted)]' : 'text-[var(--brand-text-bright)]')}>{item.title}</div>
                {item.description && <div className="t-caption text-[var(--brand-text-muted)] mt-0.5">{item.description}</div>}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_CONFIG[item.priority]?.dot || 'bg-[var(--brand-text-muted)]')} title={item.priority} />
                <button onClick={() => deleteItem(item.id)} className="text-[var(--brand-text-muted)] hover:text-red-400">
                  <Icon as={Trash2} size="sm" />
                </button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && !adding && (
          <EmptyState
            icon={ListChecks}
            title="No action items yet"
            description='Track work items for this audit report.'
            className="py-6"
            action={
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 t-caption px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
              >
                <Icon as={Plus} size="sm" />
                Add Item
              </button>
            }
          />
        )}
      </div>
    </SectionCard>
  );
}
