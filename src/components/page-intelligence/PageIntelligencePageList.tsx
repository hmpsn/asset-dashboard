import type { UnifiedPage } from '../../../shared/types/page-join';
import type { ContentScore, KeywordData, KeywordEditDraft, SeoCopy } from './pageIntelligenceTypes';
import { PageIntelligencePageRow } from './PageIntelligencePageRow';

interface Props {
  pages: UnifiedPage[];
  search: string;
  expandedPageId: string | null;
  analyzingPageIds: Set<string>;
  analyses: Record<string, KeywordData>;
  contentScores: Record<string, ContentScore>;
  editingPageId: string | null;
  editDraft: KeywordEditDraft;
  saving: boolean;
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  trackedKeywords: Set<string>;
  onToggleExpanded: (pageId: string) => void;
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

export function PageIntelligencePageList({
  pages,
  search,
  expandedPageId,
  analyzingPageIds,
  analyses,
  contentScores,
  editingPageId,
  editDraft,
  saving,
  seoCopyResults,
  generatingCopy,
  copiedField,
  trackedKeywords,
  onToggleExpanded,
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
  return (
    // pr-check-disable-next-line -- brand asymmetric signature on page list outer card; intentional non-SectionCard chrome
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
      {pages.map(page => (
        <PageIntelligencePageRow
          key={page.id}
          page={page}
          isExpanded={expandedPageId === page.id}
          isAnalyzing={analyzingPageIds.has(page.id)}
          analysis={analyses[page.id]}
          contentScore={contentScores[page.id]}
          isEditing={editingPageId === page.id}
          editDraft={editDraft}
          saving={saving}
          seoCopyResults={seoCopyResults}
          generatingCopy={generatingCopy}
          copiedField={copiedField}
          trackedKeywords={trackedKeywords}
          onToggleExpanded={onToggleExpanded}
          onTrackKeyword={onTrackKeyword}
          onStartEdit={onStartEdit}
          onEditDraftChange={onEditDraftChange}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
          onAnalyzePage={onAnalyzePage}
          onGenerateSeoCopy={onGenerateSeoCopy}
          onCopyText={onCopyText}
          onOpenSeoEditor={onOpenSeoEditor}
          onCreateBrief={onCreateBrief}
          onAddSchema={onAddSchema}
          onViewFullAnalysis={onViewFullAnalysis}
        />
      ))}

      {pages.length === 0 && (
        <div className="px-4 py-8 text-center t-body text-[var(--brand-text-muted)]">
          {search ? 'No pages match your search.' : 'No pages found.'}
        </div>
      )}
    </div>
  );
}
