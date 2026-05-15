import {
  Upload, Check, Wand2, RefreshCw,
} from 'lucide-react';
import { LoadingState, Icon, Button, IconButton } from '../ui';
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
        <IconButton
          onClick={onRefreshPages}
          icon={RefreshCw}
          label="Refresh pages from Webflow"
          size="sm"
          className="hover:text-accent-brand"
          title="Refresh pages from Webflow"
        />
        <Button
          onClick={onFixTitles}
          disabled={bulkFixing || missingTitles === 0}
          icon={Wand2}
          size="sm"
          variant="secondary"
          className="bg-teal-600 hover:bg-teal-500 border-0 text-white rounded-[var(--radius-lg)] font-medium"
        >
          AI Fix Titles ({missingTitles})
        </Button>
        <Button
          onClick={onFixDescriptions}
          disabled={bulkFixing || missingDescs === 0}
          icon={Wand2}
          size="sm"
          variant="secondary"
          className="bg-teal-600 hover:bg-teal-500 border-0 text-white rounded-[var(--radius-lg)] font-medium"
        >
          AI Fix Descriptions ({missingDescs})
        </Button>
        {workspaceId && (
          <ApprovalPanel
            approvalSelected={approvalSelected}
            sendingApproval={sendingApproval}
            approvalSent={approvalSent}
            onSendApproval={onSendApproval}
          />
        )}
        <Button
          onClick={onPublish}
          disabled={publishing}
          loading={publishing}
          icon={published ? Check : Upload}
          size="sm"
          variant="secondary"
          className={`rounded-[var(--radius-lg)] font-medium ${
            published
              ? 'bg-[var(--emerald)] text-white border-0 hover:bg-[var(--emerald)]/90'
              : 'bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--surface-active)]'
          }`}
        >
          {published ? 'Published!' : publishing ? 'Publishing...' : 'Publish Site'}
        </Button>
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
