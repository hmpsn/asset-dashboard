import {
  Loader2, Upload, Check, Wand2, RefreshCw,
} from 'lucide-react';
import { LoadingState, Icon } from '../ui';
import { ApprovalPanel } from './ApprovalPanel';

interface SeoEditorHeaderActionsProps {
  pagesCount: number;
  missingTitles: number;
  missingDescs: number;
  bulkFixing: boolean;
  bulkResults: string | null;
  workspaceId?: string;
  approvalSelected: Set<string>;
  sendingApproval: boolean;
  approvalSent: boolean;
  onSendApproval: () => Promise<void> | void;
  publishing: boolean;
  published: boolean;
  onRefreshPages: () => Promise<void> | void;
  onFixTitles: () => Promise<void> | void;
  onFixDescriptions: () => Promise<void> | void;
  onPublish: () => Promise<void> | void;
}

export function SeoEditorHeaderActions({
  pagesCount,
  missingTitles,
  missingDescs,
  bulkFixing,
  bulkResults,
  workspaceId,
  approvalSelected,
  sendingApproval,
  approvalSent,
  onSendApproval,
  publishing,
  published,
  onRefreshPages,
  onFixTitles,
  onFixDescriptions,
  onPublish,
}: SeoEditorHeaderActionsProps) {
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="t-caption-sm text-[var(--brand-text)]">
          <span className="font-medium text-[var(--brand-text-bright)]">{pagesCount}</span> pages
        </div>
        {missingTitles > 0 && (
          <span className="t-caption-sm px-2 py-0.5 rounded bg-amber-500/8 border border-amber-500/30 text-accent-warning">
            {missingTitles} missing SEO titles
          </span>
        )}
        {missingDescs > 0 && (
          <span className="t-caption-sm px-2 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-accent-danger">
            {missingDescs} missing meta descriptions
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onRefreshPages}
          className="p-1.5 rounded text-[var(--brand-text-muted)] hover:text-accent-brand hover:bg-[var(--surface-3)] transition-colors"
          title="Refresh pages from Webflow"
        >
          <Icon as={RefreshCw} size="md" />
        </button>
        <button
          onClick={onFixTitles}
          disabled={bulkFixing || missingTitles === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors"
        >
          <Icon as={Wand2} size="sm" /> AI Fix Titles ({missingTitles})
        </button>
        <button
          onClick={onFixDescriptions}
          disabled={bulkFixing || missingDescs === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors"
        >
          <Icon as={Wand2} size="sm" /> AI Fix Descriptions ({missingDescs})
        </button>
        {workspaceId && (
          <ApprovalPanel
            approvalSelected={approvalSelected}
            sendingApproval={sendingApproval}
            approvalSent={approvalSent}
            onSendApproval={onSendApproval}
          />
        )}
        <button
          onClick={onPublish}
          disabled={publishing}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors ${
            published
              ? 'bg-[var(--emerald)] text-white'
              : 'bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--surface-active)]'
          }`}
        >
          <Icon as={publishing ? Loader2 : published ? Check : Upload} size="sm" className={publishing ? 'animate-spin' : ''} />
          {published ? 'Published!' : publishing ? 'Publishing...' : 'Publish Site'}
        </button>
      </div>

      {bulkFixing && (
        <LoadingState
          message={`AI is generating content for ${missingTitles + missingDescs} pages...`}
          size="md"
          className="border border-teal-500/30"
        />
      )}
      {bulkResults && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/8 border border-emerald-500/30 rounded-[var(--radius-lg)] t-caption-sm text-accent-success">
          <Icon as={Check} size="md" /> {bulkResults}
        </div>
      )}
    </>
  );
}
