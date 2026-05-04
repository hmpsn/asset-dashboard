import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Layers, Grid3X3, AlertTriangle } from 'lucide-react';
import { SectionCard, Badge, EmptyState, Icon, Button, ClickableRow } from '../ui';
import { MatrixProgressView } from './MatrixProgressView';
import { contentPlanReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import type { ContentMatrix, MatrixCell } from '../matrix/types';

interface ContentPlanTabProps {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export function ContentPlanTab({ workspaceId, setToast }: ContentPlanTabProps) {
  const queryClient = useQueryClient();
  const [selectedMatrixId, setSelectedMatrixId] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: queryKeys.client.contentPlan(workspaceId),
    queryFn: () => contentPlanReview.getPlans(workspaceId) as Promise<ContentMatrix[]>,
    enabled: !!workspaceId,
  });

  const plans = plansQuery.data ?? [];
  const loading = plansQuery.isLoading;
  const singlePlanId = plansQuery.data?.length === 1 ? plansQuery.data[0].id : null;
  const loadPlans = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.contentPlan(workspaceId) });
  }, [queryClient, workspaceId]);

  useEffect(() => {
    if (singlePlanId && !selectedMatrixId) {
      setSelectedMatrixId(singlePlanId);
    }
  }, [singlePlanId, selectedMatrixId]);

  const handleCellPreview = useCallback((_cell: MatrixCell) => {
    void _cell; // Preview is handled internally by MatrixProgressView's modal
  }, []);

  const handleFlagCell = useCallback(async (cellId: string, comment: string) => {
    if (!selectedMatrixId) return;
    try {
      await contentPlanReview.flagCell(workspaceId, selectedMatrixId, cellId, comment);
      setToast({ message: 'Feedback submitted', type: 'success' });
      const updated = await contentPlanReview.getPlan(workspaceId, selectedMatrixId);
      queryClient.setQueryData<ContentMatrix[]>(
        queryKeys.client.contentPlan(workspaceId),
        prev => (prev ?? []).map(p => p.id === selectedMatrixId ? updated as ContentMatrix : p),
      );
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to submit feedback', type: 'error' });
    }
  }, [workspaceId, selectedMatrixId, setToast, queryClient]);

  const handleDownload = useCallback((format: 'docx' | 'pdf') => {
    window.open(`/api/export/${workspaceId}/matrices?format=${format === 'docx' ? 'csv' : 'json'}`, '_blank');
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Icon as={Loader2} size="lg" className="animate-spin text-accent-brand" />
        <span className="t-body text-[var(--brand-text-muted)]">Loading content plans…</span>
      </div>
    );
  }

  if (plansQuery.error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load content plans"
        description={plansQuery.error instanceof Error ? plansQuery.error.message : 'Failed to load content plans'}
        action={<Button onClick={loadPlans} size="sm">Retry</Button>}
      />
    );
  }

  if (plans.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No content plans yet"
        description="Your team hasn't created any content plans for this site yet. Content plans will appear here once your strategist sets up a content matrix."
      />
    );
  }

  const selectedMatrix = selectedMatrixId ? plans.find(p => p.id === selectedMatrixId) : null;

  // Single matrix → show it directly
  if (selectedMatrix) {
    return (
      <div className="space-y-3">
        {plans.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMatrixId(null)}
          >
            ← All Content Plans
          </Button>
        )}
        <MatrixProgressView
          workspaceId={workspaceId}
          matrix={selectedMatrix}
          onCellPreview={handleCellPreview}
          onFlagCell={handleFlagCell}
          onDownload={handleDownload}
        />
      </div>
    );
  }

  // Multiple plans → show list
  return (
    <div className="space-y-4">
      <SectionCard
        title="Your Content Plans"
        titleIcon={<Icon as={Layers} size="md" className="text-accent-brand" />}
      >
        <div className="space-y-2">
          {plans.map(plan => {
            const total = plan.cells?.length || 0;
            const published = plan.cells?.filter(c => c.status === 'published').length || 0;
            const inReview = plan.cells?.filter(c => c.status === 'review').length || 0;
            const progress = total > 0 ? Math.round((published / total) * 100) : 0;

            return (
              <ClickableRow
                key={plan.id}
                onClick={() => setSelectedMatrixId(plan.id)}
                className="flex items-center justify-between px-4 py-3 rounded-[var(--radius-xl)] bg-[var(--surface-3)]/50 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon as={Grid3X3} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="t-body font-medium text-[var(--brand-text)] group-hover:text-[var(--brand-text-bright)] transition-colors truncate block">
                      {plan.name}
                    </span>
                    <span className="t-caption text-[var(--brand-text-muted)]">
                      {total} pages · {progress}% complete
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {inReview > 0 && (
                    <Badge label={`${inReview} needs review`} color="blue" />
                  )}
                  <div className="w-20 h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                    <div className="h-full bg-teal-500/50 rounded-[var(--radius-pill)] transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </ClickableRow>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
