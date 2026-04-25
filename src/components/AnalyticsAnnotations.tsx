import { useState } from 'react';
import { Flag, Plus, Trash2, Pencil, Loader2, Check, X } from 'lucide-react';
import { EmptyState, Icon, Button } from './ui';
import { cn } from '../lib/utils';
import {
  useAnalyticsAnnotations,
  useCreateAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
  type Annotation,
} from '../hooks/admin/useAnalyticsAnnotations';

type Category = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'site_change', label: 'Site Change' },
  { id: 'algorithm_update', label: 'Algorithm' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'other', label: 'Other' },
];

const BADGE: Record<Category, string> = {
  site_change: 'bg-blue-500/20 text-blue-400',
  algorithm_update: 'bg-amber-500/20 text-amber-400/80',
  campaign: 'bg-purple-500/20 text-purple-400',
  other: 'bg-[var(--surface-3)]/50 text-[var(--brand-text)]',
};

function CategoryBadge({ category }: { category: string }) {
  const cls = BADGE[category as Category] ?? BADGE.other;
  const label = CATEGORIES.find(c => c.id === category)?.label ?? category;
  return (
    <span className={cn('t-caption px-1.5 py-0.5 rounded-md font-medium', cls)}>{label}</span>
  );
}

export function AnalyticsAnnotations({ workspaceId }: { workspaceId: string }) {
  const { data: annotations = [], isLoading } = useAnalyticsAnnotations(workspaceId);
  const createMutation = useCreateAnnotation(workspaceId);
  const updateMutation = useUpdateAnnotation(workspaceId);
  const deleteMutation = useDeleteAnnotation(workspaceId);

  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [newAnn, setNewAnn] = useState({ date: '', label: '', category: 'site_change' as Category });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ date: '', label: '', category: 'site_change' as Category });

  const create = () => {
    if (!newAnn.date || !newAnn.label) return;
    createMutation.mutate(newAnn, {
      onSuccess: () => setNewAnn({ date: '', label: '', category: 'site_change' }),
    });
  };

  const remove = (id: string) => deleteMutation.mutate(id);

  const startEdit = (ann: Annotation) => {
    setEditId(ann.id);
    setEditDraft({ date: ann.date, label: ann.label, category: ann.category as Category });
  };

  const saveEdit = () => {
    if (!editId) return;
    updateMutation.mutate({ id: editId, ...editDraft }, {
      onSuccess: () => setEditId(null),
    });
  };

  const visible = annotations
    .filter(a => filter === 'all' || a.category === filter)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (isLoading) {
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
        <h2 className="text-sm font-semibold text-[var(--zinc-200)]">Annotations</h2>
        <span className="t-caption px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{annotations.length}</span>
      </div>
      <p className="t-caption text-[var(--brand-text-muted)]">Track key events — algorithm updates, site launches, and campaigns — as markers on your timeline.</p>

      {/* Create form */}
      {/* pr-check-disable-next-line -- asymmetric signature radius for annotation form; not a section card */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 space-y-3 rounded-[var(--radius-signature-lg)]">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Date *</label>
            <input type="date" value={newAnn.date} onChange={e => setNewAnn(p => ({ ...p, date: e.target.value }))}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)]" />
          </div>
          <div>
            <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Category</label>
            <select value={newAnn.category} onChange={e => setNewAnn(p => ({ ...p, category: e.target.value as Category }))}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)]">
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="t-caption text-[var(--brand-text-muted)] block mb-1">Label *</label>
          <input type="text" value={newAnn.label} onChange={e => setNewAnn(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Launched new landing pages"
            className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)] placeholder-[var(--brand-text-dim)]" />
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          disabled={!newAnn.date || !newAnn.label || createMutation.isPending}
          onClick={create}
        >
          Add Annotation
        </Button>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilter('all')}
          className={cn(
            't-caption px-2.5 py-1 rounded-full border transition-colors',
            filter === 'all' ? 'border-[var(--brand-border-hover)] bg-[var(--surface-3)] text-[var(--zinc-200)]' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-hover)]',
          )}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setFilter(c.id)}
            className={cn(
              't-caption px-2.5 py-1 rounded-full border transition-colors',
              filter === c.id ? 'border-[var(--brand-border-hover)] bg-[var(--surface-3)] text-[var(--zinc-200)]' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-hover)]',
            )}>
            {c.label}
          </button>
        ))}
      </div>

      {/* List */}
      {visible.length > 0 ? (
        <div className="space-y-2">
          {visible.map(ann => (
            <div key={ann.id} className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-2)] border border-[var(--brand-border)] group hover:border-[var(--brand-border-hover)] transition-colors rounded-[var(--radius-signature)]">
              {editId === ann.id ? (
                <>
                  <input type="date" value={editDraft.date} onChange={e => setEditDraft(p => ({ ...p, date: e.target.value }))}
                    className="px-2 py-1 bg-[var(--surface-1)] border border-[var(--brand-border-hover)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)] flex-shrink-0" />
                  <select value={editDraft.category} onChange={e => setEditDraft(p => ({ ...p, category: e.target.value as Category }))}
                    className="px-2 py-1 bg-[var(--surface-1)] border border-[var(--brand-border-hover)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)] flex-shrink-0">
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <input type="text" value={editDraft.label} onChange={e => setEditDraft(p => ({ ...p, label: e.target.value }))}
                    className="flex-1 min-w-0 px-2 py-1 bg-[var(--surface-1)] border border-[var(--brand-border-hover)] rounded-[var(--radius-sm)] text-xs text-[var(--zinc-300)]" />
                  <button onClick={saveEdit} disabled={updateMutation.isPending} className="text-teal-400 hover:text-teal-300 flex-shrink-0 p-1" aria-label="Save edit">
                    <Icon as={Check} size="sm" />
                  </button>
                  <button onClick={() => setEditId(null)} className="text-[var(--brand-text-muted)] hover:text-[var(--zinc-300)] flex-shrink-0 p-1" aria-label="Cancel edit">
                    <Icon as={X} size="sm" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-[var(--brand-text-muted)] flex-shrink-0 font-mono">{ann.date}</span>
                  <CategoryBadge category={ann.category} />
                  <span className="text-xs text-[var(--zinc-200)] font-medium flex-1 min-w-0 truncate">{ann.label}</span>
                  <button onClick={() => startEdit(ann)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-[var(--zinc-300)] transition-all flex-shrink-0 p-1" aria-label="Edit annotation">
                    <Icon as={Pencil} size="sm" />
                  </button>
                  <button onClick={() => remove(ann.id)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-red-400 transition-all flex-shrink-0 p-1" aria-label="Delete annotation">
                    <Icon as={Trash2} size="sm" />
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
