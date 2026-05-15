import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { scoreColorClass, Icon, IconButton, ClickableRow } from '../ui';
import {
  intentColor,
  kdColor,
  positionColor,
} from './pageIntelligenceDisplay';
import { summarizeScoreTrend } from './pageIntelligenceData';
import type { ContentScore, KeywordData, KeywordEditDraft, SeoCopy } from './pageIntelligenceTypes';
import { PageIntelligencePageDetails } from './PageIntelligencePageDetails';

interface Props {
  page: UnifiedPage;
  isExpanded: boolean;
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

export function PageIntelligencePageRow({
  page,
  isExpanded,
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
  const strategy = page.strategy;
  const displayScore = analysis?.optimizationScore ?? strategy?.optimizationScore;
  const scoreTrend = summarizeScoreTrend(strategy?.optimizationScoreHistory);
  const trendIcon = scoreTrend?.direction === 'up'
    ? TrendingUp
    : scoreTrend?.direction === 'down'
      ? TrendingDown
      : Minus;
  const trendClass = scoreTrend?.direction === 'up'
    ? 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20'
    : scoreTrend?.direction === 'down'
      ? 'text-red-400/80 bg-red-500/8 border-red-500/20'
      : 'text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-[var(--brand-border-hover)]';

  return (
    <div className="border-b border-[var(--brand-border)]/50 last:border-b-0">
      <ClickableRow
        onClick={() => onToggleExpanded(page.id)}
        className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isAnalyzing ? (
            <Loader2 className="w-3.5 h-3.5 text-accent-brand animate-spin flex-shrink-0" />
          ) : isExpanded ? (
            <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
          ) : (
            <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="t-caption text-[var(--brand-text-bright)] truncate">{page.title}</span>
              {page.source === 'cms' && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-accent-info border border-blue-500/20 shrink-0" // arbitrary-text-ok
                >CMS</span>
              )}
            </div>
            <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono">{page.path}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {strategy?.searchIntent && (
            <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] border font-medium ${intentColor(strategy.searchIntent)}`}>
              {strategy.searchIntent}
            </span>
          )}
          {strategy?.primaryKeyword && (
            <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand bg-teal-500/10 px-1.5 py-0.5 rounded max-w-[200px]">
              <span className="truncate">{strategy.primaryKeyword}</span>
              <IconButton
                icon={trackedKeywords.has(strategy.primaryKeyword) ? Check : Plus}
                label={trackedKeywords.has(strategy.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                title={trackedKeywords.has(strategy.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                size="sm"
                variant="ghost"
                onClick={event => {
                  event.stopPropagation();
                  onTrackKeyword(strategy.primaryKeyword);
                }}
                className={`!h-auto !w-auto !p-0 flex-shrink-0 transition-colors ${trackedKeywords.has(strategy.primaryKeyword) ? 'text-accent-success' : 'text-accent-brand hover:text-accent-brand'}`}
              />
            </span>
          )}
          {strategy?.validated === false && (
            <span className="text-[10px] text-accent-warning bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20" title="Keyword not validated in SEMRush">{/* // arbitrary-text-ok */}
              Unvalidated
            </span>
          )}
          {strategy?.volume !== undefined && strategy.volume > 0 && (
            <span className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono">{strategy.volume.toLocaleString()}/mo</span>
          )}
          {strategy?.difficulty !== undefined && strategy.difficulty > 0 && (
            <span className={`t-caption-sm ${kdColor(strategy.difficulty)} bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono`}>KD {strategy.difficulty}%</span>
          )}
          {strategy?.currentPosition ? (
            <span className={`t-caption-sm ${positionColor(strategy.currentPosition)} font-mono font-medium bg-[var(--surface-3)] px-1.5 py-0.5 rounded`}>
              #{strategy.currentPosition.toFixed(0)}
            </span>
          ) : null}
          {displayScore !== undefined && (
            <span className={`t-caption font-bold tabular-nums ${scoreColorClass(displayScore)}`}>{displayScore}</span>
          )}
          {scoreTrend && (
            <span
              className={`inline-flex items-center gap-0.5 t-caption-sm px-1.5 py-0.5 rounded border tabular-nums ${trendClass}`}
              title={`Optimization score changed from ${scoreTrend.previous} to ${scoreTrend.current}`}
            >
              <Icon as={trendIcon} size="xs" />
              {scoreTrend.delta > 0 ? '+' : ''}{scoreTrend.delta}
            </span>
          )}
        </div>
      </ClickableRow>

      {isExpanded && (
        <PageIntelligencePageDetails
          page={page}
          isAnalyzing={isAnalyzing}
          analysis={analysis}
          contentScore={contentScore}
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
          onAnalyzePage={onAnalyzePage}
          onGenerateSeoCopy={onGenerateSeoCopy}
          onCopyText={onCopyText}
          onOpenSeoEditor={onOpenSeoEditor}
          onCreateBrief={onCreateBrief}
          onAddSchema={onAddSchema}
          onViewFullAnalysis={onViewFullAnalysis}
        />
      )}
    </div>
  );
}
