// @ds-rebuilt
import { Check, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsAnnotations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ChartCard,
  EmptyState,
  FilterChip,
  FormInput,
  FormSelect,
  IconButton,
  InlineBanner,
  Skeleton,
} from '../ui';
import { useAnalyticsAnnotations } from '../../hooks/admin/useAnalyticsAnnotations';
import type { AnnotationCategory, RebuiltAnnotation } from './types';
import { ANNOTATION_CATEGORIES, categoryMeta } from './searchTrafficUtils';

interface AnnotationDraft {
  date: string;
  label: string;
  category: AnnotationCategory;
  pageUrl: string;
}

const EMPTY_DRAFT: AnnotationDraft = {
  date: '',
  label: '',
  category: 'site_change',
  pageUrl: '',
};

interface AnnotationsLensProps {
  workspaceId: string;
}

function mutationMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AnnotationsLens({ workspaceId }: AnnotationsLensProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const annotationsQuery = useAnalyticsAnnotations(workspaceId);
  const annotations = (annotationsQuery.data ?? []) as RebuiltAnnotation[];
  const [filter, setFilter] = useState<AnnotationCategory | 'all'>('all');
  const [draft, setDraft] = useState<AnnotationDraft>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AnnotationDraft>(EMPTY_DRAFT);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
  };

  const createMutation = useMutation({
    mutationFn: (body: AnnotationDraft) => analyticsAnnotations.create(workspaceId, {
      date: body.date,
      label: body.label,
      category: body.category,
      ...(body.pageUrl.trim() ? { pageUrl: body.pageUrl.trim() } : {}),
    }),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      invalidate();
      toast('Annotation added', 'success');
    },
    onError: (error) => toast(mutationMessage(error, 'Annotation add failed'), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AnnotationDraft }) => analyticsAnnotations.update(workspaceId, id, {
      date: body.date,
      label: body.label,
      category: body.category,
      pageUrl: body.pageUrl.trim(),
    }),
    onSuccess: () => {
      setEditId(null);
      invalidate();
      toast('Annotation updated', 'success');
    },
    onError: (error) => toast(mutationMessage(error, 'Annotation update failed'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => analyticsAnnotations.remove(workspaceId, id),
    onSuccess: () => {
      invalidate();
      toast('Annotation deleted', 'success');
    },
    onError: (error) => toast(mutationMessage(error, 'Annotation delete failed'), 'error'),
  });

  const visible = useMemo(() => annotations
    .filter((annotation) => filter === 'all' || annotation.category === filter)
    .sort((a, b) => b.date.localeCompare(a.date)), [annotations, filter]);

  const counts = useMemo(() => {
    const next = new Map<AnnotationCategory | 'all', number>();
    next.set('all', annotations.length);
    for (const category of ANNOTATION_CATEGORIES) next.set(category.id, 0);
    for (const annotation of annotations) {
      const key = ANNOTATION_CATEGORIES.some((item) => item.id === annotation.category)
        ? annotation.category as AnnotationCategory
        : 'other';
      next.set(key, (next.get(key) ?? 0) + 1);
    }
    return next;
  }, [annotations]);

  const canCreate = draft.date.trim() && draft.label.trim();

  const startEdit = (annotation: RebuiltAnnotation) => {
    setEditId(annotation.id);
    setEditDraft({
      date: annotation.date,
      label: annotation.label,
      category: ANNOTATION_CATEGORIES.some((item) => item.id === annotation.category) ? annotation.category as AnnotationCategory : 'other',
      pageUrl: annotation.pageUrl ?? '',
    });
  };

  if (annotationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-label="Loading annotations">
        <Skeleton className="h-[180px] w-full" />
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {annotationsQuery.isError && (
        <InlineBanner tone="warning" title="Annotations may be stale">
          The latest annotation read failed, so the list may be using cached data.
        </InlineBanner>
      )}

      <ChartCard title="Add annotation" titleIcon={<StickyNote size={16} className="text-[var(--teal)]" aria-hidden="true" />}>
        <div className="grid gap-3 lg:grid-cols-[160px_190px_minmax(220px,1fr)]">
          <FormInput type="date" value={draft.date} onChange={(date) => setDraft((current) => ({ ...current, date }))} aria-label="Annotation date" />
          <FormSelect
            value={draft.category}
            onChange={(category) => setDraft((current) => ({ ...current, category: category as AnnotationCategory }))}
            options={ANNOTATION_CATEGORIES.map((category) => ({ value: category.id, label: category.label }))}
            aria-label="Annotation category"
          />
          <FormInput value={draft.label} onChange={(label) => setDraft((current) => ({ ...current, label }))} placeholder="Launched service page updates" aria-label="Annotation label" />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto]">
          <FormInput value={draft.pageUrl} onChange={(pageUrl) => setDraft((current) => ({ ...current, pageUrl }))} placeholder="Optional page URL" aria-label="Annotation page URL" />
          <Button size="sm" variant="primary" disabled={!canCreate || createMutation.isPending} onClick={() => createMutation.mutate(draft)}>
            <Plus size={14} aria-hidden="true" />
            Add annotation
          </Button>
        </div>
      </ChartCard>

      <div className="flex flex-wrap items-center gap-2" aria-label="Annotation category filters">
        <FilterChip label="All" active={filter === 'all'} count={counts.get('all') ?? 0} onClick={() => setFilter('all')} />
        {ANNOTATION_CATEGORIES.map((category) => (
          <FilterChip
            key={category.id}
            label={category.label}
            active={filter === category.id}
            count={counts.get(category.id) ?? 0}
            onClick={() => setFilter(category.id)}
          />
        ))}
      </div>

      {visible.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visible.map((annotation) => {
            const meta = categoryMeta(annotation.category);
            const editing = editId === annotation.id;
            return (
              <div
                key={annotation.id}
                className="group rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3 transition-colors hover:border-[var(--brand-border-hover)]"
                style={{ transitionDuration: 'var(--dur-fast)' }}
              >
                {editing ? (
                  <div className="grid gap-3 lg:grid-cols-[150px_180px_minmax(220px,1fr)_minmax(220px,1fr)_auto]">
                    <FormInput type="date" value={editDraft.date} onChange={(date) => setEditDraft((current) => ({ ...current, date }))} aria-label="Edit annotation date" />
                    <FormSelect value={editDraft.category} onChange={(category) => setEditDraft((current) => ({ ...current, category: category as AnnotationCategory }))} options={ANNOTATION_CATEGORIES.map((category) => ({ value: category.id, label: category.label }))} aria-label="Edit annotation category" />
                    <FormInput value={editDraft.label} onChange={(label) => setEditDraft((current) => ({ ...current, label }))} aria-label="Edit annotation label" />
                    <FormInput value={editDraft.pageUrl} onChange={(pageUrl) => setEditDraft((current) => ({ ...current, pageUrl }))} placeholder="Optional page URL" aria-label="Edit annotation page URL" />
                    <div className="flex items-center gap-1">
                      <IconButton icon={Check} label="Save annotation" size="sm" variant="solid" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: annotation.id, body: editDraft })} />
                      <IconButton icon={X} label="Cancel edit" size="sm" variant="ghost" onClick={() => setEditId(null)} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="t-mono text-[var(--brand-text-muted)]">{annotation.date}</span>
                    <Badge label={meta.label} tone={meta.tone} variant="soft" size="sm" />
                    <span className="min-w-0 flex-1 t-ui font-semibold text-[var(--brand-text-bright)]">{annotation.label}</span>
                    {annotation.pageUrl && <span className="t-caption font-mono text-[var(--brand-text-muted)]">{annotation.pageUrl}</span>}
                    <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <IconButton icon={Pencil} label="Edit annotation" size="sm" variant="ghost" onClick={() => startEdit(annotation)} />
                      <IconButton icon={Trash2} label="Delete annotation" size="sm" variant="ghost" onClick={() => deleteMutation.mutate(annotation.id)} disabled={deleteMutation.isPending} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={StickyNote}
          title="No annotations in this filter"
          description="Add algorithm changes, site updates, campaigns, or page-specific notes to explain traffic movement."
        />
      )}
    </div>
  );
}

