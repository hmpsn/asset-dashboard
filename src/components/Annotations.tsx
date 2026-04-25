import { useState, useEffect } from 'react';
import { Flag, Plus, Trash2, Loader2 } from 'lucide-react';
import { annotations as annotationsApi } from '../api/misc';
import { EmptyState, Icon, Button } from './ui';
import { cn } from '../lib/utils';

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
      .then(d => { if (Array.isArray(d)) setAnnotations(d as Annotation[]); })
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
        <Icon as={Loader2} size="md" className="animate-spin text-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <Icon as={Flag} size="md" className="text-amber-400/80" />
        <h2 className="text-sm font-semibold text-[var(--zinc-200)]">Timeline Annotations</h2>
        <span className="t-caption px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{annotations.length}</span>
      </div>
      <p className="t-caption text-[var(--brand-text-muted)]">Add markers to track key events. Annotations appear on timeline charts in both the admin and client dashboards.</p>

      {/* Add annotation form */}
      {/* pr-check-disable-next-line -- asymmetric signature radius for annotation form; not a section card */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 space-y-3 rounded-[var(--radius-signature-lg)]">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Date *</label>
            <input type="date" value={newAnn.date} onChange={e => setNewAnn(p => ({ ...p, date: e.target.value }))}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)]" />
          </div>
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Color</label>
            <div className="flex gap-2 pt-1.5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setNewAnn(p => ({ ...p, color: c }))}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-all',
                    newAnn.color === c ? 'border-white scale-110' : 'border-[var(--brand-border-hover)] hover:border-[var(--brand-text-muted)]',
                  )}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Label *</label>
          <input type="text" value={newAnn.label} onChange={e => setNewAnn(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Launched new landing pages"
            className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)] placeholder-[var(--brand-text-dim)]" />
        </div>
        <div>
          <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Description (optional)</label>
          <input type="text" value={newAnn.description} onChange={e => setNewAnn(p => ({ ...p, description: e.target.value }))} placeholder="Additional details..."
            className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)] placeholder-[var(--brand-text-dim)]" />
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          disabled={!newAnn.date || !newAnn.label}
          onClick={addAnnotation}
        >
          Add Annotation
        </Button>
      </div>

      {/* Existing annotations */}
      {annotations.length > 0 ? (
        <div className="space-y-2">
          {annotations.sort((a, b) => b.date.localeCompare(a.date)).map(ann => (
            <div key={ann.id} className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-2)] border border-[var(--brand-border)] group hover:border-[var(--brand-border-hover)] transition-colors rounded-[var(--radius-signature)]">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
              <span className="text-xs text-[var(--brand-text-muted)] flex-shrink-0 font-mono">{ann.date}</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-[var(--zinc-200)] font-medium">{ann.label}</span>
                {ann.description && <span className="t-caption text-[var(--brand-text-muted)] ml-2">{ann.description}</span>}
              </div>
              <button onClick={() => deleteAnnotation(ann.id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-red-400 transition-all flex-shrink-0 p-1" aria-label="Delete annotation">
                <Icon as={Trash2} size="sm" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Flag} title="No annotations yet" description="Add events like algorithm updates, site launches, or marketing campaigns" className="py-8" />
      )}
    </div>
  );
}
