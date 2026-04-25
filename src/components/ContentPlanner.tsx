import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Layers, FileText, Grid3X3, AlertTriangle } from 'lucide-react';
import { SectionCard, Badge, EmptyState, PageHeader, Icon } from './ui';
import { TemplateEditor, MatrixBuilder, MatrixGrid } from './matrix';
import { contentTemplates, contentMatrices } from '../api/content';
import type { ContentTemplate, ContentMatrix, MatrixCell } from './matrix';

type View =
  | { mode: 'list' }
  | { mode: 'template-editor'; templateId?: string }
  | { mode: 'matrix-builder' }
  | { mode: 'matrix-grid'; matrixId: string };

interface ContentPlannerProps {
  workspaceId: string;
}

export function ContentPlanner({ workspaceId }: ContentPlannerProps) {
  const [view, setView] = useState<View>({ mode: 'list' });
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [matrices, setMatrices] = useState<ContentMatrix[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tpls, mtxs] = await Promise.all([
        contentTemplates.list(workspaceId),
        contentMatrices.list(workspaceId),
      ]);
      setTemplates(tpls);
      setMatrices(mtxs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content planner data');
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadData(); }, [workspaceId, loadData]);

  // ── Template callbacks ──

  const handleTemplateSave = useCallback(async (template: ContentTemplate) => {
    try {
      if (template.id && templates.some(t => t.id === template.id)) {
        await contentTemplates.update(workspaceId, template.id, template);
      } else {
        await contentTemplates.create(workspaceId, template);
      }
      await loadData();
      setView({ mode: 'list' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    }
  }, [workspaceId, templates, loadData]);

  // ── Matrix callbacks ──

  const handleMatrixComplete = useCallback(async (matrix: ContentMatrix) => {
    try {
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
      setError(err instanceof Error ? err.message : 'Failed to create matrix');
    }
  }, [workspaceId, loadData]);

  const handleCellClick = useCallback((_c: MatrixCell) => {
    void _c; // Cell detail is handled internally by MatrixGrid's CellDetailPanel
  }, []);

  const handleBulkAction = useCallback(async (
    action: 'optimize' | 'generate_briefs' | 'generate_posts' | 'send_review' | 'export_csv' | 'export_docx',
    cellIds: string[],
  ) => {
    void cellIds;
    if (action === 'export_csv') {
      window.open(contentMatrices.exportMatricesCsv(workspaceId), '_blank');
    }
    // Other bulk actions will be wired to specific endpoints as they're implemented
  }, [workspaceId]);

  const handleCellUpdate = useCallback(async (cellId: string, updates: Partial<MatrixCell>) => {
    if (view.mode !== 'matrix-grid') return;
    try {
      const updated = await contentMatrices.updateCell(workspaceId, view.matrixId, cellId, updates);
      setMatrices(prev => prev.map(m => m.id === view.matrixId ? updated : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update cell');
    }
  }, [workspaceId, view]);

  // ── Render sub-views ──

  if (view.mode === 'template-editor') {
    return (
      <TemplateEditor
        workspaceId={workspaceId}
        templateId={view.templateId}
        onSave={handleTemplateSave}
        onCancel={() => setView({ mode: 'list' })}
      />
    );
  }

  if (view.mode === 'matrix-builder') {
    return (
      <MatrixBuilder
        workspaceId={workspaceId}
        templates={templates}
        onComplete={handleMatrixComplete}
        onCancel={() => setView({ mode: 'list' })}
      />
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
          action={<button onClick={() => setView({ mode: 'list' })} className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors">Back to List</button>}
        />
      );
    }
    return (
      <div className="space-y-2">
        <button onClick={() => setView({ mode: 'list' })} className="flex items-center gap-1 text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
          ← Back to Planner
        </button>
        <MatrixGrid
          workspaceId={workspaceId}
          matrix={matrix}
          onCellClick={handleCellClick}
          onBulkAction={handleBulkAction}
          onCellUpdate={handleCellUpdate}
        />
      </div>
    );
  }

  // ── List view (default) ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Icon as={Loader2} size="lg" className="animate-spin text-teal-400" />
        <span className="text-sm text-[var(--brand-text)]">Loading content planner…</span>
      </div>
    );
  }

  if (error && !templates.length && !matrices.length) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load planner"
        description={error}
        action={<button onClick={loadData} className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors">Retry</button>}
      />
    );
  }

  const hasData = templates.length > 0 || matrices.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Content Planner"
          subtitle="Create templates and build content matrices at scale"
          icon={<Icon as={Layers} size="lg" className="text-teal-400" />}
        />
        <EmptyState
          icon={Layers}
          title="No templates or matrices yet"
          description="Start by creating a content template that defines the structure for a type of page (blog, service, location, etc.). Then build matrices to generate dozens of planned pages from one template."
          action={
            <button
              onClick={() => setView({ mode: 'template-editor' })}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors font-medium"
            >
              <Icon as={Plus} size="md" />
              Create First Template
            </button>
          }
        />
      </div>
    );
  }

  const totalCells = matrices.reduce((sum, m) => sum + m.cells.length, 0);
  const publishedCells = matrices.reduce((sum, m) => sum + m.cells.filter(c => c.status === 'published').length, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Planner"
        subtitle={`${templates.length} template${templates.length !== 1 ? 's' : ''} · ${matrices.length} matri${matrices.length !== 1 ? 'ces' : 'x'} · ${totalCells} pages planned`}
        icon={<Icon as={Layers} size="lg" className="text-teal-400" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView({ mode: 'template-editor' })}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]/80 transition-colors"
            >
              <Icon as={FileText} size="sm" />
              New Template
            </button>
            {templates.length > 0 && (
              <button
                onClick={() => setView({ mode: 'matrix-builder' })}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors"
              >
                <Icon as={Grid3X3} size="sm" />
                Build Matrix
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/5 border border-red-500/15" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <Icon as={AlertTriangle} size="md" className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-red-400">{error}</span>
        </div>
      )}

      {/* Templates */}
      {templates.length > 0 && (
        <SectionCard
          title="Templates"
          titleIcon={<Icon as={FileText} size="md" className="text-teal-400" />}
          action={
            <button onClick={() => setView({ mode: 'template-editor' })} className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors">
              + New
            </button>
          }
        >
          <div className="space-y-2">
            {templates.map(t => {
              const matrixCount = matrices.filter(m => m.templateId === t.id).length;
              return (
                <button
                  key={t.id}
                  onClick={() => setView({ mode: 'template-editor', templateId: t.id })}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon as={FileText} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-[var(--brand-text-bright)] group-hover:text-white transition-colors truncate block">
                        {t.name}
                      </span>
                      <span className="t-micro text-[var(--brand-text-muted)]">
                        {t.pageType} · {t.sections?.length || 0} sections · {t.variables?.length || 0} variables
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {matrixCount > 0 && (
                      <Badge color="teal" label={`${matrixCount} matri${matrixCount !== 1 ? 'ces' : 'x'}`} />
                    )}
                    <Badge color="zinc" label={t.pageType} />
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Matrices */}
      {matrices.length > 0 && (
        <SectionCard
          title="Content Matrices"
          titleIcon={<Icon as={Grid3X3} size="md" className="text-teal-400" />}
          titleExtra={
            <span className="t-micro text-[var(--brand-text-muted)]">
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
                <button
                  key={m.id}
                  onClick={() => setView({ mode: 'matrix-grid', matrixId: m.id })}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon as={Grid3X3} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-[var(--brand-text-bright)] group-hover:text-white transition-colors truncate block">
                        {m.name}
                      </span>
                      <span className="t-micro text-[var(--brand-text-muted)]">
                        {template?.name || 'Unknown template'} · {m.cells.length} pages · {progress}% published
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-16 h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500/50 rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <Badge color={progress === 100 ? 'emerald' : progress > 0 ? 'amber' : 'zinc'} label={`${m.cells.length} pages`} />
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
