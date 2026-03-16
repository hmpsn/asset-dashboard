/**
 * BulkPublishPanel — Bulk publishing progress UI with done/total counter.
 * Extracted from SchemaSuggester.tsx bulk publish rendering.
 */
import { Loader2, Upload, Send } from 'lucide-react';

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
        <button
          onClick={onPublishAll}
          disabled={bulkPublishing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white"
        >
          {bulkPublishing ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Publishing {bulkProgress?.done}/{bulkProgress?.total}...</>
          ) : (
            <><Upload className="w-3 h-3" /> Publish All ({unpublishedCount})</>
          )}
        </button>
      )}
      <button
        onClick={onSendToClient}
        disabled={sendingToClient || sentToClient}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="w-3 h-3" /> {sentToClient ? 'Sent to Client' : sendingToClient ? 'Sending...' : 'Send to Client'}
      </button>
    </>
  );
}
