import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronRight,
  Tag,
  Trash2,
  Layout,
  Loader2,
  FileText,
  Sparkles,
  PenLine,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import {
  blueprintEntries as blueprintEntriesApi,
  blueprintVersions as blueprintVersionsApi,
} from '../../api/brand-engine';
import type { BlueprintEntry, BlueprintPageType } from '../../../shared/types/page-strategy';
import { useToast } from '../Toast';
import { useBlueprint } from '../../hooks/admin/useBlueprints';
import { queryKeys } from '../../lib/queryKeys';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { TabBar, Icon, Button, cn } from '../ui/index';
import { useCopyStatus, useGenerateCopy } from '../../hooks/admin/useCopyPipeline';
import { CopyReviewPanel } from './CopyReviewPanel';
import { BatchGenerationPanel } from './BatchGenerationPanel';
import { CopyExportPanel } from './CopyExportPanel';
import { CopyIntelligenceManager } from './CopyIntelligenceManager';
import { PAGE_TYPE_LABELS } from '../../lib/pageTypeLabels';
import { COPY_STATUS_BADGE } from '../../lib/copyStatusConfig';

interface Props {
  workspaceId: string;
  blueprintId: string;
  onBack: () => void;
}

// ─── EntryCard ────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: BlueprintEntry;
  expanded: boolean;
  onToggle: () => void;
  onScopeToggle: () => void;
  onRemove: () => void;
  isScopeToggling: boolean;
  isRemoving: boolean;
  /** Copy pipeline integration (only rendered when feature flag is on) */
  copyEnabled?: boolean;
  workspaceId?: string;
  blueprintId?: string;
  isReviewing?: boolean;
  onReviewCopy?: () => void;
  onCloseReview?: () => void;
  onGenerateCopy?: () => void;
  isGenerating?: boolean;
}

// ─── EntryCard Copy Status Badge ─────────────────────────────────────────────

function EntryCardCopyBadge({ workspaceId, entryId }: { workspaceId: string; entryId: string }) {
  const { data: status } = useCopyStatus(workspaceId, entryId);

  if (!status || status.totalSections === 0) return null;

  const config = COPY_STATUS_BADGE[status.overallStatus] ?? COPY_STATUS_BADGE.pending;

  const BadgeIcon =
    status.overallStatus === 'approved' ? CheckCircle2 :
    status.overallStatus === 'client_review' ? FileText :
    Clock;

  // Map shared color names to inline badge classes
  const colorClass: Record<string, string> = {
    green: 'bg-emerald-900/40 text-emerald-400',   // legacy alias
    emerald: 'bg-emerald-900/40 text-emerald-400',
    teal: 'bg-teal-900/40 text-teal-400',
    blue: 'bg-blue-900/40 text-blue-400',
    orange: 'bg-amber-900/40 text-amber-400',
    zinc: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  };

  return (
    <span className={cn('shrink-0 flex items-center gap-1 px-1.5 py-0.5 t-caption rounded font-medium', colorClass[config.color] ?? colorClass.zinc)}>
      <Icon as={BadgeIcon} size="sm" />
      {config.label}
      {status.totalSections > 0 && (
        <span className="t-caption-sm opacity-70">
          ({status.approvedSections}/{status.totalSections})
        </span>
      )}
    </span>
  );
}

function EntryCard({
  entry,
  expanded,
  onToggle,
  onScopeToggle,
  onRemove,
  isScopeToggling,
  isRemoving,
  copyEnabled,
  workspaceId,
  blueprintId,
  isReviewing,
  onReviewCopy,
  onCloseReview,
  onGenerateCopy,
  isGenerating,
}: EntryCardProps) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const isIncluded = entry.scope === 'included';

  return (
    // pr-check-disable-next-line -- section card pending Phase 4 SectionCard migration
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggle}
          className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors shrink-0"
          aria-label={expanded ? 'Collapse entry' : 'Expand entry'}
        >
          <Icon as={ChevronIcon} size="md" />
        </button>

        <Icon as={Layout} size="md" className="text-[var(--brand-text)] shrink-0" />

        <span className="flex-1 min-w-0 text-sm font-medium text-[var(--brand-text-bright)] truncate">
          {entry.name}
        </span>

        {/* Page type badge */}
        <span className="shrink-0 px-1.5 py-0.5 t-caption bg-[var(--surface-3)] text-[var(--brand-text)] rounded font-medium">
          {PAGE_TYPE_LABELS[entry.pageType] ?? entry.pageType}
        </span>

        {/* CMS badge */}
        {entry.isCollection && (
          <span className="shrink-0 px-1.5 py-0.5 t-caption bg-[var(--brand-border-hover)] text-[var(--brand-text)] rounded font-medium">
            CMS
          </span>
        )}

        {/* Primary keyword badge */}
        {entry.primaryKeyword && (
          <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 t-caption bg-teal-900/40 text-teal-400 rounded font-medium">
            <Icon as={Tag} size="sm" />
            {entry.primaryKeyword}
          </span>
        )}

        {/* Copy status badge (feature-gated) */}
        {copyEnabled && workspaceId && (
          <EntryCardCopyBadge workspaceId={workspaceId} entryId={entry.id} />
        )}

        {/* Scope toggle */}
        <button
          onClick={onScopeToggle}
          disabled={isScopeToggling}
          className={cn(
            'shrink-0 px-2 py-0.5 t-caption rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            isIncluded
              ? 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'
              : 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
          )}
          aria-label={isIncluded ? 'Mark as upsell' : 'Mark as included'}
        >
          {isScopeToggling ? (
            <Icon as={Loader2} size="sm" className="animate-spin" />
          ) : (
            isIncluded ? 'Included' : 'Upsell'
          )}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className="shrink-0 p-1 text-[var(--brand-text-muted)] hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`Remove ${entry.name}`}
        >
          {isRemoving ? (
            <Icon as={Loader2} size="md" className="animate-spin" />
          ) : (
            <Icon as={Trash2} size="md" />
          )}
        </button>
      </div>

      {/* Expanded: section plan */}
      {expanded && entry.sectionPlan.length > 0 && (
        <div className="border-t border-[var(--brand-border)] px-4 py-3 space-y-2">
          <p className="t-caption text-[var(--brand-text-muted)] font-medium uppercase tracking-wide mb-2">
            Section Plan
          </p>
          {entry.sectionPlan.map((section, idx) => (
            <div
              key={section.id}
              className="flex items-start gap-3 bg-[var(--surface-3)]/50 rounded-[var(--radius-md)] px-3 py-2.5"
            >
              <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--brand-border-hover)] text-[var(--brand-text)] t-caption font-medium">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--brand-text-bright)] capitalize">
                    {section.sectionType.replace(/-/g, ' ')}
                  </span>
                  {/* narrative role — purple (admin-only) */}
                  {section.narrativeRole && (
                    <span className="px-1.5 py-0.5 t-caption bg-purple-900/30 text-purple-400 rounded font-medium capitalize">
                      {section.narrativeRole.replace(/-/g, ' ')}
                    </span>
                  )}
                  {section.wordCountTarget > 0 && (
                    <span className="t-caption text-[var(--brand-text-muted)]">
                      ~{section.wordCountTarget} words
                    </span>
                  )}
                </div>
                {section.brandNote && (
                  <p className="t-caption text-[var(--brand-text)]">
                    <span className="text-[var(--brand-text-muted)]">Brand: </span>
                    {section.brandNote}
                  </p>
                )}
                {section.seoNote && (
                  <p className="t-caption text-[var(--brand-text)]">
                    <span className="text-[var(--brand-text-muted)]">SEO: </span>
                    {section.seoNote}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && entry.sectionPlan.length === 0 && (
        <div className="border-t border-[var(--brand-border)] px-4 py-3">
          <p className="t-caption text-[var(--brand-text-muted)] italic">No section plan defined.</p>
        </div>
      )}

      {/* Copy action buttons (feature-gated) */}
      {copyEnabled && expanded && (
        <div className="border-t border-[var(--brand-border)] px-4 py-2.5 flex items-center gap-2">
          <CopyActionButtons
            workspaceId={workspaceId!}
            entryId={entry.id}
            isReviewing={isReviewing}
            onReviewCopy={onReviewCopy}
            onCloseReview={onCloseReview}
            onGenerateCopy={onGenerateCopy}
            isGenerating={isGenerating}
          />
        </div>
      )}

      {/* Inline copy review panel */}
      {copyEnabled && expanded && isReviewing && workspaceId && blueprintId && (
        <div className="border-t border-[var(--brand-border)]">
          <CopyReviewPanel
            workspaceId={workspaceId}
            blueprintId={blueprintId}
            entryId={entry.id}
          />
        </div>
      )}
    </div>
  );
}

// ─── Copy Action Buttons ─────────────────────────────────────────────────────

function CopyActionButtons({
  workspaceId,
  entryId,
  isReviewing,
  onReviewCopy,
  onCloseReview,
  onGenerateCopy,
  isGenerating,
}: {
  workspaceId: string;
  entryId: string;
  isReviewing?: boolean;
  onReviewCopy?: () => void;
  onCloseReview?: () => void;
  onGenerateCopy?: () => void;
  isGenerating?: boolean;
}) {
  const { data: status } = useCopyStatus(workspaceId, entryId);
  const hasCopy = status && status.totalSections > 0;

  return (
    <>
      {hasCopy ? (
        <button
          onClick={isReviewing ? onCloseReview : onReviewCopy}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 t-caption rounded-[var(--radius-md)] font-medium transition-colors',
            isReviewing
              ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]/80'
              : 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:opacity-90'
          )}
        >
          {isReviewing ? (
            <>
              <Icon as={X} size="sm" />
              Close Review
            </>
          ) : (
            <>
              <Icon as={PenLine} size="sm" />
              Review Copy
            </>
          )}
        </button>
      ) : (
        <button
          onClick={onGenerateCopy}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-2.5 py-1 t-caption rounded-[var(--radius-md)] font-medium bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Icon as={Loader2} size="sm" className="animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Icon as={Sparkles} size="sm" />
              Generate Copy
            </>
          )}
        </button>
      )}
    </>
  );
}

// ─── BlueprintDetail ──────────────────────────────────────────────────────────

type BlueprintTab = 'pages' | 'copy';

export function BlueprintDetail({ workspaceId, blueprintId, onBack }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryType, setNewEntryType] = useState<BlueprintPageType>('service');

  // Ids currently being mutated (to show per-entry loading states)
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // ── Copy Pipeline state ──────────────────────────────────────────────────
  const copyEnabled = useFeatureFlag('copy-engine-pipeline');
  const [activeTab, setActiveTab] = useState<BlueprintTab>('pages');
  const [reviewingEntryId, setReviewingEntryId] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: blueprint, isLoading, isError } = useBlueprint(workspaceId, blueprintId);

  // Copy generation mutation (safe to call unconditionally — only mutates on user click)
  const generateCopyMutation = useGenerateCopy(workspaceId, blueprintId);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addEntryMutation = useMutation({
    mutationFn: (body: { name: string; pageType: string }) =>
      blueprintEntriesApi.add(workspaceId, blueprintId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprint(workspaceId, blueprintId),
      });
      toast('Page added');
      setShowAddForm(false);
      setNewEntryName('');
      setNewEntryType('service');
    },
    onError: () => toast('Failed to add page', 'error'),
  });

  const toggleScopeMutation = useMutation({
    mutationFn: ({ entryId, scope }: { entryId: string; scope: BlueprintEntry['scope'] }) =>
      blueprintEntriesApi.update(workspaceId, blueprintId, entryId, { scope }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprint(workspaceId, blueprintId),
      });
      setTogglingId(null);
    },
    onError: () => {
      toast('Failed to update scope', 'error');
      setTogglingId(null);
    },
  });

  const removeEntryMutation = useMutation({
    mutationFn: (entryId: string) =>
      blueprintEntriesApi.remove(workspaceId, blueprintId, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprint(workspaceId, blueprintId),
      });
      toast('Page removed');
      setRemovingId(null);
    },
    onError: () => {
      toast('Failed to remove page', 'error');
      setRemovingId(null);
    },
  });

  const saveVersionMutation = useMutation({
    mutationFn: () =>
      blueprintVersionsApi.create(workspaceId, blueprintId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprint(workspaceId, blueprintId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprintVersions(workspaceId, blueprintId),
      });
      toast('Version saved');
    },
    onError: () => toast('Failed to save version', 'error'),
  });

  // ── Derived data ──────────────────────────────────────────────────────────

  const entries: BlueprintEntry[] = blueprint?.entries ?? [];
  const inScope = entries.filter(e => e.scope === 'included');
  const recommended = entries.filter(e => e.scope === 'recommended');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleScopeToggle(entry: BlueprintEntry) {
    const newScope: BlueprintEntry['scope'] =
      entry.scope === 'included' ? 'recommended' : 'included';
    setTogglingId(entry.id);
    toggleScopeMutation.mutate({ entryId: entry.id, scope: newScope });
  }

  function handleRemove(entry: BlueprintEntry) {
    if (!window.confirm(`Remove "${entry.name}" from this blueprint? This cannot be undone.`)) return;
    setRemovingId(entry.id);
    removeEntryMutation.mutate(entry.id);
  }

  function handleAddEntry() {
    if (!newEntryName.trim()) return;
    addEntryMutation.mutate({ name: newEntryName.trim(), pageType: newEntryType });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--brand-text)] text-sm py-8">
        <Icon as={Loader2} size="md" className="animate-spin" />
        Loading blueprint...
      </div>
    );
  }

  if (isError || !blueprint) {
    return (
      <div className="space-y-3 py-8">
        <p className="text-sm text-[var(--brand-text)]">Blueprint not found or failed to load.</p>
        <button
          onClick={onBack}
          className="text-sm text-teal-400 hover:text-teal-300 transition-colors"
        >
          &larr; Back to blueprints
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="mt-0.5 p-1 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors rounded"
            aria-label="Back to blueprints"
          >
            <Icon as={ArrowLeft} size="md" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-[var(--brand-text-bright)]">{blueprint.name}</h2>
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
              v{blueprint.version} · {inScope.length} page{inScope.length !== 1 ? 's' : ''} in scope{recommended.length > 0 ? ` · ${recommended.length} recommended` : ''}
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          loading={saveVersionMutation.isPending}
          disabled={saveVersionMutation.isPending}
          onClick={() => saveVersionMutation.mutate()}
        >
          {saveVersionMutation.isPending ? 'Saving...' : 'Save Version'}
        </Button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <TabBar
        tabs={[
          { id: 'pages', label: 'Pages', icon: Layout },
          ...(copyEnabled ? [{ id: 'copy', label: 'Copy Pipeline', icon: FileText }] : []),
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as BlueprintTab)}
      />

      {/* ── Pages tab (existing content) ─────────────────────────────────── */}
      {activeTab === 'pages' && (
        <>
          {/* In Scope section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--brand-text)]">
                In Scope ({inScope.length})
              </h3>
              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 t-caption text-teal-400 hover:text-teal-300 transition-colors"
                >
                  <Icon as={Plus} size="md" />
                  Add page
                </button>
              )}
            </div>

            {/* Add page form */}
            {showAddForm && (
              // pr-check-disable-next-line -- inline stats summary panel; pending Phase 4 SectionCard migration
              <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label htmlFor="new-entry-name" className="t-caption text-[var(--brand-text)]">
                      Page name
                    </label>
                    <input
                      id="new-entry-name"
                      value={newEntryName}
                      onChange={e => setNewEntryName(e.target.value)}
                      placeholder="e.g. Home, Services, About Us"
                      className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                      disabled={addEntryMutation.isPending}
                      onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-entry-type" className="t-caption text-[var(--brand-text)]">
                      Page type
                    </label>
                    <select
                      id="new-entry-type"
                      value={newEntryType}
                      onChange={e => setNewEntryType(e.target.value as BlueprintPageType)}
                      className="bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
                      disabled={addEntryMutation.isPending}
                    >
                      {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={addEntryMutation.isPending}
                    disabled={!newEntryName.trim() || addEntryMutation.isPending}
                    onClick={handleAddEntry}
                  >
                    {addEntryMutation.isPending ? 'Adding...' : 'Add Page'}
                  </Button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewEntryName('');
                      setNewEntryType('service');
                    }}
                    disabled={addEntryMutation.isPending}
                    className="px-3 py-1.5 text-[var(--brand-text-muted)] text-sm hover:text-[var(--brand-text)] transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {inScope.length === 0 && !showAddForm && (
              <p className="text-sm text-[var(--brand-text-muted)] italic">No pages in scope yet. Add one above.</p>
            )}

            {inScope.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpanded(entry.id)}
                onScopeToggle={() => handleScopeToggle(entry)}
                onRemove={() => handleRemove(entry)}
                isScopeToggling={togglingId === entry.id}
                isRemoving={removingId === entry.id}
                copyEnabled={copyEnabled}
                workspaceId={workspaceId}
                blueprintId={blueprintId}
                isReviewing={reviewingEntryId === entry.id}
                onReviewCopy={() => setReviewingEntryId(entry.id)}
                onCloseReview={() => setReviewingEntryId(null)}
                onGenerateCopy={() => {
                  generateCopyMutation.mutate(entry.id);
                  toast('Generating copy...');
                }}
                isGenerating={generateCopyMutation.isPending && generateCopyMutation.variables === entry.id}
              />
            ))}
          </section>

          {/* Recommended — Upsell Opportunities */}
          {recommended.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--brand-text)]">
                Recommended — Upsell Opportunities ({recommended.length})
              </h3>

              {recommended.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  expanded={expandedIds.has(entry.id)}
                  onToggle={() => toggleExpanded(entry.id)}
                  onScopeToggle={() => handleScopeToggle(entry)}
                  onRemove={() => handleRemove(entry)}
                  isScopeToggling={togglingId === entry.id}
                  isRemoving={removingId === entry.id}
                  copyEnabled={copyEnabled}
                  workspaceId={workspaceId}
                  blueprintId={blueprintId}
                  isReviewing={reviewingEntryId === entry.id}
                  onReviewCopy={() => setReviewingEntryId(entry.id)}
                  onCloseReview={() => setReviewingEntryId(null)}
                  onGenerateCopy={() => {
                    generateCopyMutation.mutate(entry.id);
                    toast('Generating copy...');
                  }}
                  isGenerating={generateCopyMutation.isPending && generateCopyMutation.variables === entry.id}
                />
              ))}
            </section>
          )}
        </>
      )}

      {/* ── Copy Pipeline tab ────────────────────────────────────────────── */}
      {activeTab === 'copy' && copyEnabled && (
        <div className="space-y-6">
          <BatchGenerationPanel
            workspaceId={workspaceId}
            blueprintId={blueprintId}
            entries={entries}
          />
          <CopyExportPanel
            workspaceId={workspaceId}
            blueprintId={blueprintId}
            entries={entries}
          />
          <CopyIntelligenceManager
            workspaceId={workspaceId}
          />
        </div>
      )}
    </div>
  );
}
