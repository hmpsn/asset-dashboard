import { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  Loader2,
  Play,
  CheckSquare,
  Square,
  InboxIcon,
} from 'lucide-react';
import {
  useStartBatch,
  useBatchJob,
  useCopyStatus,
} from '../../hooks/admin/useCopyPipeline';
import { SectionCard, Badge, SectionCardSkeleton, EmptyState, Icon, Button, ClickableRow, cn, FormInput } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import { PAGE_TYPE_LABELS } from '../../lib/pageTypeLabels';
import type { BatchMode, BatchJob } from '../../../shared/types/copy-pipeline';
import type { BlueprintEntry } from '../../../shared/types/page-strategy';
import { COPY_STATUS_BADGE } from '../../lib/copyStatusConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  blueprintId: string;
  entries: BlueprintEntry[];
}

// ─── Entry Row with copy status ───────────────────────────────────────────────

interface EntryRowProps {
  entry: BlueprintEntry;
  workspaceId: string;
  selected: boolean;
  onToggle: () => void;
}

function EntryRow({ entry, workspaceId, selected, onToggle }: EntryRowProps) {
  const { data: copyStatus } = useCopyStatus(workspaceId, entry.id);

  const pageTypeLabel = PAGE_TYPE_LABELS[entry.pageType] ?? entry.pageType;
  const statusKey = copyStatus?.overallStatus ?? 'none';
  const statusConfig = COPY_STATUS_BADGE[statusKey] ?? COPY_STATUS_BADGE.none;

  const CheckIcon = selected ? CheckSquare : Square;

  return (
    <ClickableRow
      onClick={onToggle}
      active={selected}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border transition-colors text-left',
        selected
          ? 'bg-teal-900/20 border-teal-700/40 hover:bg-teal-900/30'
          : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] hover:bg-[var(--surface-3)]'
      )}
      aria-pressed={selected}
      aria-label={`${selected ? 'Deselect' : 'Select'} entry: ${entry.name}`}
    >
      <Icon
        as={CheckIcon}
        size="md"
        className={cn('shrink-0', selected ? 'text-teal-400' : 'text-[var(--brand-text-muted)]')}
      />
      <span className="flex-1 text-sm text-[var(--brand-text)] truncate">{entry.name}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge label={pageTypeLabel} tone="zinc" />
        <Badge label={statusConfig.label} tone={statusConfig.color} />
      </div>
    </ClickableRow>
  );
}

// ─── Batch Progress Bar ───────────────────────────────────────────────────────

interface BatchProgressProps {
  job: BatchJob;
}

function BatchProgressBar({ job }: BatchProgressProps) {
  const { total, generated, reviewed, approved } = job.progress;
  const percentage = total > 0 ? (generated / total) * 100 : 0;

  const statusLabel: Record<BatchJob['status'], string> = {
    pending:  'Queued',
    running:  'Generating',
    paused:   'Paused',
    complete: 'Complete',
    failed:   'Failed',
  };

  const statusColor: Record<BatchJob['status'], string> = {
    pending:  'text-[var(--brand-text-muted)]',
    running:  'text-blue-400',
    paused:   'text-amber-400',
    complete: 'text-emerald-400',
    failed:   'text-red-400',
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between t-caption">
        <span className={`font-medium ${statusColor[job.status]}`}>
          {statusLabel[job.status]}
          {job.status === 'running' && (
            <Loader2 className="inline-block ml-1 w-3 h-3 animate-spin" />
          )}
        </span>
        <span className="text-[var(--brand-text-muted)]">
          {generated}/{total} generated
          {reviewed > 0 && <span className="ml-2 text-[var(--brand-text-muted)]">&middot; {reviewed} reviewed</span>}
          {approved > 0 && <span className="ml-2 text-emerald-400">&middot; {approved} approved</span>}
        </span>
      </div>
      <div
        className="h-2 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Batch generation progress: ${generated} of ${total} done`}
      >
        <div
          className={`h-full transition-all duration-500 rounded-[var(--radius-pill)] ${
            job.status === 'failed'
              ? 'bg-red-500'
              : job.status === 'complete'
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
              : 'bg-gradient-to-r from-teal-600 to-emerald-600'
          }`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Inner Panel ──────────────────────────────────────────────────────────────

function BatchGenerationPanelInner({ workspaceId, blueprintId, entries }: Props) {
  const includedIds = useMemo(
    () => new Set(entries.filter(e => e.scope === 'included').map(e => e.id)),
    [entries]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(includedIds);

  // Sync when entries change: add new included entries, remove deleted entries
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      // Add new included entries
      for (const id of includedIds) {
        if (!prev.has(id)) next.add(id);
      }
      // Remove entries that no longer exist
      for (const id of prev) {
        if (!entries.some(e => e.id === id)) next.delete(id);
      }
      return next.size === prev.size && [...next].every(id => prev.has(id)) ? prev : next;
    });
  }, [includedIds, entries]);
  const [mode, setMode]           = useState<BatchMode>('review_inbox');
  const [batchSize, setBatchSize] = useState(5);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const startBatch = useStartBatch(workspaceId, blueprintId);
  const { data: batchJob, isLoading: isBatchLoading } = useBatchJob(workspaceId, activeBatchId);

  // ── Empty state ────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No blueprint entries"
        description="Add entries to the blueprint before running batch generation."
      />
    );
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const allSelected  = entries.length > 0 && selectedIds.size === entries.length;
  const noneSelected = selectedIds.size === 0;

  function toggleEntry(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  }

  function handleGenerate() {
    if (noneSelected || startBatch.isPending) return;
    startBatch.mutate(
      {
        entryIds: Array.from(selectedIds),
        mode,
        batchSize: mode === 'iterative' ? batchSize : undefined,
      },
      {
        onSuccess: (data) => {
          if (data?.batchId) {
            setActiveBatchId(data.batchId);
          }
        },
      }
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Entry selection */}
      <SectionCard
        title="Select Pages"
        titleIcon={<Icon as={Layers} size="md" className="text-[var(--brand-text-muted)]" />}
        titleExtra={
          <span className="t-caption text-[var(--brand-text-muted)]">
            {selectedIds.size}/{entries.length} selected
          </span>
        }
        action={
          <Button
            onClick={toggleAll}
            variant="link"
            size="sm"
            className="t-caption text-teal-400 hover:text-teal-300 transition-colors"
            aria-label={allSelected ? 'Deselect all entries' : 'Select all entries'}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </Button>
        }
      >
        <div className="space-y-1.5" role="group" aria-label="Blueprint entries">
          {entries.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              workspaceId={workspaceId}
              selected={selectedIds.has(entry.id)}
              onToggle={() => toggleEntry(entry.id)}
            />
          ))}
        </div>
      </SectionCard>

      {/* Mode selector + batch size */}
      <SectionCard
        title="Generation Mode"
        titleIcon={<Icon as={InboxIcon} size="md" className="text-[var(--brand-text-muted)]" />}
      >
        <div className="space-y-4">

          {/* Mode toggles */}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="Batch generation mode"
          >
            <Button
              onClick={() => setMode('review_inbox')}
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={mode === 'review_inbox'}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm font-medium transition-colors',
                mode === 'review_inbox'
                  ? 'bg-teal-900/20 border-teal-700/40 text-teal-300'
                  : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
              )}
            >
              <Icon as={InboxIcon} size="md" />
              Review Inbox
            </Button>
            <Button
              onClick={() => setMode('iterative')}
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={mode === 'iterative'}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-sm font-medium transition-colors',
                mode === 'iterative'
                  ? 'bg-teal-900/20 border-teal-700/40 text-teal-300'
                  : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
              )}
            >
              <Icon as={Layers} size="md" />
              Iterative Batch
            </Button>
          </div>

          {/* Mode description */}
          <p className="t-caption text-[var(--brand-text-muted)]">
            {mode === 'review_inbox'
              ? 'Generate copy for all selected pages at once and queue them for review in the inbox.'
              : 'Generate pages in small batches, pausing for review and steering between each batch.'}
          </p>

          {/* Batch size (iterative only) */}
          {mode === 'iterative' && (
            <div className="flex items-center gap-3">
              <label htmlFor="batch-size-input" className="text-sm text-[var(--brand-text)] shrink-0">
                Batch size
              </label>
              <FormInput
                id="batch-size-input"
                type="number"
                min={1}
                max={20}
                value={batchSize}
                onChange={value => setBatchSize(Math.max(1, Math.min(20, Number(value))))}
                className="w-20 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--brand-text-bright)] text-center focus:outline-none focus:border-teal-500"
                aria-label="Pages per batch"
              />
              <span className="t-caption text-[var(--brand-text-muted)]">pages per batch</span>
            </div>
          )}

        </div>
      </SectionCard>

      {/* Active batch progress */}
      {activeBatchId && (
        <SectionCard
          title="Batch Progress"
          titleIcon={<Icon as={Play} size="md" className="text-[var(--brand-text-muted)]" />}
        >
          {isBatchLoading ? (
            <SectionCardSkeleton lines={2} />
          ) : batchJob ? (
            <BatchProgressBar job={batchJob} />
          ) : (
            <p className="t-caption text-[var(--brand-text-muted)]">Waiting for batch status...</p>
          )}
        </SectionCard>
      )}

      {/* Generate button */}
      <div className="flex items-center justify-between pt-1">
        {noneSelected && (
          <p className="t-caption text-[var(--brand-text-muted)]" role="alert">
            Select at least one page to generate copy.
          </p>
        )}
        <div className="ml-auto">
          <Button
            onClick={handleGenerate}
            disabled={noneSelected || startBatch.isPending}
            variant="primary"
            size="md"
            icon={Play}
            loading={startBatch.isPending}
            aria-label={`Generate copy for ${selectedIds.size} selected page${selectedIds.size !== 1 ? 's' : ''}`}
          >
            {startBatch.isPending
              ? 'Starting batch...'
              : `Generate${selectedIds.size > 0 ? ` ${selectedIds.size} Page${selectedIds.size !== 1 ? 's' : ''}` : ''}`
            }
          </Button>
        </div>
      </div>

    </div>
  );
}

// ─── Public export (wrapped in error boundary) ────────────────────────────────

export function BatchGenerationPanel(props: Props) {
  return (
    <ErrorBoundary label="Batch Generation">
      <BatchGenerationPanelInner {...props} />
    </ErrorBoundary>
  );
}
