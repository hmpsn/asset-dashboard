/**
 * BulkPublishPanel — Bulk publishing progress UI with done/total counter.
 * Extracted from SchemaSuggester.tsx bulk publish rendering.
 */
import { useState } from 'react';
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
  onSendToClient: (note?: string) => void;
}

export function BulkPublishPanel({
  unpublishedCount, bulkPublishing, bulkProgress,
  sendingToClient, sentToClient, loading,
  onPublishAll, onSendToClient,
}: BulkPublishPanelProps) {
  const [note, setNote] = useState('');

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
        onClick={() => onSendToClient(note.trim() || undefined)}
        disabled={sendingToClient || sentToClient}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon as={Send} size="sm" /> {sentToClient ? 'Sent to Client' : sendingToClient ? 'Sending...' : 'Send to Client'}
      </button>
      {!sentToClient && (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note for your client (optional)"
          rows={2}
          className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      )}
    </>
  );
}
