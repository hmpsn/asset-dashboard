import { useState } from 'react';
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
  useCopyPipelineEvents,
} from '../../hooks/admin/useCopyPipeline';
import { SectionCard } from '../ui/SectionCard';
import { Badge } from '../ui/Badge';
import { SectionCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';
import { PAGE_TYPE_LABELS } from '../../lib/pageTypeLabels';
import type { BatchMode, BatchJob } from '../../../shared/types/copy-pipeline';
import type { BlueprintEntry } from '../../../shared/types/page-strategy';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  blueprintId: string;
  entries: BlueprintEntry[];
}

// ─── Copy Status Badge Config ─────────────────────────────────────────────────

const COPY_STATUS_BADGE: Record<string, { label: string; color: 'zinc' | 'blue' | 'amber' | 'green' | 'orange' }> = {
  pending:            { label: 'No Copy',        color: 'zinc'   },
  draft:              { label: 'Draft',           color: 'blue'   },
  client_review:      { label: 'Client Review',  color: 'amber'  },
  approved:           { label: 'Approved',        color: 'green'  },
  revision_requested: { label: 'Needs Revision', color: 'orange' },
};

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
  const statusKey = copyStatus?.overallStatus ?? 'pending';
  const statusConfig = COPY_STATUS_BADGE[statusKey] ?? COPY_STATUS_BADGE['pending'];

  const CheckIcon = selected ? CheckSquare : Square;

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
        selected
          ? 'bg-teal-900/20 border-teal-700/40 hover:bg-teal-900/30'
          : 'bg-zinc-800/50 border-zinc-800 hover:bg-zinc-800'
      }`}
      aria-pressed={selected}
      aria-label={`${selected ? 'Deselect' : 'Select'} entry: ${entry.name}`}
    >
      <CheckIcon
        className={`w-4 h-4 shrink-0 ${selected ? 'text-teal-400' : 'text-zinc-600'}`}
      />
      <span className="flex-1 text-sm text-zinc-200 truncate">{entry.name}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge label={pageTypeLabel} color="zinc" />
        <Badge label={statusConfig.label} color={statusConfig.color} />
      </div>
    </button>
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
    pending:  'text-zinc-400',
    running:  'text-blue-400',
    paused:   'text-amber-400',
    complete: 'text-green-400',
    failed:   'text-red-400',
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-medium ${statusColor[job.status]}`}>
          {statusLabel[job.status]}
          {job.status === 'running' && (
            <Loader2 className="inline-block ml-1 w-3 h-3 animate-spin" />
          )}
        </span>
        <span className="text-zinc-400">
          {generated}/{total} generated
          {reviewed > 0 && <span className="ml-2 text-zinc-500">&middot; {reviewed} reviewed</span>}
          {approved > 0 && <span className="ml-2 text-green-500">&middot; {approved} approved</span>}
        </span>
      </div>
      <div
        className="h-2 bg-zinc-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Batch generation progress: ${generated} of ${total} done`}
      >
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            job.status === 'failed'
              ? 'bg-red-500'
              : job.status === 'complete'
              ? 'bg-gradient-to-r from-green-600 to-emerald-500'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(entries.filter(e => e.scope === 'included').map(e => e.id))
  );
  const [mode, setMode]           = useState<BatchMode>('review_inbox');
  const [batchSize, setBatchSize] = useState(5);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const startBatch = useStartBatch(workspaceId, blueprintId);
  const { data: batchJob, isLoading: isBatchLoading } = useBatchJob(workspaceId, activeBatchId);

  // Subscribe to live WS events
  useCopyPipelineEvents(workspaceId);

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
        titleIcon={<Layers className="w-4 h-4 text-zinc-500" />}
        titleExtra={
          <span className="text-xs text-zinc-500">
            {selectedIds.size}/{entries.length} selected
          </span>
        }
        action={
          <button
            onClick={toggleAll}
            className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
            aria-label={allSelected ? 'Deselect all entries' : 'Select all entries'}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
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
        titleIcon={<InboxIcon className="w-4 h-4 text-zinc-500" />}
      >
        <div className="space-y-4">

          {/* Mode toggles */}
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="Batch generation mode"
          >
            <button
              onClick={() => setMode('review_inbox')}
              role="radio"
              aria-checked={mode === 'review_inbox'}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === 'review_inbox'
                  ? 'bg-teal-900/20 border-teal-700/40 text-teal-300'
                  : 'bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <InboxIcon className="w-4 h-4" />
              Review Inbox
            </button>
            <button
              onClick={() => setMode('iterative')}
              role="radio"
              aria-checked={mode === 'iterative'}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                mode === 'iterative'
                  ? 'bg-teal-900/20 border-teal-700/40 text-teal-300'
                  : 'bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <Layers className="w-4 h-4" />
              Iterative Batch
            </button>
          </div>

          {/* Mode description */}
          <p className="text-xs text-zinc-500">
            {mode === 'review_inbox'
              ? 'Generate copy for all selected pages at once and queue them for review in the inbox.'
              : 'Generate pages in small batches, pausing for review and steering between each batch.'}
          </p>

          {/* Batch size (iterative only) */}
          {mode === 'iterative' && (
            <div className="flex items-center gap-3">
              <label htmlFor="batch-size-input" className="text-sm text-zinc-300 shrink-0">
                Batch size
              </label>
              <input
                id="batch-size-input"
                type="number"
                min={1}
                max={20}
                value={batchSize}
                onChange={e => setBatchSize(Math.max(1, Math.min(20, Number(e.target.value))))}
                className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 text-center focus:outline-none focus:border-teal-500"
                aria-label="Pages per batch"
              />
              <span className="text-xs text-zinc-500">pages per batch</span>
            </div>
          )}

        </div>
      </SectionCard>

      {/* Active batch progress */}
      {activeBatchId && (
        <SectionCard
          title="Batch Progress"
          titleIcon={<Play className="w-4 h-4 text-zinc-500" />}
        >
          {isBatchLoading ? (
            <SectionCardSkeleton lines={2} />
          ) : batchJob ? (
            <BatchProgressBar job={batchJob} />
          ) : (
            <p className="text-xs text-zinc-500">Waiting for batch status...</p>
          )}
        </SectionCard>
      )}

      {/* Generate button */}
      <div className="flex items-center justify-between pt-1">
        {noneSelected && (
          <p className="text-xs text-zinc-500" role="alert">
            Select at least one page to generate copy.
          </p>
        )}
        <div className="ml-auto">
          <button
            onClick={handleGenerate}
            disabled={noneSelected || startBatch.isPending}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={`Generate copy for ${selectedIds.size} selected page${selectedIds.size !== 1 ? 's' : ''}`}
          >
            {startBatch.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting batch...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Generate{selectedIds.size > 0 ? ` ${selectedIds.size} Page${selectedIds.size !== 1 ? 's' : ''}` : ''}
              </>
            )}
          </button>
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
