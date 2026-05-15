import { AlertCircle } from 'lucide-react';
import type { SeoSuggestionClient } from '../../api/seo';
import { PendingApprovals } from '../PendingApprovals';
import { Icon } from '../ui';
import { BulkOperations, type BulkOperationsProps } from './BulkOperations';
import { SeoSuggestionsPanel } from './SeoSuggestionsPanel';

interface SeoSuggestionsData {
  suggestions: SeoSuggestionClient[];
  counts: { pending: number; selected: number; total: number };
}

interface SeoEditorWorkflowPanelsProps {
  workspaceId?: string;
  showPendingApprovals?: boolean;
  approvalRefreshKey: number;
  onApprovalsRetracted: () => void;
  hasUnsaved: boolean;
  suggestionsData?: SeoSuggestionsData;
  onRefreshSuggestions: () => void;
  onSuggestionsApplied: () => void;
  bulkOperationsProps: BulkOperationsProps;
}

export function SeoEditorWorkflowPanels({
  workspaceId,
  showPendingApprovals = true,
  approvalRefreshKey,
  onApprovalsRetracted,
  hasUnsaved,
  suggestionsData,
  onRefreshSuggestions,
  onSuggestionsApplied,
  bulkOperationsProps,
}: SeoEditorWorkflowPanelsProps) {
  return (
    <>
      {workspaceId && showPendingApprovals && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          nameFilter="SEO"
          onRetracted={() => onApprovalsRetracted()}
        />
      )}

      {hasUnsaved && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/30 rounded-[var(--radius-lg)] t-caption-sm text-accent-warning">
          <Icon as={AlertCircle} size="md" /> You have unsaved changes. Save individual pages then publish to go live.
        </div>
      )}

      {workspaceId && suggestionsData && suggestionsData.suggestions.length > 0 && (
        <SeoSuggestionsPanel
          workspaceId={workspaceId}
          suggestions={suggestionsData.suggestions}
          counts={suggestionsData.counts}
          onRefresh={onRefreshSuggestions}
          onApplied={onSuggestionsApplied}
        />
      )}

      <BulkOperations {...bulkOperationsProps} />
    </>
  );
}
