import { AlertCircle } from 'lucide-react';
import { EmptyState, Icon } from '../ui';
import { PageEditRow } from './PageEditRow';
import type {
  SeoEditState,
  SeoEditorPage,
  SeoPageState,
  SeoRecommendation,
  SeoVariationSet,
} from './seoEditorTypes';

interface SeoEditorPageListProps {
  workspaceId?: string;
  showCmsOnly: boolean;
  filteredPages: SeoEditorPage[];
  expanded: Set<string>;
  saving: Set<string>;
  saved: Set<string>;
  aiLoading: Record<string, string | undefined>;
  draftSaving: Set<string>;
  draftSaved: Set<string>;
  approvalSelected: Set<string>;
  getPageRecommendations: (page: SeoEditorPage) => SeoRecommendation[];
  getPageState: (pageId: string) => SeoPageState | undefined;
  variations: Record<string, SeoVariationSet>;
  sendingPage: Set<string>;
  sentPage: Set<string>;
  onSendToClient: (pageId: string) => void;
  onToggleExpand: (pageId: string) => void;
  onToggleApprovalSelect: (pageId: string) => void;
  onUpdateField: (pageId: string, field: 'seoTitle' | 'seoDescription', value: string) => void;
  onSavePage: (pageId: string) => void;
  onSaveDraft: (pageId: string) => void;
  onAiRewrite: (pageId: string, field: 'title' | 'description' | 'both') => void;
  onSelectVariation: (pageId: string, field: 'seoTitle' | 'seoDescription', value: string) => void;
  onClearVariations: (pageId: string) => void;
  onClearTracking?: (pageId: string) => void;
  errorStates: Record<string, { type: string; message: string } | null>;
  previewExpanded: Set<string>;
  onTogglePreview: (pageId: string) => void;
  onAnalyzePage?: (pageId: string) => void;
  analyzedPages: Set<string>;
  analyzing: Set<string>;
  pageKeywordMap: Map<string, { primaryKeyword: string; secondaryKeywords: string[] }>;
  edits: Record<string, SeoEditState>;
}

export function SeoEditorPageList({
  workspaceId,
  showCmsOnly,
  filteredPages,
  expanded,
  saving,
  saved,
  aiLoading,
  draftSaving,
  draftSaved,
  approvalSelected,
  getPageRecommendations,
  getPageState,
  variations,
  sendingPage,
  sentPage,
  onSendToClient,
  onToggleExpand,
  onToggleApprovalSelect,
  onUpdateField,
  onSavePage,
  onSaveDraft,
  onAiRewrite,
  onSelectVariation,
  onClearVariations,
  onClearTracking,
  errorStates,
  previewExpanded,
  onTogglePreview,
  onAnalyzePage,
  analyzedPages,
  analyzing,
  pageKeywordMap,
  edits,
}: SeoEditorPageListProps) {
  return (
    <div className="space-y-2">
      {showCmsOnly && filteredPages.length === 0 && (
        <EmptyState
          icon={AlertCircle}
          title="No CMS pages found"
          description="No CMS collection pages were discovered via sitemap. Static pages are hidden while this filter is active."
        />
      )}
      {filteredPages.map(page => (
        <div key={page.id}>
          {page.source === 'cms' && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/8 border border-amber-500/20 rounded t-caption-sm text-accent-warning mb-1">
              <Icon as={AlertCircle} size="sm" />
              Manual apply required — CMS pages must be updated directly in Webflow
            </div>
          )}
          <PageEditRow
            page={page}
            edit={edits[page.id]}
            expanded={expanded.has(page.id)}
            isSaving={saving.has(page.id)}
            isSaved={saved.has(page.id)}
            isAiLoading={aiLoading[page.id]}
            isDraftSaving={draftSaving.has(page.id)}
            isDraftSaved={draftSaved.has(page.id)}
            isSelected={approvalSelected.has(page.id)}
            pageRecs={getPageRecommendations(page)}
            pageState={getPageState(page.id)}
            variations={variations[page.id]}
            showApprovalCheckbox={!!workspaceId}
            isSendingToClient={sendingPage.has(page.id)}
            isSentToClient={sentPage.has(page.id)}
            hasChanges={!!(
              edits[page.id]
              && ((edits[page.id].seoTitle ?? '') !== (page.seo?.title ?? '')
                || (edits[page.id].seoDescription ?? '') !== (page.seo?.description ?? ''))
            )}
            onSendToClient={onSendToClient}
            onToggleExpand={onToggleExpand}
            onToggleApprovalSelect={onToggleApprovalSelect}
            onUpdateField={onUpdateField}
            onSave={page.source === 'cms' ? undefined : onSavePage}
            isCmsPage={page.source === 'cms'}
            onSaveDraft={onSaveDraft}
            onAiRewrite={onAiRewrite}
            onSelectVariation={onSelectVariation}
            onClearVariations={onClearVariations}
            onClearTracking={onClearTracking}
            errorState={errorStates[page.id] || null}
            showPreview={previewExpanded.has(page.id)}
            onTogglePreview={onTogglePreview}
            onAnalyzePage={onAnalyzePage}
            hasAnalysis={analyzedPages.has(page.id)}
            isAnalyzing={analyzing.has(page.id)}
            primaryKeyword={pageKeywordMap.get(page.id)?.primaryKeyword}
            secondaryKeywords={pageKeywordMap.get(page.id)?.secondaryKeywords}
          />
        </div>
      ))}
    </div>
  );
}
