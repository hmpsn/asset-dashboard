/**
 * BulkPublishPanel — Bulk publishing progress UI with done/total counter.
 * Extracted from SchemaSuggester.tsx bulk publish rendering.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Send, Upload } from 'lucide-react';
import { FormTextarea, Icon, Button } from '../ui';
import type { WholeSiteSchemaGraphValidationResult } from '../../../shared/types/schema-validation';

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
  graphValidation?: WholeSiteSchemaGraphValidationResult | null;
  graphValidationLoading?: boolean;
}

export function BulkPublishPanel({
  unpublishedCount, bulkPublishing, bulkProgress,
  sendingToClient, sentToClient, loading,
  onPublishAll, onSendToClient,
  graphValidation, graphValidationLoading,
}: BulkPublishPanelProps) {
  const [note, setNote] = useState('');
  const graphErrors = graphValidation?.findings.filter(finding => finding.severity === 'error') ?? [];
  const graphWarnings = graphValidation?.findings.filter(finding => finding.severity === 'warning') ?? [];
  const blockBulkPublish = graphErrors.length > 0;

  if (loading) return null;

  return (
    <>
      {graphValidation && (
        <div className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-2.5 py-2 t-caption-sm ${
          graphValidation.status === 'errors'
            ? 'border-red-500/20 bg-red-500/8 text-red-300'
            : graphValidation.status === 'warnings'
              ? 'border-amber-500/20 bg-amber-500/8 text-amber-300'
              : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300'
        }`}>
          <Icon as={graphValidation.status === 'valid' ? CheckCircle2 : AlertTriangle} size="sm" className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">
              Site graph {graphValidation.status}
              {graphValidationLoading ? ' · refreshing' : ''}
            </div>
            <div className="text-[var(--brand-text-muted)]">
              {graphErrors.length > 0
                ? `${graphErrors.length} graph error${graphErrors.length === 1 ? '' : 's'} must be fixed before bulk publish.`
                : graphWarnings.length > 0
                  ? `${graphWarnings.length} warning${graphWarnings.length === 1 ? '' : 's'}. Individual and bulk publish remain available.`
                  : `${graphValidation.nodeCount} nodes · ${graphValidation.referenceCount} references checked.`}
            </div>
          </div>
        </div>
      )}
      {unpublishedCount > 0 && (
        <Button
          onClick={onPublishAll}
          disabled={bulkPublishing || blockBulkPublish}
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
      <Button
        type="button"
        onClick={() => onSendToClient(note.trim() || undefined)}
        disabled={sendingToClient || sentToClient}
        variant="secondary"
        size="sm"
        loading={sendingToClient}
        icon={sendingToClient ? undefined : Send}
        className="gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] t-caption text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sentToClient ? 'Sent to Client' : sendingToClient ? 'Sending...' : 'Send to Client'}
      </Button>
      {!sentToClient && (
        <FormTextarea
          value={note}
          onChange={setNote}
          disabled={sendingToClient}
          maxLength={2000}
          placeholder="Add a note for your client (optional)"
          rows={2}
          className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      )}
    </>
  );
}
