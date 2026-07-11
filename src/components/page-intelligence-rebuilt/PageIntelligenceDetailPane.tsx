// @ds-rebuilt
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo';
import { Button, Icon } from '../ui';
import { LocalSeoVisibilityBadge } from '../local-seo/LocalSeoVisibilityPanel';
import { PageIntelligenceAnalysisSection } from '../page-intelligence/PageIntelligenceAnalysisSection';
import { PageIntelligencePersistedAnalysisSummary } from '../page-intelligence/PageIntelligencePersistedAnalysisSummary';
import { PageIntelligenceStrategySection } from '../page-intelligence/PageIntelligenceStrategySection';
import type { ContentScore, KeywordData } from '../page-intelligence/pageIntelligenceTypes';
import type { usePageIntelligenceKeywordEditing } from '../page-intelligence/usePageIntelligenceKeywordEditing';
import type { usePageIntelligenceKeywordTracking } from '../page-intelligence/usePageIntelligenceKeywordTracking';
import type { usePageIntelligenceSeoCopy } from '../page-intelligence/usePageIntelligenceSeoCopy';

interface PageIntelligenceDetailPaneProps {
  page?: UnifiedPage;
  analysis?: KeywordData;
  contentScore?: ContentScore;
  isAnalyzing: boolean;
  editing: ReturnType<typeof usePageIntelligenceKeywordEditing>;
  tracking: ReturnType<typeof usePageIntelligenceKeywordTracking>;
  seoCopy: ReturnType<typeof usePageIntelligenceSeoCopy>;
  localSeoVisibility?: LocalSeoKeywordVisibilitySummary;
  onAnalyzePage: (page: UnifiedPage) => void;
  onOpenSeoEditor: (page: UnifiedPage) => void;
  onCreateBrief: (page: UnifiedPage, analysis?: KeywordData) => void;
  onAddSchema: (page: UnifiedPage) => void;
  onViewTraffic: () => void;
}

export function PageIntelligenceDetailPane({
  page,
  analysis,
  contentScore,
  isAnalyzing,
  editing,
  tracking,
  seoCopy,
  localSeoVisibility,
  onAnalyzePage,
  onOpenSeoEditor,
  onCreateBrief,
  onAddSchema,
  onViewTraffic,
}: PageIntelligenceDetailPaneProps) {
  if (!page) {
    return (
      <div className="flex min-h-0 items-center justify-center bg-[var(--surface-2)] px-10 text-center">
        <div className="max-w-sm">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-signature)] border border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]"><Icon name="search" size="xl" /></span>
          <h2 className="t-body font-semibold text-[var(--brand-text-bright)]">Select a page to research</h2>
          <p className="mt-1.5 t-caption text-[var(--brand-text-muted)]">Choose a target on the left to inspect keyword fit, content gaps, local visibility, and the next production move.</p>
        </div>
      </div>
    );
  }

  const hasSchemaIssue = analysis?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue))
    || page.strategy?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue));

  return (
    <article className="flex min-h-0 flex-col bg-[var(--surface-2)]">
      <header className="flex-none border-b border-[var(--brand-border)] px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]"><Icon name={page.source === 'cms' ? 'layers' : 'file'} size="sm" /></span>
              <div className="min-w-0">
                <h2 className="truncate t-body font-semibold text-[var(--brand-text-bright)]">{page.title}</h2>
                <p className="truncate t-micro font-mono text-[var(--brand-text-dim)]">{page.path}</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="block t-micro font-semibold uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">Target</span>
            <span className="block max-w-[240px] truncate t-caption font-medium text-[var(--brand-text)]">{page.strategy?.primaryKeyword || 'Not assigned'}</span>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <section className="rounded-[var(--radius-signature)] border border-[var(--brand-border)] bg-[var(--surface-1)]/40 p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--brand-border)] pb-3">
              <div>
                <h3 className="t-caption font-semibold text-[var(--brand-text-bright)]">Page intelligence</h3>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">Keyword evidence, gaps, recommendations, and where to take this page next.</p>
              </div>
              {page.strategy?.optimizationScore !== undefined && <span className="t-micro font-mono uppercase tracking-[0.06em] text-[var(--brand-text-muted)]">Score {page.strategy.optimizationScore}/100</span>}
            </div>
            <PageIntelligenceStrategySection
              page={page}
              isEditing={editing.editingPageId === page.id}
              editDraft={editing.editDraft}
              saving={editing.saving}
              seoCopyResults={seoCopy.seoCopyResults}
              generatingCopy={seoCopy.generatingCopy}
              copiedField={seoCopy.copiedField}
              trackedKeywords={tracking.trackedKeywords}
              onTrackKeyword={tracking.trackKeyword}
              onStartEdit={editing.startEdit}
              onEditDraftChange={editing.setEditDraft}
              onSaveEdit={editing.saveEdit}
              onCancelEdit={editing.cancelEdit}
              onGenerateSeoCopy={seoCopy.generateSeoCopy}
              onCopyText={seoCopy.copyText}
            />

            {localSeoVisibility && <div className="mt-3 flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--blue)] bg-[var(--blue-ghost)] px-3 py-2"><div><p className="t-caption font-semibold text-[var(--brand-text-bright)]">Local visibility · {localSeoVisibility.marketLabel}</p><p className="t-caption-sm text-[var(--brand-text-muted)]">{localSeoVisibility.detail}</p></div><LocalSeoVisibilityBadge visibility={localSeoVisibility} /></div>}

            {!page.strategy && !analysis && !isAnalyzing && <div className="py-8 text-center"><p className="mb-3 t-caption text-[var(--brand-text-muted)]">This page is not mapped to the keyword strategy yet.</p><Button variant="primary" size="sm" onClick={() => onAnalyzePage(page)}>Run AI analysis</Button></div>}
            {isAnalyzing && !analysis && <div className="flex items-center justify-center gap-2 py-8 t-caption text-[var(--brand-text-muted)]"><Icon name="refresh" size="sm" className="animate-spin text-accent-brand" />Running page analysis…</div>}
          </section>

          <PageIntelligenceAnalysisSection page={page} isAnalyzing={isAnalyzing} analysis={analysis} contentScore={contentScore} trackedKeywords={tracking.trackedKeywords} onTrackKeyword={tracking.trackKeyword} onAnalyzePage={onAnalyzePage} />
          {!analysis && !isAnalyzing && <PageIntelligencePersistedAnalysisSummary page={page} onAnalyzePage={onAnalyzePage} />}
        </div>
      </div>

      <footer className="flex flex-none items-center gap-2 border-t border-[var(--brand-border)] bg-[var(--surface-2)] px-5 py-3">
        <span className="mr-auto flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]"><Icon name="info" size="sm" />Actions open the owning production workspace.</span>
        <Button variant="secondary" size="sm" onClick={() => onCreateBrief(page, analysis)}>Create brief</Button>
        {hasSchemaIssue && <Button variant="secondary" size="sm" onClick={() => onAddSchema(page)}>Add schema</Button>}
        <Button variant="secondary" size="sm" onClick={onViewTraffic}>View traffic</Button>
        <Button variant="primary" size="sm" onClick={() => onOpenSeoEditor(page)}>Fix in SEO Editor</Button>
      </footer>
    </article>
  );
}
