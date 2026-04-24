/**
 * Action items panel — extracted from SeoAudit.tsx
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, CheckCircle, Plus, ListChecks, Trash2, Circle,
} from 'lucide-react';
import { get, post, patch, del } from '../../api/client';
import { EmptyState } from '../ui';

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
  planned: { label: 'Planned', color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/30', icon: Circle },
  'in-progress': { label: 'In Progress', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: Loader2 },
  completed: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle },
} as const;

const PRIORITY_CONFIG = {
  high: { label: 'High', dot: 'bg-red-400' },
  medium: { label: 'Med', dot: 'bg-amber-400' },
  low: { label: 'Low', dot: 'bg-green-400' },
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
    <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-zinc-300">Action Items</span>
          {items.length > 0 && (
            <span className="text-xs text-zinc-500">
              {counts.completed}/{items.length} done
            </span>
          )}
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-zinc-800 transition-colors text-teal-400"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="px-4 pt-3">
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-zinc-800">
            {counts.completed > 0 && <div className="bg-emerald-500 rounded-full" style={{ width: `${(counts.completed / items.length) * 100}%` }} />}
            {counts['in-progress'] > 0 && <div className="bg-blue-500 rounded-full" style={{ width: `${(counts['in-progress'] / items.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            onKeyDown={e => e.key === 'Enter' && addItem()}
            autoFocus
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['high', 'medium', 'low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setNewPriority(p)}
                  className={`px-2 py-1 rounded text-xs font-medium border ${newPriority === p ? 'border-zinc-600 bg-zinc-800 text-zinc-200' : 'border-transparent text-zinc-500'}`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${PRIORITY_CONFIG[p].dot} mr-1`} />
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
              <button onClick={addItem} className="px-3 py-1.5 rounded-md text-xs font-medium bg-teal-400 text-[#0f1219]">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-red-400/80">
          Couldn't load action items. <button onClick={load} className="underline hover:text-red-400">Retry</button>
        </div>
      )}

      {/* Items list */}
      <div className="divide-y divide-zinc-800/50">
        {sorted.map(item => {
          const cfg = STATUS_CONFIG[item.status];
          const Icon = cfg.icon;
          return (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3 group">
              <button onClick={() => cycleStatus(item)} className={`mt-0.5 ${cfg.color}`} title={`Click to change status (${cfg.label})`}>
                <Icon className={`w-4 h-4 ${item.status === 'in-progress' ? 'animate-spin' : ''}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${item.status === 'completed' ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>{item.title}</div>
                {item.description && <div className="text-xs text-zinc-500 mt-0.5">{item.description}</div>}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_CONFIG[item.priority]?.dot || 'bg-zinc-500'}`} title={item.priority} />
                <button onClick={() => deleteItem(item.id)} className="text-zinc-500 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
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
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add Item
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
