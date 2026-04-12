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
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { FeatureFlag } from '../ui/FeatureFlag';
import { useCopyStatus, useCopyPipelineEvents, useGenerateCopy } from '../../hooks/admin/useCopyPipeline';
import { CopyReviewPanel } from './CopyReviewPanel';
import { BatchGenerationPanel } from './BatchGenerationPanel';
import { CopyExportPanel } from './CopyExportPanel';
import { CopyIntelligenceManager } from './CopyIntelligenceManager';
import { PAGE_TYPE_LABELS } from '../../lib/pageTypeLabels';

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

  const label =
    status.overallStatus === 'approved' ? 'Approved' :
    status.overallStatus === 'client_review' ? 'In Review' :
    status.overallStatus === 'draft' ? 'Draft' :
    status.overallStatus === 'revision_requested' ? 'Revision' :
    'Pending';

  const colorClass =
    status.overallStatus === 'approved' ? 'bg-emerald-900/40 text-emerald-400' :
    status.overallStatus === 'client_review' ? 'bg-blue-900/40 text-blue-400' :
    status.overallStatus === 'draft' ? 'bg-zinc-700 text-zinc-300' :
    status.overallStatus === 'revision_requested' ? 'bg-amber-900/40 text-amber-400' :
    'bg-zinc-700 text-zinc-400';

  const Icon =
    status.overallStatus === 'approved' ? CheckCircle2 :
    status.overallStatus === 'client_review' ? FileText :
    Clock;

  return (
    <span className={`shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-xs rounded font-medium ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {label}
      {status.totalSections > 0 && (
        <span className="text-[10px] opacity-70">
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
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const isIncluded = entry.scope === 'included';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggle}
          className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          aria-label={expanded ? 'Collapse entry' : 'Expand entry'}
        >
          <Chevron className="w-4 h-4" />
        </button>

        <Layout className="w-4 h-4 text-zinc-400 shrink-0" />

        <span className="flex-1 min-w-0 text-sm font-medium text-zinc-100 truncate">
          {entry.name}
        </span>

        {/* Page type badge */}
        <span className="shrink-0 px-1.5 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded font-medium">
          {PAGE_TYPE_LABELS[entry.pageType] ?? entry.pageType}
        </span>

        {/* CMS badge */}
        {entry.isCollection && (
          <span className="shrink-0 px-1.5 py-0.5 text-xs bg-zinc-700 text-zinc-300 rounded font-medium">
            CMS
          </span>
        )}

        {/* Primary keyword badge */}
        {entry.primaryKeyword && (
          <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-xs bg-teal-900/40 text-teal-400 rounded font-medium">
            <Tag className="w-3 h-3" />
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
          className={`shrink-0 px-2 py-0.5 text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isIncluded
              ? 'bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60'
              : 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
          }`}
          aria-label={isIncluded ? 'Mark as upsell' : 'Mark as included'}
        >
          {isScopeToggling ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            isIncluded ? 'Included' : 'Upsell'
          )}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className="shrink-0 p-1 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={`Remove ${entry.name}`}
        >
          {isRemoving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Expanded: section plan */}
      {expanded && entry.sectionPlan.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-2">
            Section Plan
          </p>
          {entry.sectionPlan.map((section, idx) => (
            <div
              key={section.id}
              className="flex items-start gap-3 bg-zinc-800/50 rounded-lg px-3 py-2.5"
            >
              <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-zinc-700 text-zinc-400 text-xs font-medium">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 capitalize">
                    {section.sectionType.replace(/-/g, ' ')}
                  </span>
                  {/* narrative role — purple (admin-only) */}
                  {section.narrativeRole && (
                    <span className="px-1.5 py-0.5 text-xs bg-purple-900/30 text-purple-400 rounded font-medium capitalize">
                      {section.narrativeRole.replace(/-/g, ' ')}
                    </span>
                  )}
                  {section.wordCountTarget > 0 && (
                    <span className="text-xs text-zinc-500">
                      ~{section.wordCountTarget} words
                    </span>
                  )}
                </div>
                {section.brandNote && (
                  <p className="text-xs text-zinc-400">
                    <span className="text-zinc-500">Brand: </span>
                    {section.brandNote}
                  </p>
                )}
                {section.seoNote && (
                  <p className="text-xs text-zinc-400">
                    <span className="text-zinc-500">SEO: </span>
                    {section.seoNote}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && entry.sectionPlan.length === 0 && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-xs text-zinc-500 italic">No section plan defined.</p>
        </div>
      )}

      {/* Copy action buttons (feature-gated) */}
      {copyEnabled && expanded && (
        <div className="border-t border-zinc-800 px-4 py-2.5 flex items-center gap-2">
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
      {copyEnabled && isReviewing && workspaceId && blueprintId && (
        <div className="border-t border-zinc-800">
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
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
            isReviewing
              ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              : 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:opacity-90'
          }`}
        >
          {isReviewing ? (
            <>
              <X className="w-3 h-3" />
              Close Review
            </>
          ) : (
            <>
              <PenLine className="w-3 h-3" />
              Review Copy
            </>
          )}
        </button>
      ) : (
        <button
          onClick={onGenerateCopy}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
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

  // Live invalidation on server push
  useWorkspaceEvents(workspaceId, {
    'blueprint:updated': () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.blueprint(workspaceId, blueprintId),
      });
    },
  });

  // Copy pipeline WS events (no-op when flag is off — hook only subscribes)
  useCopyPipelineEvents(workspaceId);

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
      <div className="flex items-center gap-2 text-zinc-400 text-sm py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading blueprint...
      </div>
    );
  }

  if (isError || !blueprint) {
    return (
      <div className="space-y-3 py-8">
        <p className="text-sm text-zinc-400">Blueprint not found or failed to load.</p>
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
            className="mt-0.5 p-1 text-zinc-400 hover:text-zinc-100 transition-colors rounded"
            aria-label="Back to blueprints"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{blueprint.name}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              v{blueprint.version} · {inScope.length} page{inScope.length !== 1 ? 's' : ''} in scope{recommended.length > 0 ? ` · ${recommended.length} recommended` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={() => saveVersionMutation.mutate()}
          disabled={saveVersionMutation.isPending}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saveVersionMutation.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Version'
          )}
        </button>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('pages')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pages'
              ? 'border-teal-500 text-teal-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Layout className="w-3.5 h-3.5" />
          Pages
        </button>

        <FeatureFlag flag="copy-engine-pipeline">
          <button
            onClick={() => setActiveTab('copy')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'copy'
                ? 'border-teal-500 text-teal-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Copy Pipeline
          </button>
        </FeatureFlag>
      </div>

      {/* ── Pages tab (existing content) ─────────────────────────────────── */}
      {activeTab === 'pages' && (
        <>
          {/* In Scope section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-300">
                In Scope ({inScope.length})
              </h3>
              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add page
                </button>
              )}
            </div>

            {/* Add page form */}
            {showAddForm && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <label htmlFor="new-entry-name" className="text-xs text-zinc-400">
                      Page name
                    </label>
                    <input
                      id="new-entry-name"
                      value={newEntryName}
                      onChange={e => setNewEntryName(e.target.value)}
                      placeholder="e.g. Home, Services, About Us"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
                      disabled={addEntryMutation.isPending}
                      onKeyDown={e => e.key === 'Enter' && handleAddEntry()}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-entry-type" className="text-xs text-zinc-400">
                      Page type
                    </label>
                    <select
                      id="new-entry-type"
                      value={newEntryType}
                      onChange={e => setNewEntryType(e.target.value as BlueprintPageType)}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-teal-500"
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
                  <button
                    onClick={handleAddEntry}
                    disabled={!newEntryName.trim() || addEntryMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {addEntryMutation.isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      'Add Page'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewEntryName('');
                      setNewEntryType('service');
                    }}
                    disabled={addEntryMutation.isPending}
                    className="px-3 py-1.5 text-zinc-500 text-sm hover:text-zinc-300 transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {inScope.length === 0 && !showAddForm && (
              <p className="text-sm text-zinc-500 italic">No pages in scope yet. Add one above.</p>
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
              <h3 className="text-sm font-semibold text-zinc-300">
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
