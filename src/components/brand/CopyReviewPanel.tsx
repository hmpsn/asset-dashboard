import { useState } from 'react';
import {
  FileText,
  CheckCircle,
  RefreshCw,
  Send,
  Pencil,
  Save,
  X,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import {
  useCopySections,
  useCopyStatus,
  useCopyMetadata,
  useUpdateSectionStatus,
  useUpdateSectionText,
  useRegenerateCopySection,
  useGenerateCopy,
} from '../../hooks/admin/useCopyPipeline';
import { SectionCard } from '../ui/SectionCard';
import { Badge } from '../ui/Badge';
import { SectionCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';
import type { CopySection, QualityFlag } from '../../../shared/types/copy-pipeline';
import { COPY_STATUS_BADGE } from '../../lib/copyStatusConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  blueprintId: string;
  entryId: string;
}

// Status badge config — uses shared COPY_STATUS_BADGE from lib/copyStatusConfig

// ─── Quality Flag Row ─────────────────────────────────────────────────────────

function QualityFlagRow({ flag }: { flag: QualityFlag }) {
  const isError = flag.severity === 'error';
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
        isError ? 'bg-red-900/20 text-red-300' : 'bg-amber-900/20 text-amber-300'
      }`}
      role="alert"
      aria-label={`Quality flag: ${flag.message}`}
    >
      {isError ? (
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      )}
      <span>{flag.message}</span>
    </div>
  );
}

// ─── Section Card Item ────────────────────────────────────────────────────────

interface SectionItemProps {
  section: CopySection;
  workspaceId: string;
  blueprintId: string;
  entryId: string;
  index: number;
}

function SectionItem({ section, workspaceId, blueprintId, entryId, index }: SectionItemProps) {
  const [expanded, setExpanded]           = useState(true);
  const [editMode, setEditMode]           = useState(false);
  const [editText, setEditText]           = useState(section.generatedCopy ?? '');
  const [showRegenInput, setShowRegenInput] = useState(false);
  const [regenNote, setRegenNote]         = useState('');

  const updateStatus   = useUpdateSectionStatus(workspaceId);
  const updateText     = useUpdateSectionText(workspaceId);
  const regenerate     = useRegenerateCopySection(workspaceId, blueprintId);

  const statusConfig = COPY_STATUS_BADGE[section.status];
  const hasFlags = section.qualityFlags && section.qualityFlags.length > 0;
  const hasErrors = section.qualityFlags?.some(f => f.severity === 'error');

  // Friendly label from sectionPlanItemId — convert kebab-case to title case
  const sectionLabel = section.sectionPlanItemId
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const Chevron = expanded ? ChevronDown : ChevronRight;

  function handleApprove() {
    updateStatus.mutate({ sectionId: section.id, status: 'approved' });
  }

  function handleSendClientReview() {
    updateStatus.mutate({ sectionId: section.id, status: 'client_review' });
  }

  function handleSaveEdit() {
    updateText.mutate({ sectionId: section.id, copy: editText });
    setEditMode(false);
  }

  function handleCancelEdit() {
    setEditText(section.generatedCopy ?? '');
    setEditMode(false);
  }

  function handleRegenerate() {
    if (!regenNote.trim()) return;
    regenerate.mutate({ entryId, sectionId: section.id, note: regenNote.trim() });
    setRegenNote('');
    setShowRegenInput(false);
  }

  const isMutating =
    updateStatus.isPending ||
    updateText.isPending ||
    regenerate.isPending;

  return (
    <SectionCard
      staggerIndex={index}
      title={sectionLabel}
      titleIcon={<FileText className="w-4 h-4 text-zinc-500" />}
      titleExtra={
        <div className="flex items-center gap-1.5">
          <Badge label={statusConfig.label} color={statusConfig.color} />
          {hasErrors && <Badge label="Has errors" color="red" />}
          {hasFlags && !hasErrors && <Badge label="Warnings" color="amber" />}
        </div>
      }
      action={
        <button
          onClick={() => setExpanded(v => !v)}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label={expanded ? `Collapse section ${sectionLabel}` : `Expand section ${sectionLabel}`}
        >
          <Chevron className="w-4 h-4" />
        </button>
      }
    >
      {expanded && (
        <div className="space-y-4">

          {/* Generated copy */}
          {editMode ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={8}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-y"
                aria-label={`Edit copy for ${sectionLabel}`}
                disabled={updateText.isPending}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={updateText.isPending || !editText.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Save edits for ${sectionLabel}`}
                >
                  {updateText.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={updateText.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-400 text-xs hover:text-zinc-200 transition-colors disabled:opacity-40"
                  aria-label="Cancel editing"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="relative group">
              {section.generatedCopy ? (
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {section.generatedCopy}
                </p>
              ) : (
                <p className="text-sm text-zinc-600 italic">No copy generated yet.</p>
              )}
              {section.generatedCopy && (
                <button
                  onClick={() => {
                    setEditText(section.generatedCopy ?? '');
                    setEditMode(true);
                  }}
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-teal-400 transition-all"
                  aria-label={`Edit copy for ${sectionLabel}`}
                  tabIndex={0}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* AI Annotation */}
          {section.aiAnnotation && (
            <div className="flex items-start gap-2 bg-zinc-800/50 rounded-lg px-3 py-2.5">
              <MessageSquare className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide mb-0.5">AI Note</p>
                <p className="text-xs text-zinc-400">{section.aiAnnotation}</p>
              </div>
            </div>
          )}

          {/* Quality Flags */}
          {hasFlags && (
            <div className="space-y-1.5" role="list" aria-label="Quality flags">
              {section.qualityFlags!.map((flag, i) => (
                <QualityFlagRow key={i} flag={flag} />
              ))}
            </div>
          )}

          {/* Regenerate with note */}
          {showRegenInput ? (
            <div className="space-y-2">
              <label htmlFor={`regen-note-${section.id}`} className="text-xs text-zinc-400">
                Steering note for regeneration
              </label>
              <textarea
                id={`regen-note-${section.id}`}
                value={regenNote}
                onChange={e => setRegenNote(e.target.value)}
                rows={3}
                placeholder="e.g. Make it more concise, lead with the value prop..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none"
                disabled={regenerate.isPending}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRegenerate();
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={regenerate.isPending || !regenNote.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Submit regeneration note for ${sectionLabel}`}
                >
                  {regenerate.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Regenerate
                </button>
                <button
                  onClick={() => {
                    setShowRegenInput(false);
                    setRegenNote('');
                  }}
                  disabled={regenerate.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-400 text-xs hover:text-zinc-200 transition-colors disabled:opacity-40"
                  aria-label="Cancel regeneration"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* Action buttons row */
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-zinc-800">
              <button
                onClick={handleApprove}
                disabled={isMutating || section.status === 'approved'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Approve section ${sectionLabel}`}
              >
                {updateStatus.isPending && updateStatus.variables?.status === 'approved' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5" />
                )}
                Approve
              </button>

              <button
                onClick={() => setShowRegenInput(true)}
                disabled={isMutating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Regenerate section ${sectionLabel} with steering note`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </button>

              <button
                onClick={handleSendClientReview}
                disabled={isMutating || section.status === 'client_review'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={`Send section ${sectionLabel} to client review`}
              >
                {updateStatus.isPending && updateStatus.variables?.status === 'client_review' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send to Client Review
              </button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  approved: number;
  total: number;
  percentage: number;
}

function ProgressBar({ approved, total, percentage }: ProgressBarProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">
          {approved}/{total} section{total !== 1 ? 's' : ''} approved
        </span>
        <span className="text-xs font-medium text-zinc-300">{Math.round(percentage)}%</span>
      </div>
      <div
        className="h-1.5 bg-zinc-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Approval progress"
      >
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Inner Panel (unwrapped) ──────────────────────────────────────────────────

function CopyReviewPanelInner({ workspaceId, blueprintId, entryId }: Props) {
  const { data: sections = [], isLoading, isError } = useCopySections(workspaceId, entryId);
  const { data: copyStatus } = useCopyStatus(workspaceId, entryId);
  const { data: metadata } = useCopyMetadata(workspaceId, entryId);
  const generateCopy = useGenerateCopy(workspaceId, blueprintId);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading copy sections...
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <SectionCardSkeleton key={i} lines={4} />
        ))}
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <SectionCard title="Failed to load copy sections" className="!border-red-900/40">
        <div className="flex flex-col items-center text-center gap-3">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-xs text-zinc-500">Check your connection and try again.</p>
        </div>
      </SectionCard>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No copy sections yet"
        description="Generate the first draft to begin review. AI will create copy for each section based on the blueprint plan."
        action={
          <button
            onClick={() => generateCopy.mutate(entryId)}
            disabled={generateCopy.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Generate copy for this entry"
          >
            {generateCopy.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Generate Copy
              </>
            )}
          </button>
        }
      />
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const approved     = copyStatus?.approvedSections ?? sections.filter(s => s.status === 'approved').length;
  const total        = copyStatus?.totalSections ?? sections.length;
  const percentage   = copyStatus?.approvalPercentage ?? (total > 0 ? (approved / total) * 100 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Progress header */}
      <SectionCard
        title="Copy Review"
        titleIcon={<FileText className="w-4 h-4 text-zinc-500" />}
        titleExtra={
          metadata ? (
            <span className="text-[11px] text-zinc-500 truncate max-w-xs">
              {metadata.seoTitle ?? ''}
            </span>
          ) : undefined
        }
        action={
          <button
            onClick={() => generateCopy.mutate(entryId)}
            disabled={generateCopy.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Regenerate all copy"
          >
            {generateCopy.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Regenerate All
          </button>
        }
      >
        <ProgressBar approved={approved} total={total} percentage={percentage} />
      </SectionCard>

      {/* Section cards */}
      {sections.map((section, index) => (
        <SectionItem
          key={section.id}
          section={section}
          workspaceId={workspaceId}
          blueprintId={blueprintId}
          entryId={entryId}
          index={index}
        />
      ))}
    </div>
  );
}

// ─── Public export (wrapped in error boundary) ────────────────────────────────

export function CopyReviewPanel(props: Props) {
  return (
    <ErrorBoundary label="Copy Review">
      <CopyReviewPanelInner {...props} />
    </ErrorBoundary>
  );
}
