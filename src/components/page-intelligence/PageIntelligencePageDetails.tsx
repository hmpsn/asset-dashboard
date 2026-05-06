import { Loader2, Sparkles } from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { Button } from '../ui';
import type { ContentScore, KeywordData, KeywordEditDraft, SeoCopy } from './pageIntelligenceTypes';
import { PageIntelligenceAnalysisSection } from './PageIntelligenceAnalysisSection';
import { PageIntelligencePageActions } from './PageIntelligencePageActions';
import { PageIntelligencePersistedAnalysisSummary } from './PageIntelligencePersistedAnalysisSummary';
import { PageIntelligenceStrategySection } from './PageIntelligenceStrategySection';

interface Props {
  page: UnifiedPage;
  isAnalyzing: boolean;
  analysis?: KeywordData;
  contentScore?: ContentScore;
  isEditing: boolean;
  editDraft: KeywordEditDraft;
  saving: boolean;
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  trackedKeywords: Set<string>;
  onTrackKeyword: (keyword: string) => void;
  onStartEdit: (page: UnifiedPage) => void;
  onEditDraftChange: (draft: KeywordEditDraft) => void;
  onSaveEdit: (page: UnifiedPage) => void;
  onCancelEdit: () => void;
  onAnalyzePage: (page: UnifiedPage) => void;
  onGenerateSeoCopy: (page: UnifiedPage) => void;
  onCopyText: (text: string, label: string) => void;
  onOpenSeoEditor: (page: UnifiedPage) => void;
  onCreateBrief: (page: UnifiedPage, analysis?: KeywordData) => void;
  onAddSchema: (page: UnifiedPage) => void;
  onViewFullAnalysis: () => void;
}

export function PageIntelligencePageDetails({
  page,
  isAnalyzing,
  analysis,
  contentScore,
  isEditing,
  editDraft,
  saving,
  seoCopyResults,
  generatingCopy,
  copiedField,
  trackedKeywords,
  onTrackKeyword,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onAnalyzePage,
  onGenerateSeoCopy,
  onCopyText,
  onOpenSeoEditor,
  onCreateBrief,
  onAddSchema,
  onViewFullAnalysis,
}: Props) {
  const sp = page.strategy;
  const hasSchemaIssue =
    analysis?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue)) ||
    sp?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue));

  return (
    <div className="px-4 pb-4 pl-10 space-y-4">
      <PageIntelligenceStrategySection
        page={page}
        isEditing={isEditing}
        editDraft={editDraft}
        saving={saving}
        seoCopyResults={seoCopyResults}
        generatingCopy={generatingCopy}
        copiedField={copiedField}
        trackedKeywords={trackedKeywords}
        onTrackKeyword={onTrackKeyword}
        onStartEdit={onStartEdit}
        onEditDraftChange={onEditDraftChange}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onGenerateSeoCopy={onGenerateSeoCopy}
        onCopyText={onCopyText}
      />

      {!sp && !analysis && !isAnalyzing && (
        <div className="text-center py-4">
          <p className="t-caption text-[var(--brand-text-muted)] mb-2">This page isn't in your keyword strategy yet.</p>
          <Button variant="primary" size="sm" icon={Sparkles} onClick={() => onAnalyzePage(page)} className="mx-auto">
            Run AI Analysis
          </Button>
        </div>
      )}

      {isAnalyzing && !analysis && (
        <div className="flex items-center gap-2 py-6 justify-center text-[var(--brand-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="t-body">Running AI keyword analysis...</span>
        </div>
      )}

      <PageIntelligenceAnalysisSection
        page={page}
        isAnalyzing={isAnalyzing}
        analysis={analysis}
        contentScore={contentScore}
        trackedKeywords={trackedKeywords}
        onTrackKeyword={onTrackKeyword}
        onAnalyzePage={onAnalyzePage}
      />

      {!analysis && !isAnalyzing && (
        <PageIntelligencePersistedAnalysisSummary
          page={page}
          onAnalyzePage={onAnalyzePage}
        />
      )}

      <PageIntelligencePageActions
        page={page}
        analysis={analysis}
        hasSchemaIssue={!!hasSchemaIssue}
        onOpenSeoEditor={onOpenSeoEditor}
        onCreateBrief={onCreateBrief}
        onAddSchema={onAddSchema}
        onViewFullAnalysis={onViewFullAnalysis}
      />
    </div>
  );
}
