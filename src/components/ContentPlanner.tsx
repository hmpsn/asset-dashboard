import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Layers, FileText, Grid3X3, AlertTriangle } from 'lucide-react';
import {
  SectionCard,
  Badge,
  EmptyState,
  PageHeader,
  Icon,
  Button,
  ClickableRow,
  ConfirmDialog,
  InlineBanner,
  ProgressIndicator,
} from './ui';
import { TemplateEditor, MatrixBuilder, MatrixGrid, MatrixGenerationStatus } from './matrix';
import { contentTemplates, contentMatrices } from '../api/content';
import { extractErrorMessage } from '../lib/extractErrorMessage';
import { queryKeys } from '../lib/queryKeys';
import { useMatrixGeneration } from '../hooks/admin/useMatrixGeneration';
import { useWorkspaceFeatureFlags } from '../hooks/admin/useWorkspaceFeatureFlags';
import { adminPath } from '../routes';
import type { ContentTemplate, ContentMatrix, MatrixCell } from './matrix';
import type {
  MatrixGenerationCostEstimate,
  MatrixGenerationItemRead,
  StartMatrixGenerationSelection,
} from '../../shared/types/matrix-generation';

type View =
  | { mode: 'list' }
  | { mode: 'template-editor'; templateId?: string }
  | { mode: 'matrix-builder' }
  | { mode: 'matrix-grid'; matrixId: string };

interface ContentPlannerProps {
  workspaceId: string;
  embedded?: boolean;
}

interface PendingMatrixGeneration {
  selections: StartMatrixGenerationSelection[];
  estimate: MatrixGenerationCostEstimate;
  idempotencyKey: string;
}

interface PendingMatrixApproval {
  item: MatrixGenerationItemRead;
  expectedRunRevision: number;
}

export function ContentPlanner({ workspaceId, embedded = false }: ContentPlannerProps) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const linkedMatrixId = searchParams.get('matrix') ?? '';
  const linkedRunId = searchParams.get('run');
  const [view, setView] = useState<View>(() => (
    linkedMatrixId ? { mode: 'matrix-grid', matrixId: linkedMatrixId } : { mode: 'list' }
  ));
  const [error, setError] = useState<string | null>(null);
  const [generationBlocker, setGenerationBlocker] = useState<string | null>(null);
  const [pendingGeneration, setPendingGeneration] = useState<PendingMatrixGeneration | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingMatrixApproval | null>(null);
  const workspaceFlags = useWorkspaceFeatureFlags(workspaceId);
  const matrixGenerationEnabled = workspaceFlags.data
    ?.find(flag => flag.key === 'content-matrix-generation')?.enabled ?? false;
  const activeMatrixId = view.mode === 'matrix-grid' ? view.matrixId : '';
  const matrixGeneration = useMatrixGeneration(
    workspaceId,
    activeMatrixId,
    activeMatrixId === linkedMatrixId ? linkedRunId : null,
  );

  const templatesQuery = useQuery({
    queryKey: queryKeys.admin.contentTemplates(workspaceId),
    queryFn: () => contentTemplates.list(workspaceId),
    enabled: !!workspaceId,
  });

  const matricesQuery = useQuery({
    queryKey: queryKeys.admin.contentMatrices(workspaceId),
    queryFn: () => contentMatrices.list(workspaceId),
    enabled: !!workspaceId,
  });

  const templates = templatesQuery.data ?? [];
  const matrices = matricesQuery.data ?? [];
  const loading = templatesQuery.isLoading || matricesQuery.isLoading;
  const queryError = templatesQuery.error || matricesQuery.error;
  const loadData = useCallback(async () => {
    setError(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentTemplates(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentMatrices(workspaceId) }),
    ]);
  }, [queryClient, workspaceId]);

  // ── Template callbacks ──

  const handleTemplateSave = useCallback(async (template: ContentTemplate) => {
    try {
      setError(null);
      if (view.mode === 'template-editor' && view.templateId) {
        await contentTemplates.update(workspaceId, view.templateId, template);
      } else {
        await contentTemplates.create(workspaceId, template);
      }
      await loadData();
      setView({ mode: 'list' });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save template'));
    }
  }, [workspaceId, view, loadData]);

  // ── Matrix callbacks ──

  const handleMatrixComplete = useCallback(async (matrix: ContentMatrix) => {
    try {
      setError(null);
      await contentMatrices.create(workspaceId, {
        name: matrix.name,
        templateId: matrix.templateId,
        dimensions: matrix.dimensions,
        urlPattern: matrix.urlPattern,
        keywordPattern: matrix.keywordPattern,
      });
      await loadData();
      setView({ mode: 'list' });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create matrix'));
    }
  }, [workspaceId, loadData]);

  const handleCellClick = useCallback((_c: MatrixCell) => {
    void _c; // Cell detail is handled internally by MatrixGrid's CellDetailPanel
  }, []);

  const handleBulkAction = useCallback(async (
    action: 'optimize' | 'generate_briefs' | 'generate_posts' | 'send_review' | 'export_csv' | 'export_docx',
    cellIds: string[],
  ) => {
    if (action === 'generate_briefs') {
      if (!matrixGenerationEnabled || view.mode !== 'matrix-grid') return;
      if (matrixGeneration.preview.isPending || matrixGeneration.start.isPending) return;
      const matrix = matrices.find(item => item.id === view.matrixId);
      const template = matrix
        ? templates.find(item => item.id === matrix.templateId)
        : undefined;
      if (!matrix || !template) {
        setError('The matrix template is unavailable. Refresh the planner and try again.');
        return;
      }
      const selectedCells = cellIds.flatMap(cellId => {
        const cell = matrix.cells.find(item => item.id === cellId);
        return cell ? [cell] : [];
      });
      if (selectedCells.length !== cellIds.length) {
        setError('One or more selected pages changed. Refresh the planner and try again.');
        return;
      }
      try {
        setError(null);
        setGenerationBlocker(null);
        const preview = await matrixGeneration.preview.mutateAsync(selectedCells.map(cell => ({
          cellId: cell.id,
          expectedSourceRevision: {
            matrixRevision: matrix.revision ?? 0,
            templateRevision: template.revision ?? 0,
            cellRevision: cell.revision ?? 0,
          },
        })));
        const readyResults = preview.results.flatMap(result => (
          result.status === 'ready' ? [result] : []
        ));
        if (!preview.estimatedBatchBudget || readyResults.length !== selectedCells.length) {
          const firstProblem = preview.results.find(result => result.status !== 'ready');
          if (firstProblem?.status === 'upgrade_required') {
            setGenerationBlocker('This template needs its generation structure approved before pages can be generated.');
          } else if (firstProblem?.status === 'blocked') {
            const requirement = firstProblem.evidenceRequirements.find(item => (
              firstProblem.blockingRequirementIds.includes(item.id)
            ));
            setGenerationBlocker(
              requirement?.clientSafePrompt
                ?? requirement?.reason
                ?? 'At least one selected page needs grounded source information before generation can start.',
            );
          } else {
            setGenerationBlocker('At least one selected page is not ready to generate.');
          }
          setPendingGeneration(null);
          return;
        }
        setPendingGeneration({
          selections: readyResults.map(result => ({
            cellId: result.cellId,
            expectedSourceRevision: result.sourceRevision,
            expectedPreviewFingerprint: result.target.effectiveInputFingerprint,
          })),
          estimate: preview.estimatedBatchBudget,
          idempotencyKey: crypto.randomUUID(),
        });
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to preview selected pages'));
      }
      return;
    }
    if (action === 'export_csv') {
      window.open(contentMatrices.exportMatricesCsv(workspaceId), '_blank');
      return;
    }
    if (action === 'send_review') {
      if (view.mode !== 'matrix-grid') return;
      try {
        setError(null);
        await contentMatrices.sendSamples(workspaceId, view.matrixId, cellIds);
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentMatrices(workspaceId) });
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to send selected pages for review'));
      }
    }
    // Remaining bulk actions will be wired to specific endpoints as they're implemented.
  }, [
    workspaceId,
    view,
    queryClient,
    matrixGenerationEnabled,
    matrixGeneration.preview,
    matrixGeneration.start.isPending,
    matrices,
    templates,
  ]);

  const handleConfirmGeneration = useCallback(async () => {
    if (!pendingGeneration) return;
    const request = pendingGeneration;
    setPendingGeneration(null);
    try {
      setError(null);
      await matrixGeneration.start.mutateAsync({
        selections: request.selections,
        acceptedBudget: {
          maxProviderCalls: request.estimate.providerCalls,
          maxInputTokens: request.estimate.inputTokens,
          maxOutputTokens: request.estimate.outputTokens,
          maxEstimatedUsd: request.estimate.estimatedUsd,
          maxConcurrency: request.estimate.maxConcurrency,
        },
        idempotencyKey: request.idempotencyKey,
      });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to start matrix generation'));
    }
  }, [matrixGeneration.start, pendingGeneration]);

  const handleRetryGeneration = useCallback(async (
    items: MatrixGenerationItemRead[],
  ) => {
    const run = matrixGeneration.run.data?.run;
    if (!run) return;
    try {
      setError(null);
      await matrixGeneration.retry.mutateAsync({
        expectedRunRevision: run.revision,
        items: items.map(item => ({
          itemId: item.id,
          expectedItemRevision: item.revision,
          sourceRevision: item.sourceRevision,
          expectedArtifactRevisions: item.currentArtifactRevisions,
          reusableCheckpointFingerprint: item.reusableCheckpointFingerprint,
        })),
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to retry selected pages'));
    }
  }, [matrixGeneration.retry, matrixGeneration.run.data?.run]);

  const handleReviewGeneratedPage = useCallback((item: MatrixGenerationItemRead) => {
    if (!item.postId) return;
    const url = `${adminPath(workspaceId, 'content-pipeline')}?tab=posts&post=${encodeURIComponent(item.postId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [workspaceId]);

  const handleApproveGeneratedPage = useCallback((item: MatrixGenerationItemRead) => {
    const run = matrixGeneration.run.data?.run;
    if (!run) return;
    setPendingApproval({ item, expectedRunRevision: run.revision });
  }, [matrixGeneration.run.data?.run]);

  const handleConfirmApproval = useCallback(async () => {
    if (!pendingApproval) return;
    const request = pendingApproval;
    setPendingApproval(null);
    try {
      setError(null);
      await matrixGeneration.approve.mutateAsync({
        itemId: request.item.id,
        expectedRunRevision: request.expectedRunRevision,
        expectedItemRevision: request.item.revision,
        expectedPostRevision: request.item.currentArtifactRevisions.post.generationRevision,
      });
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to approve this page'));
    }
  }, [matrixGeneration.approve, pendingApproval]);

  const handleCellUpdate = useCallback(async (cellId: string, updates: Partial<MatrixCell>) => {
    if (view.mode !== 'matrix-grid') return;
    try {
      setError(null);
      const currentCell = matrices
        .find(matrix => matrix.id === view.matrixId)
        ?.cells.find(cell => cell.id === cellId);
      if (!currentCell) {
        setError('This page changed or was removed. Refresh the planner and try again.');
        return;
      }
      const updated = await contentMatrices.updateCell(workspaceId, view.matrixId, cellId, {
        ...updates,
        expectedCellRevision: currentCell.revision ?? 0,
      });
      queryClient.setQueryData<ContentMatrix[]>(
        queryKeys.admin.contentMatrices(workspaceId),
        prev => (prev ?? []).map(m => m.id === view.matrixId ? updated : m),
      );
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update cell'));
    }
  }, [workspaceId, view, matrices, queryClient]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Icon as={Loader2} size="lg" className="animate-spin text-accent-brand" />
        <span className="t-caption-sm text-[var(--brand-text)]">Loading content planner…</span>
      </div>
    );
  }

  // ── Render sub-views ──

  if (view.mode === 'template-editor') {
    return (
      <div className="space-y-3">
        {error && <InlineBanner>{error}</InlineBanner>}
        <TemplateEditor
          workspaceId={workspaceId}
          templateId={view.templateId}
          template={templates.find(item => item.id === view.templateId)}
          onSave={handleTemplateSave}
          onCancel={() => setView({ mode: 'list' })}
        />
      </div>
    );
  }

  if (view.mode === 'matrix-builder') {
    return (
      <div className="space-y-3">
        {error && <InlineBanner>{error}</InlineBanner>}
        <MatrixBuilder
          workspaceId={workspaceId}
          templates={templates}
          onComplete={handleMatrixComplete}
          onCancel={() => setView({ mode: 'list' })}
        />
      </div>
    );
  }

  if (view.mode === 'matrix-grid') {
    const matrix = matrices.find(m => m.id === view.matrixId);
    if (!matrix) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Matrix not found"
          description="This content matrix may have been deleted."
          action={(
            <Button
              onClick={() => setView({ mode: 'list' })}
              size="sm"
              variant="secondary"
              className="rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 border-0"
            >
              Back to List
            </Button>
          )}
        />
      );
    }
    return (
      <div className="space-y-2">
        <Button
          onClick={() => {
            setView({ mode: 'list' });
            setGenerationBlocker(null);
            setPendingGeneration(null);
          }}
          size="sm"
          variant="ghost"
          className="h-auto px-0 py-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-transparent"
        >
          ← Back to Planner
        </Button>
        {error && <InlineBanner>{error}</InlineBanner>}
        {generationBlocker && (
          <InlineBanner
            tone="warning"
            title="Generation needs input"
            message={generationBlocker}
            onDismiss={() => setGenerationBlocker(null)}
          />
        )}
        {(matrixGeneration.preview.isPending || matrixGeneration.start.isPending || matrixGeneration.run.isLoading) && (
          <ProgressIndicator
            status="running"
            step={matrixGeneration.preview.isPending
              ? 'Checking selected pages'
              : matrixGeneration.start.isPending
                ? 'Starting matrix generation'
                : 'Loading generation status'}
            detail="No paid generation starts until the previewed budget is confirmed."
          />
        )}
        {matrixGeneration.run.isError && (
          <InlineBanner
            title="Generation status unavailable"
            message={extractErrorMessage(matrixGeneration.run.error, 'Refresh the planner and try again.')}
          />
        )}
        {matrixGeneration.run.data && (
          <MatrixGenerationStatus
            result={matrixGeneration.run.data}
            retrying={matrixGeneration.retry.isPending}
            onRetry={handleRetryGeneration}
            approvingItemId={matrixGeneration.approve.isPending
              ? matrixGeneration.approve.variables?.itemId ?? null
              : null}
            onReview={handleReviewGeneratedPage}
            onApprove={handleApproveGeneratedPage}
          />
        )}
        <MatrixGrid
          workspaceId={workspaceId}
          matrix={matrix}
          generationEnabled={matrixGenerationEnabled}
          generationBusy={matrixGeneration.preview.isPending || matrixGeneration.start.isPending}
          onCellClick={handleCellClick}
          onBulkAction={handleBulkAction}
          onCellUpdate={handleCellUpdate}
        />
        <ConfirmDialog
          open={Boolean(pendingGeneration)}
          title="Generate selected pages?"
          message={pendingGeneration
            ? `Generate ${pendingGeneration.selections.length} ${pendingGeneration.selections.length === 1 ? 'page' : 'pages'} using up to ${pendingGeneration.estimate.providerCalls} provider calls, ${pendingGeneration.estimate.inputTokens.toLocaleString()} input tokens, ${pendingGeneration.estimate.outputTokens.toLocaleString()} output tokens, and an estimated $${pendingGeneration.estimate.estimatedUsd.toFixed(2)}. Pages remain drafts and are never sent or published automatically.`
            : ''}
          confirmLabel={pendingGeneration
            ? `Generate ${pendingGeneration.selections.length} ${pendingGeneration.selections.length === 1 ? 'page' : 'pages'}`
            : 'Generate pages'}
          onConfirm={() => { void handleConfirmGeneration(); }}
          onCancel={() => setPendingGeneration(null)}
        />
        <ConfirmDialog
          open={Boolean(pendingApproval)}
          title="Approve this page for export?"
          message={pendingApproval
            ? `Approve “${pendingApproval.item.target?.targetKeyword ?? pendingApproval.item.cellId}” after review. This records human approval and marks the page ready for export. It does not send or publish the page.`
            : ''}
          confirmLabel="Approve for export"
          onConfirm={() => { void handleConfirmApproval(); }}
          onCancel={() => setPendingApproval(null)}
        />
      </div>
    );
  }

  // ── List view (default) ──

  if ((error || queryError) && !templates.length && !matrices.length) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load planner"
        description={error || (queryError instanceof Error ? queryError.message : 'Failed to load content planner data')}
        action={(
          <Button
            onClick={loadData}
            size="sm"
            variant="secondary"
            className="rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 border-0"
          >
            Retry
          </Button>
        )}
      />
    );
  }

  const hasData = templates.length > 0 || matrices.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-4">
        {!embedded && (
          <PageHeader
            title="Content Planner"
            subtitle="Create templates and build content matrices at scale"
            icon={<Icon as={Layers} size="lg" className="text-accent-brand" />}
          />
        )}
        <EmptyState
          icon={Layers}
          title="No templates or matrices yet"
          description="Start by creating a content template that defines the structure for a type of page (blog, service, location, etc.). Then build matrices to generate dozens of planned pages from one template."
          action={
            <Button
              onClick={() => setView({ mode: 'template-editor' })}
              icon={Plus}
              size="md"
              variant="secondary"
              className="rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 border-0 font-medium"
            >
              Create First Template
            </Button>
          }
        />
      </div>
    );
  }

  const totalCells = matrices.reduce((sum, m) => sum + m.cells.length, 0);
  const publishedCells = matrices.reduce((sum, m) => sum + m.cells.filter(c => c.status === 'published').length, 0);
  const plannerActions = (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => setView({ mode: 'template-editor' })}
        icon={FileText}
        size="sm"
        variant="secondary"
        className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--brand-border-hover)]"
      >
        New Template
      </Button>
      {templates.length > 0 && (
        <Button
          onClick={() => setView({ mode: 'matrix-builder' })}
          icon={Grid3X3}
          size="sm"
          variant="secondary"
          className="rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/15 border-0"
        >
          Build Matrix
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      {!embedded ? (
        <PageHeader
          title="Content Planner"
          subtitle={`${templates.length} template${templates.length !== 1 ? 's' : ''} · ${matrices.length} matri${matrices.length !== 1 ? 'ces' : 'x'} · ${totalCells} pages planned`}
          icon={<Icon as={Layers} size="lg" className="text-accent-brand" />}
          actions={plannerActions}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Content planner controls">
          {plannerActions}
        </div>
      )}

      {error && (
        <InlineBanner>{error}</InlineBanner>
      )}

      {/* Templates */}
      {templates.length > 0 && (
        <SectionCard
          title="Templates"
          titleIcon={<Icon as={FileText} size="md" className="text-accent-brand" />}
          action={
            <Button
              onClick={() => setView({ mode: 'template-editor' })}
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 text-accent-brand hover:text-accent-brand hover:bg-transparent"
            >
              + New
            </Button>
          }
        >
          <div className="space-y-2">
            {templates.map(t => {
              const matrixCount = matrices.filter(m => m.templateId === t.id).length;
              return (
                <ClickableRow
                  key={t.id}
                  onClick={() => setView({ mode: 'template-editor', templateId: t.id })}
                  className="group flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon as={FileText} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="t-caption-sm font-medium text-[var(--brand-text-bright)] group-hover:text-white transition-colors truncate block">
                        {t.name}
                      </span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        {t.pageType} · {t.sections?.length || 0} sections · {t.variables?.length || 0} variables
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {matrixCount > 0 && (
                      <Badge tone="teal" label={`${matrixCount} matri${matrixCount !== 1 ? 'ces' : 'x'}`} />
                    )}
                    <Badge tone="zinc" label={t.pageType} />
                  </div>
                </ClickableRow>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Matrices */}
      {matrices.length > 0 && (
        <SectionCard
          title="Content Matrices"
          titleIcon={<Icon as={Grid3X3} size="md" className="text-accent-brand" />}
          titleExtra={
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {publishedCells}/{totalCells} published
            </span>
          }
        >
          <div className="space-y-2">
            {matrices.map(m => {
              const template = templates.find(t => t.id === m.templateId);
              const progress = m.cells.length > 0
                ? Math.round((m.cells.filter(c => c.status === 'published').length / m.cells.length) * 100)
                : 0;
              return (
                <ClickableRow
                  key={m.id}
                  onClick={() => setView({ mode: 'matrix-grid', matrixId: m.id })}
                  className="group flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon as={Grid3X3} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="t-caption-sm font-medium text-[var(--brand-text-bright)] group-hover:text-white transition-colors truncate block">
                        {m.name}
                      </span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        {template?.name || 'Unknown template'} · {m.cells.length} pages · {progress}% published
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-16 h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                      <div className="h-full bg-teal-500/50 rounded-[var(--radius-pill)] transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <Badge tone={progress === 100 ? 'emerald' : progress > 0 ? 'amber' : 'zinc'} label={`${m.cells.length} pages`} />
                  </div>
                </ClickableRow>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
