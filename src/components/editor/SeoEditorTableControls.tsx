import { Loader2, Sparkles } from 'lucide-react';
import { Icon, Button } from '../ui';

interface SeoEditorTableControlsProps {
  workspaceId?: string;
  bulkAnalyzeProgress: { done: number; total: number } | null;
  onCancelAnalyze: () => Promise<void> | void;
  onAnalyzeAllPages: () => Promise<void> | void;
  analyzeDisabled: boolean;
  analyzedPagesCount: number;
  totalPages: number;
  cmsPageCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  showSearch?: boolean;
}

export function SeoEditorTableControls({
  workspaceId,
  bulkAnalyzeProgress,
  onCancelAnalyze,
  onAnalyzeAllPages,
  analyzeDisabled,
  analyzedPagesCount,
  totalPages,
  cmsPageCount,
  search,
  onSearchChange,
  showSearch = true,
}: SeoEditorTableControlsProps) {
  return (
    <>
      {workspaceId && (
        <div className="flex items-center gap-3">
          {bulkAnalyzeProgress ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)]">
              <Icon as={Loader2} size="md" className="animate-spin text-accent-brand" />
              <span className="t-caption-sm text-[var(--brand-text-bright)]">
                Analyzing {bulkAnalyzeProgress.done}/{bulkAnalyzeProgress.total} pages...
              </span>
              <Button
                onClick={onCancelAnalyze}
                variant="link"
                size="sm"
                className="ml-2 !text-accent-danger no-underline"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={onAnalyzeAllPages}
              disabled={analyzeDisabled}
              icon={Sparkles}
              size="sm"
              variant="primary"
              className="rounded-[var(--radius-lg)] font-medium disabled:opacity-40"
            >
              {analyzedPagesCount === totalPages && totalPages > 0
                ? 'All Pages Analyzed'
                : analyzedPagesCount > 0
                  ? `Analyze Remaining (${totalPages - analyzedPagesCount})`
                  : 'Analyze All Pages'}
            </Button>
          )}
          {analyzedPagesCount > 0 && !bulkAnalyzeProgress && (
            <span className="t-caption-sm text-accent-success">
              {analyzedPagesCount}/{totalPages} pages have analysis on file
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {cmsPageCount > 0 && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {cmsPageCount} CMS items are managed in CMS Collections.
          </span>
        )}
      </div>

      {showSearch && (
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search pages..."
          className="w-full px-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      )}
    </>
  );
}
