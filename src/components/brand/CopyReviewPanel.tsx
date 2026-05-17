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
  useSendEntryToClientReview,
} from '../../hooks/admin/useCopyPipeline';
import { SectionCard, Badge, SectionCardSkeleton, EmptyState, Icon, Button, IconButton, FormTextarea } from '../ui';
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
      className={`flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] t-caption ${
        isError ? 'bg-red-900/20 text-red-300' : 'bg-amber-900/20 text-amber-300'
      }`}
      role="alert"
      aria-label={`Quality flag: ${flag.message}`}
    >
      {isError ? (
        <Icon as={AlertCircle} size="md" className="mt-0.5 shrink-0" />
      ) : (
        <Icon as={AlertTriangle} size="md" className="mt-0.5 shrink-0" />
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
      titleIcon={<Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />}
      titleExtra={
        <div className="flex items-center gap-1.5">
          <Badge label={statusConfig.label} tone={statusConfig.color} />
          {hasErrors && <Badge label="Has errors" tone="red" />}
          {hasFlags && !hasErrors && <Badge label="Warnings" tone="amber" />}
        </div>
      }
      action={
        <IconButton
          onClick={() => setExpanded(v => !v)}
          icon={Chevron}
          label={expanded ? `Collapse section ${sectionLabel}` : `Expand section ${sectionLabel}`}
          variant="ghost"
          size="sm"
          className="p-1 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
        />
      }
    >
      {expanded && (
        <div className="space-y-4">

          {/* Generated copy */}
          {editMode ? (
            <div className="space-y-2">
              <FormTextarea
                value={editText}
                onChange={setEditText}
                rows={8}
                className="w-full"
                aria-label={`Edit copy for ${sectionLabel}`}
                disabled={updateText.isPending}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveEdit}
                  disabled={updateText.isPending || !editText.trim()}
                  variant="primary"
                  size="sm"
                  icon={Save}
                  loading={updateText.isPending}
                  aria-label={`Save edits for ${sectionLabel}`}
                >
                  Save
                </Button>
                <Button
                  onClick={handleCancelEdit}
                  disabled={updateText.isPending}
                  variant="ghost"
                  size="sm"
                  icon={X}
                  aria-label="Cancel editing"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative group">
              {section.generatedCopy ? (
                <p className="text-sm text-[var(--brand-text)] leading-relaxed whitespace-pre-wrap">
                  {section.generatedCopy}
                </p>
              ) : (
                <p className="text-sm text-[var(--brand-text-muted)] italic">No copy generated yet.</p>
              )}
              {section.generatedCopy && (
                <IconButton
                  onClick={() => {
                    setEditText(section.generatedCopy ?? '');
                    setEditMode(true);
                  }}
                  icon={Pencil}
                  label={`Edit copy for ${sectionLabel}`}
                  variant="ghost"
                  size="sm"
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 text-[var(--brand-text-muted)] hover:text-teal-400 transition-all"
                  tabIndex={0}
                />
              )}
            </div>
          )}

          {/* AI Annotation */}
          {section.aiAnnotation && (
            <div className="flex items-start gap-2 bg-[var(--surface-3)]/50 rounded-[var(--radius-md)] px-3 py-2.5">
              <Icon as={MessageSquare} size="md" className="text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wide mb-0.5">AI Note</p>
                <p className="t-caption text-[var(--brand-text-muted)]">{section.aiAnnotation}</p>
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
              <label htmlFor={`regen-note-${section.id}`} className="t-caption text-[var(--brand-text-muted)]">
                Steering note for regeneration
              </label>
              <FormTextarea
                id={`regen-note-${section.id}`}
                value={regenNote}
                onChange={setRegenNote}
                rows={3}
                placeholder="e.g. Make it more concise, lead with the value prop..."
                className="w-full"
                disabled={regenerate.isPending}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRegenerate();
                }}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleRegenerate}
                  disabled={regenerate.isPending || !regenNote.trim()}
                  variant="primary"
                  size="sm"
                  icon={RefreshCw}
                  loading={regenerate.isPending}
                  aria-label={`Submit regeneration note for ${sectionLabel}`}
                >
                  Regenerate
                </Button>
                <Button
                  onClick={() => {
                    setShowRegenInput(false);
                    setRegenNote('');
                  }}
                  disabled={regenerate.isPending}
                  variant="ghost"
                  size="sm"
                  icon={X}
                  aria-label="Cancel regeneration"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* Action buttons row */
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--brand-border)]">
              <Button
                onClick={handleApprove}
                disabled={isMutating || section.status === 'approved'}
                variant="primary"
                size="sm"
                icon={CheckCircle}
                loading={updateStatus.isPending && updateStatus.variables?.status === 'approved'}
                aria-label={`Approve section ${sectionLabel}`}
              >
                Approve
              </Button>

              <Button
                onClick={() => setShowRegenInput(true)}
                disabled={isMutating}
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                aria-label={`Regenerate section ${sectionLabel} with steering note`}
              >
                Regenerate
              </Button>

              <Button
                onClick={handleSendClientReview}
                disabled={isMutating || section.status === 'client_review'}
                variant="secondary"
                size="sm"
                icon={Send}
                loading={updateStatus.isPending && updateStatus.variables?.status === 'client_review'}
                aria-label={`Send section ${sectionLabel} to client review`}
              >
                Send to Client Review
              </Button>
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
        <span className="t-caption text-[var(--brand-text-muted)]">
          {approved}/{total} section{total !== 1 ? 's' : ''} approved
        </span>
        <span className="t-caption font-medium text-[var(--brand-text)]">{Math.round(percentage)}%</span>
      </div>
      <div
        className="h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden"
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
  const sendToClient = useSendEntryToClientReview(workspaceId, blueprintId);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)] text-sm">
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
          <Icon as={AlertCircle} size="2xl" className="text-red-400" />
          <p className="t-caption text-[var(--brand-text-muted)]">Check your connection and try again.</p>
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
          <Button
            onClick={() => generateCopy.mutate(entryId)}
            disabled={generateCopy.isPending}
            variant="primary"
            size="md"
            icon={RefreshCw}
            loading={generateCopy.isPending}
            aria-label="Generate copy for this entry"
          >
            {generateCopy.isPending ? 'Generating...' : 'Generate Copy'}
          </Button>
        }
      />
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const approved     = copyStatus?.approvedSections ?? sections.filter(s => s.status === 'approved').length;
  const total        = copyStatus?.totalSections ?? sections.length;
  const percentage   = copyStatus?.approvalPercentage ?? (total > 0 ? (approved / total) * 100 : 0);
  const draftCount   = copyStatus?.draftSections ?? sections.filter(s => s.status === 'draft').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Progress header */}
      <SectionCard
        title="Copy Review"
        titleIcon={<Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />}
        titleExtra={
          metadata ? (
            <span className="t-caption-sm text-[var(--brand-text-muted)] truncate max-w-xs">
              {metadata.seoTitle ?? ''}
            </span>
          ) : undefined
        }
        action={
          <div className="flex items-center gap-2">
            {draftCount > 0 && (
              <Button
                onClick={() => sendToClient.mutate(entryId)}
                disabled={sendToClient.isPending}
                variant="primary"
                size="sm"
                icon={Send}
                loading={sendToClient.isPending}
                aria-label="Send all draft sections to client review"
              >
                Send for Client Review
              </Button>
            )}
            <Button
              onClick={() => generateCopy.mutate(entryId)}
              disabled={generateCopy.isPending}
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={generateCopy.isPending}
              aria-label="Regenerate all copy"
            >
              Regenerate All
            </Button>
          </div>
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
