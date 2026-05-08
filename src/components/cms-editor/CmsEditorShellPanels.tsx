import {
  Loader2, Check, Search, Sparkles, Send,
} from 'lucide-react';
import { PendingApprovals } from '../PendingApprovals';
import { ErrorState, Icon } from '../ui';
import { StatusBadge } from '../ui/StatusBadge';
import type { PageEditSummary } from '../../hooks/usePageEditStates';
import type { CmsCollection } from './cmsEditorModel';

type BulkTargetField = 'name' | 'title' | 'description' | 'all';

interface ApprovalErrorState {
  type: 'validation' | 'network';
  message: string;
}

interface CmsEditorShellPanelsProps {
  collections: CmsCollection[];
  totalItems: number;
  dirtyCount: number;
  savedCount: number;
  approvalSelectedCount: number;
  sendingApproval: boolean;
  approvalSent: boolean;
  sendForApproval: () => void;
  bulkMode: 'idle' | 'rewriting';
  bulkProgress: { done: number; total: number };
  bulkResults: string | null;
  onBulkAiRewrite: (targetField: BulkTargetField) => void;
  approvalError: ApprovalErrorState | null;
  aiError: string | null;
  workspaceId?: string;
  approvalRefreshKey: number;
  onApprovalRetracted: () => void;
  summary: PageEditSummary;
  search: string;
  onSearchChange: (value: string) => void;
}

export function CmsEditorShellPanels({
  collections,
  totalItems,
  dirtyCount,
  savedCount,
  approvalSelectedCount,
  sendingApproval,
  approvalSent,
  sendForApproval,
  bulkMode,
  bulkProgress,
  bulkResults,
  onBulkAiRewrite,
  approvalError,
  aiError,
  workspaceId,
  approvalRefreshKey,
  onApprovalRetracted,
  summary,
  search,
  onSearchChange,
}: CmsEditorShellPanelsProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">CMS Collection SEO</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            Edit SEO-relevant fields on collection items &middot; {collections.length} collections &middot; {totalItems} items
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <span className="t-caption-sm text-amber-400/80 bg-amber-500/8 px-2 py-0.5 rounded">
              {dirtyCount} unsaved
            </span>
          )}
          {savedCount > 0 && (
            <span className="t-caption-sm text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
              {savedCount} saved (draft)
            </span>
          )}
          {approvalSelectedCount > 0 && bulkMode === 'idle' && (
            <div className="flex items-center gap-1.5">
              <span className="t-caption-sm text-[var(--brand-text-muted)] mr-1">AI Rewrite:</span>
              <button onClick={() => onBulkAiRewrite('name')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Names</button>
              <button onClick={() => onBulkAiRewrite('title')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Titles</button>
              <button onClick={() => onBulkAiRewrite('description')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-colors">Descriptions</button>
              <button onClick={() => onBulkAiRewrite('all')} className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 transition-colors">All SEO</button>
            </div>
          )}
          {bulkMode === 'rewriting' && (
            <div className="flex items-center gap-2 t-caption-sm text-teal-400">
              <Icon as={Loader2} size="sm" className="animate-spin" />
              Rewriting {bulkProgress.done}/{bulkProgress.total} items…
            </div>
          )}
          {workspaceId && (
            <button
              onClick={sendForApproval}
              disabled={sendingApproval || approvalSelectedCount === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium transition-colors ${
                approvalSent ? 'bg-emerald-600 text-white' : 'bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white'
              }`}
            >
              <Icon as={sendingApproval ? Loader2 : approvalSent ? Check : Send} size="sm" className={sendingApproval ? 'animate-spin' : ''} />
              {approvalSent ? 'Sent!' : sendingApproval ? 'Sending...' : `Send for Approval (${approvalSelectedCount})`}
            </button>
          )}
        </div>
      </div>

      {bulkResults && (
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)] px-3 py-2 text-xs text-teal-300 flex items-center gap-2">
          <Icon as={Sparkles} size="md" className="flex-shrink-0" />
          {bulkResults}
        </div>
      )}

      {approvalError && (
        <ErrorState
          type={approvalError.type === 'network' ? 'network' : 'data'}
          title={approvalError.type === 'network' ? 'Connection Error' : 'Validation Error'}
          message={approvalError.message}
        />
      )}
      {aiError && (
        <ErrorState
          type="data"
          title="AI Rewrite Error"
          message={aiError}
        />
      )}

      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          onRetracted={onApprovalRetracted}
        />
      )}

      {summary.total > 0 && (
        <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
          <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-teal-400">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-blue-400">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-emerald-400/80">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-red-400/80">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-amber-400/80">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-blue-400">{summary.fixProposed}</span></>}
        </div>
      )}

      <div className="relative">
        <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Search items..."
          className="w-full pl-9 pr-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      </div>
    </>
  );
}
