import { useState, useEffect } from 'react';
import { Flag, Plus, Trash2, Loader2 } from 'lucide-react';
import { annotations as annotationsApi } from '../api/misc';

interface Annotation {
  id: string;
  workspaceId: string;
  date: string;
  label: string;
  description?: string;
  color?: string;
  createdAt: string;
}

const COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'];

export function Annotations({ workspaceId }: { workspaceId: string }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAnn, setNewAnn] = useState({ date: '', label: '', description: '', color: '#2dd4bf' });

  useEffect(() => {
    annotationsApi.list(workspaceId)
      .then(d => { if (Array.isArray(d)) setAnnotations(d); })
      .catch((err) => { console.error('Annotations operation failed:', err); })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const addAnnotation = async () => {
    if (!newAnn.date || !newAnn.label) return;
    try {
      const entry = await annotationsApi.create(workspaceId, newAnn);
      setAnnotations(prev => [entry as Annotation, ...prev]);
      setNewAnn({ date: '', label: '', description: '', color: '#2dd4bf' });
    } catch (err) { console.error('Annotations operation failed:', err); }
  };

  const deleteAnnotation = async (id: string) => {
    try {
      await annotationsApi.remove(workspaceId, id);
    } catch (err) { console.error('Annotations operation failed:', err); }
    setAnnotations(prev => prev.filter(a => a.id !== id));
  };

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
        <h2 className="text-sm font-semibold text-zinc-200">Timeline Annotations</h2>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{annotations.length}</span>
      </div>
      <p className="text-xs text-zinc-500">Add markers to track key events. Annotations appear on timeline charts in both the admin and client dashboards.</p>

      {/* Add annotation form */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Date *</label>
            <input type="date" value={newAnn.date} onChange={e => setNewAnn(p => ({ ...p, date: e.target.value }))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300" />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Color</label>
            <div className="flex gap-2 pt-1.5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setNewAnn(p => ({ ...p, color: c }))}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${newAnn.color === c ? 'border-white scale-110' : 'border-zinc-700 hover:border-zinc-500'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="text-[11px] text-zinc-500 block mb-1">Label *</label>
          <input type="text" value={newAnn.label} onChange={e => setNewAnn(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Launched new landing pages"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
        </div>
        <div>
          <label className="text-[11px] text-zinc-500 block mb-1">Description (optional)</label>
          <input type="text" value={newAnn.description} onChange={e => setNewAnn(p => ({ ...p, description: e.target.value }))} placeholder="Additional details..."
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
        </div>
        <button onClick={addAnnotation} disabled={!newAnn.date || !newAnn.label}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Annotation
        </button>
      </div>

      {/* Existing annotations */}
      {annotations.length > 0 ? (
        <div className="space-y-2">
          {annotations.sort((a, b) => b.date.localeCompare(a.date)).map(ann => (
            <div key={ann.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 group hover:border-zinc-700 transition-colors">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
              <span className="text-xs text-zinc-500 flex-shrink-0 font-mono">{ann.date}</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-zinc-200 font-medium">{ann.label}</span>
                {ann.description && <span className="text-[11px] text-zinc-500 ml-2">{ann.description}</span>}
              </div>
              <button onClick={() => deleteAnnotation(ann.id)}
                className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all flex-shrink-0 p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Flag className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">No annotations yet</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Add events like algorithm updates, site launches, or marketing campaigns</p>
        </div>
      )}
    </div>
  );
}
