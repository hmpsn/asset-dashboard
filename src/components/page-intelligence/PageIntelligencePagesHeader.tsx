import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button, ClickableRow, ErrorState, Icon, NextStepsCard, ProgressIndicator } from '../ui';
import type { FixQueueItem } from './pageIntelligenceData';
import type { BulkProgress, SortBy, SortDir } from './pageIntelligenceTypes';

interface Props {
  pageCount: number;
  cmsCount: number;
  withStrategy: number;
  analyzedCount: number;
  analyzingCount: number;
  bulkProgress: BulkProgress | null;
  cancellableBulkJobId: string | null;
  analysisError: string | null;
  showNextSteps: boolean;
  fixQueue: FixQueueItem[];
  search: string;
  sortBy: SortBy;
  sortDir: SortDir;
  onAnalyzeRemaining: () => void;
  onAnalyzeAll: () => void;
  onCancelBulkJob: (jobId: string) => void;
  onDismissError: () => void;
  onDismissNextSteps: () => void;
  onGoToSeoEditor: () => void;
  onToggleFixQueuePage: (pageId: string) => void;
  onSearchChange: (search: string) => void;
  onSortChange: (sortBy: SortBy) => void;
}

export function PageIntelligencePagesHeader({
  pageCount,
  cmsCount,
  withStrategy,
  analyzedCount,
  analyzingCount,
  bulkProgress,
  cancellableBulkJobId,
  analysisError,
  showNextSteps,
  fixQueue,
  search,
  sortBy,
  sortDir,
  onAnalyzeRemaining,
  onAnalyzeAll,
  onCancelBulkJob,
  onDismissError,
  onDismissNextSteps,
  onGoToSeoEditor,
  onToggleFixQueuePage,
  onSearchChange,
  onSortChange,
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Page Intelligence</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            {pageCount} pages
            {cmsCount > 0 && <span className="text-accent-info"> · {cmsCount} CMS</span>}
            {withStrategy > 0 && <span> · {withStrategy} with strategy</span>}
            {analyzedCount > 0 && <span className="text-accent-brand"> · {analyzedCount} analyzed</span>}
          </p>
        </div>
        {bulkProgress ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-brand" />
            <span className="t-caption text-[var(--brand-text-bright)]">Analyzing {bulkProgress.done}/{bulkProgress.total}...</span>
            {cancellableBulkJobId && (
              <Button variant="ghost" size="sm" className="ml-2 text-accent-danger hover:text-accent-danger" onClick={() => onCancelBulkJob(cancellableBulkJobId)}>Cancel</Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {analyzedCount > 0 && analyzedCount < pageCount && (
              <Button
                variant="primary"
                size="sm"
                icon={Sparkles}
                onClick={onAnalyzeRemaining}
                disabled={analyzingCount > 0}
              >
                Analyze Remaining ({pageCount - analyzedCount})
              </Button>
            )}
            <Button
              variant={analyzedCount > 0 ? 'secondary' : 'primary'}
              size="sm"
              icon={Sparkles}
              onClick={onAnalyzeAll}
              disabled={analyzingCount > 0}
            >
              {analyzedCount > 0 ? 'Re-analyze All' : 'Analyze All Pages'}
            </Button>
          </div>
        )}
      </div>

      {bulkProgress && (
        <ProgressIndicator
          status="running"
          detail={`Analyzing ${bulkProgress.done}/${bulkProgress.total}...`}
          percent={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
          onCancel={cancellableBulkJobId ? () => onCancelBulkJob(cancellableBulkJobId) : undefined}
        />
      )}

      {analysisError && (
        <ErrorState
          type="general"
          title="Page Analysis Failed"
          message={analysisError}
          actions={[{ label: 'Dismiss', onClick: onDismissError, variant: 'secondary' }]}
        />
      )}

      {showNextSteps && !bulkProgress && (
        <NextStepsCard
          title="Analysis complete"
          variant="success"
          onDismiss={onDismissNextSteps}
          staggerIndex={0}
          steps={[
            {
              label: 'Go to SEO Editor',
              onClick: onGoToSeoEditor,
            },
          ]}
        />
      )}

      {fixQueue.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-[var(--radius-lg)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Icon as={Zap} size="md" className="text-accent-warning" />
            <span className="t-caption font-semibold text-accent-warning">Fix These First</span>
            <span className="t-micro text-[var(--brand-text-muted)] ml-auto">ranked by traffic × optimization gap</span>{/* // arbitrary-text-ok */}
          </div>
          <div className="space-y-1.5">
            {fixQueue.map((item, i) => (
              <ClickableRow
                key={item.page.id}
                onClick={() => onToggleFixQueuePage(item.page.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)]/50 transition-colors text-left"
              >
                <span className="t-micro font-mono text-[var(--brand-text-muted)] w-4">{i + 1}.</span>{/* // arbitrary-text-ok */}
                <span className="t-caption-sm text-[var(--brand-text-bright)] truncate flex-1">{item.page.title || item.page.path}</span>
                {item.impressions > 0 && (
                  <span
                    className="t-micro text-[var(--brand-text-muted)]" // arbitrary-text-ok
                  >{item.impressions.toLocaleString()} imp</span>
                )}
                <span className={`t-micro font-medium px-1.5 py-0.5 rounded ${ // arbitrary-text-ok
                  item.score < 40 ? 'text-accent-danger bg-red-500/10' :
                  item.score < 60 ? 'text-accent-warning bg-amber-500/10' :
                  'text-accent-warning bg-yellow-500/10'
                }`}>
                  {item.score}/100
                </span>
                <span className="t-micro text-accent-warning font-mono w-12 text-right">↑{item.impact}</span>{/* // arbitrary-text-ok */}
              </ClickableRow>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon as={SearchIcon} size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Search pages, keywords..."
            className="w-full pl-8 pr-3 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['priority', 'position', 'volume', 'score'] as const).map(option => (
            <Button
              key={option}
              onClick={() => onSortChange(option)}
              variant="secondary"
              size="sm"
              className={`px-2 py-1 rounded t-caption-sm font-medium transition-colors flex items-center gap-0.5 ${
                sortBy === option ? 'bg-teal-500/20 text-accent-brand border border-teal-500/30' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] hover:text-[var(--brand-text-bright)]'
              }`}
            >
              {option === 'priority' ? 'Priority' : option === 'score' ? 'Score' : option.charAt(0).toUpperCase() + option.slice(1)}
              {sortBy === option && (sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />)}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}
