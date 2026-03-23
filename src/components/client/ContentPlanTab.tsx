import { useState, useEffect, useCallback } from 'react';
import { Loader2, Layers, Grid3X3, AlertTriangle } from 'lucide-react';
import { SectionCard, Badge, EmptyState } from '../ui';
import { MatrixProgressView } from './MatrixProgressView';
import { contentPlanReview } from '../../api/content';
import type { ContentMatrix, MatrixCell } from '../matrix/types';

interface ContentPlanTabProps {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export function ContentPlanTab({ workspaceId, setToast }: ContentPlanTabProps) {
  const [plans, setPlans] = useState<ContentMatrix[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatrixId, setSelectedMatrixId] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contentPlanReview.getPlans(workspaceId);
      setPlans(data as ContentMatrix[]);
      // Auto-select if only one plan
      if (Array.isArray(data) && data.length === 1) {
        setSelectedMatrixId((data[0] as ContentMatrix).id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content plans');
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadPlans(); }, [workspaceId, loadPlans]);

  const handleCellPreview = useCallback((_cell: MatrixCell) => {
    void _cell; // Preview is handled internally by MatrixProgressView's modal
  }, []);

  const handleFlagCell = useCallback(async (cellId: string, comment: string) => {
    if (!selectedMatrixId) return;
    try {
      await contentPlanReview.flagCell(workspaceId, selectedMatrixId, cellId, comment);
      setToast({ message: 'Feedback submitted', type: 'success' });
      // Reload to get updated data
      const updated = await contentPlanReview.getPlan(workspaceId, selectedMatrixId);
      setPlans(prev => prev.map(p => p.id === selectedMatrixId ? updated as ContentMatrix : p));
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to submit feedback', type: 'error' });
    }
  }, [workspaceId, selectedMatrixId, setToast]);

  const handleDownload = useCallback((format: 'docx' | 'pdf') => {
    window.open(`/api/export/${workspaceId}/matrices?format=${format === 'docx' ? 'csv' : 'json'}`, '_blank');
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="text-sm text-zinc-400">Loading content plans…</span>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load content plans"
        description={error}
        action={<button onClick={loadPlans} className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors">Retry</button>}
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
          <button
            onClick={() => setSelectedMatrixId(null)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← All Content Plans
          </button>
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
        titleIcon={<Layers className="w-4 h-4 text-teal-400" />}
      >
        <div className="space-y-2">
          {plans.map(plan => {
            const total = plan.cells?.length || 0;
            const published = plan.cells?.filter(c => c.status === 'published').length || 0;
            const inReview = plan.cells?.filter(c => c.status === 'review').length || 0;
            const progress = total > 0 ? Math.round((published / total) * 100) : 0;

            return (
              <button
                key={plan.id}
                onClick={() => setSelectedMatrixId(plan.id)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Grid3X3 className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors truncate block">
                      {plan.name}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {total} pages · {progress}% complete
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {inReview > 0 && (
                    <Badge label={`${inReview} needs review`} color="blue" />
                  )}
                  <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500/50 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
