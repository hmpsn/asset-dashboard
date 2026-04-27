/**
 * BulkPublishPanel — Bulk publishing progress UI with done/total counter.
 * Extracted from SchemaSuggester.tsx bulk publish rendering.
 */
import { Loader2, Upload, Send } from 'lucide-react';
import { Icon, Button } from '../ui';

export interface BulkPublishPanelProps {
  dataCount: number;
  unpublishedCount: number;
  bulkPublishing: boolean;
  bulkProgress: { done: number; total: number } | null;
  sendingToClient: boolean;
  sentToClient: boolean;
  loading: boolean;
  onPublishAll: () => void;
  onSendToClient: () => void;
}

export function BulkPublishPanel({
  unpublishedCount, bulkPublishing, bulkProgress,
  sendingToClient, sentToClient, loading,
  onPublishAll, onSendToClient,
}: BulkPublishPanelProps) {
  if (loading) return null;

  return (
    <>
      {unpublishedCount > 0 && (
        <Button
          onClick={onPublishAll}
          disabled={bulkPublishing}
          variant="primary"
          size="sm"
          icon={bulkPublishing ? Loader2 : Upload}
          loading={bulkPublishing}
        >
          {bulkPublishing
            ? `Publishing ${bulkProgress?.done}/${bulkProgress?.total}...`
            : `Publish All (${unpublishedCount})`}
        </Button>
      )}
      <button
        onClick={onSendToClient}
        disabled={sendingToClient || sentToClient}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon as={Send} size="sm" /> {sentToClient ? 'Sent to Client' : sendingToClient ? 'Sending...' : 'Send to Client'}
      </button>
    </>
  );
}
