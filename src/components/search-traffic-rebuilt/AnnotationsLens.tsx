// @ds-rebuilt
import { Activity, Check, Pencil, StickyNote, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsAnnotations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../Toast';
import { AnnotatedTrendChart, type TrendLine } from '../charts/AnnotatedTrendChart';
import {
  Badge,
  Button,
  ChartCard,
  EmptyState,
  FilterChip,
  FormInput,
  FormSelect,
  Icon,
  IconButton,
  InlineBanner,
  Skeleton,
} from '../ui';
import { useAnalyticsAnnotations } from '../../hooks/admin/useAnalyticsAnnotations';
import type {
  AnnotationCategory,
  RebuiltAnnotation,
  SearchTrafficGa4Data,
  SearchTrafficSearchData,
} from './types';
import { ANNOTATION_CATEGORIES, SERIES, categoryMeta } from './searchTrafficUtils';

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
  searchData: SearchTrafficSearchData;
  trafficData: SearchTrafficGa4Data;
  searchConfigured: boolean;
  trafficConfigured: boolean;
}

const SEARCH_ANNOTATION_LINES: TrendLine[] = [
  { key: 'clicks', color: SERIES.clicks, yAxisId: 'left', label: 'Clicks' },
  { key: 'clicksPrior', color: SERIES.previous, yAxisId: 'left', label: 'Prior clicks' },
];
const TRAFFIC_ANNOTATION_LINES: TrendLine[] = [
  { key: 'users', color: SERIES.users, yAxisId: 'left', label: 'Users' },
  { key: 'sessions', color: SERIES.sessions, yAxisId: 'left', label: 'Sessions' },
];

function mutationMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AnnotationsLens({
  workspaceId,
  searchData,
  trafficData,
  searchConfigured,
  trafficConfigured,
}: AnnotationsLensProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const annotationsQuery = useAnalyticsAnnotations(workspaceId);
  const annotations = (annotationsQuery.data ?? []) as RebuiltAnnotation[];
  const [filter, setFilter] = useState<AnnotationCategory | 'all'>('all');
  const [draft, setDraft] = useState<AnnotationDraft>(EMPTY_DRAFT);
  const [createOpen, setCreateOpen] = useState(false);
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
      setCreateOpen(false);
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
  const hasSearchTrend = searchConfigured && searchData.trend.length > 0;
  const hasTrafficTrend = trafficConfigured && trafficData.trend.length > 0;
  const chartData = hasSearchTrend
    ? searchData.trend.map((row, index) => ({
      ...row,
      clicksPrior: searchData.priorTrend[index]?.clicks ?? null,
    }))
    : hasTrafficTrend
      ? trafficData.trend.map((row) => ({ ...row }))
      : [];
  const chartLines = hasSearchTrend
    ? SEARCH_ANNOTATION_LINES.map((line) => ({
      ...line,
      active: line.key !== 'clicksPrior' || searchData.priorTrend.length > 0,
    }))
    : TRAFFIC_ANNOTATION_LINES;

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

      <ChartCard
        title="Trend with context"
        action={<Badge label={`${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`} tone="blue" variant="soft" size="sm" />}
      >
        {chartData.length > 0 ? (
          <AnnotatedTrendChart
            data={chartData}
            lines={chartLines}
            annotations={annotations}
            height={300}
          />
        ) : (
          <EmptyState
            icon={Activity}
            title="No performance trend to annotate"
            description="The timeline remains editable below while Search Console and GA4 trend rows are unavailable."
          />
        )}
      </ChartCard>

      <ChartCard
        title="Annotation timeline"
        titleIcon={<Icon name="pencil" size="md" className="text-[var(--teal)]" aria-hidden="true" />}
        action={(
          <Button size="sm" variant={createOpen ? 'ghost' : 'primary'} onClick={() => setCreateOpen((open) => !open)}>
            <Icon name={createOpen ? 'x' : 'plus'} size="sm" aria-hidden="true" />
            {createOpen ? 'Close' : 'Add annotation'}
          </Button>
        )}
      >
        {createOpen && (
          <div className="mb-4 border-b border-[var(--brand-border)] pb-4">
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
                <Icon name="check" size="sm" aria-hidden="true" />
                Save annotation
              </Button>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Annotation category filters">
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
          <div className="divide-y divide-[var(--brand-border)] border-y border-[var(--brand-border)]">
            {visible.map((annotation) => {
              const meta = categoryMeta(annotation.category);
              const editing = editId === annotation.id;
              return (
                <div key={annotation.id} className="group relative py-3 pl-4">
                  <span className="absolute inset-y-3 left-0 w-0.5 rounded-[var(--radius-pill)]" style={{ backgroundColor: meta.color }} aria-hidden="true" />
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
      </ChartCard>
    </div>
  );
}
