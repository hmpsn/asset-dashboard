import { useState, useEffect } from 'react';
import { Flag, Plus, Trash2, Pencil, Loader2, Check, X } from 'lucide-react';
import { analyticsAnnotations as api } from '../api/misc';
import { EmptyState } from './ui';

interface Annotation {
  id: string;
  workspaceId: string;
  date: string;
  label: string;
  category: string;
  createdBy?: string;
  createdAt: string;
}

type Category = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'site_change', label: 'Site Change' },
  { id: 'algorithm_update', label: 'Algorithm' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'other', label: 'Other' },
];

const BADGE: Record<Category, string> = {
  site_change: 'bg-blue-500/20 text-blue-400',
  algorithm_update: 'bg-amber-500/20 text-amber-400',
  campaign: 'bg-purple-500/20 text-purple-400',
  other: 'bg-zinc-700/50 text-zinc-400',
};

function CategoryBadge({ category }: { category: string }) {
  const cls = BADGE[category as Category] ?? BADGE.other;
  const label = CATEGORIES.find(c => c.id === category)?.label ?? category;
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>
  );
}

export function AnalyticsAnnotations({ workspaceId }: { workspaceId: string }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [newAnn, setNewAnn] = useState({ date: '', label: '', category: 'site_change' as Category });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ date: '', label: '', category: 'site_change' as Category });

  useEffect(() => {
    api.list(workspaceId)
      .then(d => { if (Array.isArray(d)) setAnnotations(d as Annotation[]); })
      .catch(err => console.error('AnalyticsAnnotations fetch failed:', err))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const create = async () => {
    if (!newAnn.date || !newAnn.label) return;
    try {
      const result = await api.create(workspaceId, newAnn) as { id: string };
      const fullAnnotation: Annotation = { id: result.id, workspaceId, date: newAnn.date, label: newAnn.label, category: newAnn.category, createdAt: new Date().toISOString() };
      setAnnotations(prev => [fullAnnotation, ...prev]);
      setNewAnn({ date: '', label: '', category: 'site_change' });
    } catch (err) { console.error('AnalyticsAnnotations create failed:', err); }
  };

  const remove = async (id: string) => {
    try { await api.remove(workspaceId, id); } catch (err) { console.error('AnalyticsAnnotations delete failed:', err); }
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

  const startEdit = (ann: Annotation) => {
    setEditId(ann.id);
    setEditDraft({ date: ann.date, label: ann.label, category: ann.category as Category });
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      await api.update(workspaceId, editId, editDraft);
      setAnnotations(prev => prev.map(a => a.id === editId ? { ...a, ...editDraft } : a));
    } catch (err) { console.error('AnalyticsAnnotations update failed:', err); }
    setEditId(null);
  };

  const visible = annotations
    .filter(a => filter === 'all' || a.category === filter)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Flag className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Annotations</h2>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{annotations.length}</span>
      </div>
      <p className="text-xs text-zinc-500">Track key events — algorithm updates, site launches, and campaigns — as markers on your timeline.</p>

      {/* Create form */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Date *</label>
            <input type="date" value={newAnn.date} onChange={e => setNewAnn(p => ({ ...p, date: e.target.value }))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300" />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Category</label>
            <select value={newAnn.category} onChange={e => setNewAnn(p => ({ ...p, category: e.target.value as Category }))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300">
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-zinc-500 block mb-1">Label *</label>
          <input type="text" value={newAnn.label} onChange={e => setNewAnn(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Launched new landing pages"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
        </div>
        <button onClick={create} disabled={!newAnn.date || !newAnn.label}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Annotation
        </button>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilter('all')}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${filter === 'all' ? 'border-zinc-600 bg-zinc-800 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${filter === c.id ? 'border-zinc-600 bg-zinc-800 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* List */}
      {visible.length > 0 ? (
        <div className="space-y-2">
          {visible.map(ann => (
            <div key={ann.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 group hover:border-zinc-700 transition-colors">
              {editId === ann.id ? (
                <>
                  <input type="date" value={editDraft.date} onChange={e => setEditDraft(p => ({ ...p, date: e.target.value }))}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 flex-shrink-0" />
                  <select value={editDraft.category} onChange={e => setEditDraft(p => ({ ...p, category: e.target.value as Category }))}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 flex-shrink-0">
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <input type="text" value={editDraft.label} onChange={e => setEditDraft(p => ({ ...p, label: e.target.value }))}
                    className="flex-1 min-w-0 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300" />
                  <button onClick={saveEdit} className="text-teal-400 hover:text-teal-300 flex-shrink-0 p-1"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEditId(null)} className="text-zinc-500 hover:text-zinc-300 flex-shrink-0 p-1"><X className="w-3.5 h-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="text-xs text-zinc-500 flex-shrink-0 font-mono">{ann.date}</span>
                  <CategoryBadge category={ann.category} />
                  <span className="text-xs text-zinc-200 font-medium flex-1 min-w-0 truncate">{ann.label}</span>
                  <button onClick={() => startEdit(ann)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 transition-all flex-shrink-0 p-1">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => remove(ann.id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all flex-shrink-0 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Flag} title="No annotations yet" description="Add events like algorithm updates, site launches, or marketing campaigns" className="py-8" />
      )}
    </div>
  );
}
