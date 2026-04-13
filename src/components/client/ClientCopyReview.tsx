// src/components/client/ClientCopyReview.tsx
// Client portal copy review — lets clients review, approve, and suggest edits
// on generated copy sections sent for their review.
// Design rules: no purple, teal for CTAs, blue for data, shared UI primitives.

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Check, MessageSquare, ChevronDown, ChevronUp,
  AlertCircle, Loader2, PenLine, FileCheck,
} from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton, SectionCardSkeleton } from '../ui/Skeleton';
import { ErrorBoundary } from '../ErrorBoundary';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import { COPY_STATUS_BADGE } from '../../lib/copyStatusConfig';
import { get, post } from '../../api/client';
import type { CopySectionStatus, ClientSuggestion } from '../../../shared/types/copy-pipeline';

// ── API helpers (inline to avoid modifying brand-engine.ts) ──

interface CopyEntryListItem {
  id: string;
  name: string;
  pageType: string;
  blueprintId: string;
  blueprintName: string;
  copyStatus: {
    entryId: string;
    totalSections: number;
    pendingSections: number;
    draftSections: number;
    clientReviewSections: number;
    approvedSections: number;
    revisionSections: number;
    overallStatus: CopySectionStatus;
    approvalPercentage: number;
  };
}

interface ClientCopySection {
  id: string;
  entryId: string;
  sectionPlanItemId: string;
  generatedCopy: string | null;
  status: CopySectionStatus;
  aiAnnotation: string | null;
  clientSuggestions: ClientSuggestion[] | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function fetchCopyEntries(wsId: string) {
  return get<{ entries: CopyEntryListItem[] }>(`/api/public/copy/${wsId}/entries`);
}

function fetchCopySections(wsId: string, entryId: string) {
  return get<{ sections: ClientCopySection[] }>(`/api/public/copy/${wsId}/entry/${entryId}/sections`);
}

function approveSection(wsId: string, sectionId: string) {
  return post<{ section: ClientCopySection }>(`/api/public/copy/${wsId}/section/${sectionId}/approve`);
}

function suggestEdit(wsId: string, sectionId: string, body: { originalText: string; suggestedText: string }) {
  return post<{ section: ClientCopySection }>(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, body);
}

// ── Human-friendly labels ──

const PAGE_TYPE_LABELS: Record<string, string> = {
  landing: 'Landing Page',
  service: 'Service Page',
  blog: 'Blog Post',
  location: 'Location Page',
  product: 'Product Page',
  pillar: 'Pillar Page',
  resource: 'Resource Page',
  about: 'About Page',
  contact: 'Contact Page',
  home: 'Homepage',
};

const SECTION_TYPE_LABELS: Record<string, string> = {
  hero: 'Hero',
  problem: 'Problem',
  solution: 'Solution',
  'social-proof': 'Social Proof',
  process: 'How It Works',
  faq: 'FAQ',
  cta: 'Call to Action',
  'about-team': 'About / Team',
  testimonials: 'Testimonials',
  'features-benefits': 'Features & Benefits',
  pricing: 'Pricing',
  gallery: 'Gallery',
  stats: 'Key Stats',
  'content-body': 'Content Body',
  'contact-form': 'Contact Form',
  'location-info': 'Location Info',
  'related-resources': 'Related Resources',
  custom: 'Custom Section',
};

// ── Props ──

interface ClientCopyReviewProps {
  workspaceId: string;
}

// ── Main component ──

export function ClientCopyReview({ workspaceId }: ClientCopyReviewProps) {
  return (
    <ErrorBoundary>
      <ClientCopyReviewInner workspaceId={workspaceId} />
    </ErrorBoundary>
  );
}

function ClientCopyReviewInner({ workspaceId }: ClientCopyReviewProps) {
  const queryClient = useQueryClient();
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // ── Real-time updates ──
  const wsHandlers = useMemo(() => ({
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => {
      queryClient.invalidateQueries({ queryKey: ['client-copy-entries', workspaceId] });
      if (expandedEntryId) {
        queryClient.invalidateQueries({ queryKey: ['client-copy-sections', workspaceId, expandedEntryId] });
      }
    },
  }), [queryClient, workspaceId, expandedEntryId]);

  useWorkspaceEvents(workspaceId, wsHandlers);

  // ── Query: entries list ──
  const {
    data: entriesData,
    isLoading: entriesLoading,
    error: entriesError,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ['client-copy-entries', workspaceId],
    queryFn: () => fetchCopyEntries(workspaceId),
    enabled: !!workspaceId,
  });

  const entries = entriesData?.entries ?? [];

  // ── Loading state ──
  if (entriesLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="space-y-2 mb-6">
          <Skeleton className="w-48 h-5" />
          <Skeleton className="w-72 h-3" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <SectionCardSkeleton key={i} lines={2} />
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (entriesError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <SectionCard title="Copy Review" titleIcon={<FileText className="w-4 h-4 text-zinc-400" />}>
          <div className="flex flex-col items-center py-8 gap-3">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-zinc-300">Something went wrong loading your copy review.</p>
            <button
              onClick={() => refetchEntries()}
              className="text-xs px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white transition-colors"
            >
              Try Again
            </button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ── Empty state ──
  if (entries.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <EmptyState
          icon={FileCheck}
          title="No copy ready for review yet"
          description="When your team sends copy for your review, it will appear here. You'll be able to approve sections or suggest changes."
        />
      </div>
    );
  }

  // ── Group entries by blueprint ──
  const grouped = entries.reduce<Record<string, { blueprintName: string; items: CopyEntryListItem[] }>>((acc, entry) => {
    if (!acc[entry.blueprintId]) {
      acc[entry.blueprintId] = { blueprintName: entry.blueprintName, items: [] };
    }
    acc[entry.blueprintId].items.push(entry);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Copy Review</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Review your website copy and approve sections or suggest changes.
        </p>
      </div>

      {/* Summary stats */}
      <div className="flex gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-teal-500" />
          {entries.reduce((n, e) => n + e.copyStatus.clientReviewSections, 0)} awaiting your review
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {entries.reduce((n, e) => n + e.copyStatus.approvedSections, 0)} approved
        </span>
      </div>

      {/* Entry list grouped by blueprint */}
      {Object.entries(grouped).map(([bpId, { blueprintName, items }]) => (
        <div key={bpId} className="space-y-3">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{blueprintName}</h3>
          {items.map((entry, idx) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              workspaceId={workspaceId}
              isExpanded={expandedEntryId === entry.id}
              onToggle={() => setExpandedEntryId(prev => prev === entry.id ? null : entry.id)}
              staggerIndex={idx}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Entry card ──

interface EntryCardProps {
  entry: CopyEntryListItem;
  workspaceId: string;
  isExpanded: boolean;
  onToggle: () => void;
  staggerIndex: number;
}

function EntryCard({ entry, workspaceId, isExpanded, onToggle, staggerIndex }: EntryCardProps) {
  const { copyStatus } = entry;
  const badgeConfig = COPY_STATUS_BADGE[copyStatus.overallStatus];
  const pageLabel = PAGE_TYPE_LABELS[entry.pageType] ?? entry.pageType;

  return (
    <SectionCard staggerIndex={staggerIndex} interactive>
      {/* Entry header — clickable to expand */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-zinc-200 block truncate">{entry.name}</span>
            <span className="text-xs text-zinc-500">{pageLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge label={badgeConfig.label} color={badgeConfig.color} />
          {/* Progress indicator */}
          {copyStatus.totalSections > 0 && (
            <span className="text-xs text-zinc-500">
              {copyStatus.approvedSections}/{copyStatus.clientReviewSections + copyStatus.approvedSections}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {/* Approval progress bar */}
      {copyStatus.totalSections > 0 && (
        <div className="mt-3">
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${copyStatus.approvalPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded sections */}
      {isExpanded && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <EntrySections workspaceId={workspaceId} entryId={entry.id} />
        </div>
      )}
    </SectionCard>
  );
}

// ── Sections for an entry ──

function EntrySections({ workspaceId, entryId }: { workspaceId: string; entryId: string }) {
  const queryClient = useQueryClient();

  const {
    data: sectionsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['client-copy-sections', workspaceId, entryId],
    queryFn: () => fetchCopySections(workspaceId, entryId),
    enabled: !!(workspaceId && entryId),
  });

  const sections = sectionsData?.sections ?? [];

  const [mutationError, setMutationError] = useState<string | null>(null);

  // ── Approve mutation ──
  const approveMutation = useMutation({
    mutationFn: (sectionId: string) => approveSection(workspaceId, sectionId),
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ['client-copy-sections', workspaceId, entryId] });
      queryClient.invalidateQueries({ queryKey: ['client-copy-entries', workspaceId] });
    },
    onError: () => {
      setMutationError('Could not approve this section. Please try again.');
    },
  });

  // ── Suggest mutation ──
  const suggestMutation = useMutation({
    mutationFn: (args: { sectionId: string; originalText: string; suggestedText: string }) =>
      suggestEdit(workspaceId, args.sectionId, {
        originalText: args.originalText,
        suggestedText: args.suggestedText,
      }),
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ['client-copy-sections', workspaceId, entryId] });
      queryClient.invalidateQueries({ queryKey: ['client-copy-entries', workspaceId] });
    },
    onError: () => {
      setMutationError('Could not submit your suggestion. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="w-24 h-3" />
            <Skeleton className="w-full h-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-6 gap-2">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <p className="text-xs text-zinc-400">Could not load sections.</p>
        <button
          onClick={() => refetch()}
          className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <p className="text-xs text-zinc-500 py-4 text-center">
        No sections are ready for review yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{mutationError}</span>
        </div>
      )}
      {sections.map(section => (
        <SectionReviewCard
          key={section.id}
          section={section}
          onApprove={() => approveMutation.mutate(section.id)}
          onSuggest={(originalText, suggestedText) =>
            suggestMutation.mutate({ sectionId: section.id, originalText, suggestedText })
          }
          isApproving={approveMutation.isPending && approveMutation.variables === section.id}
          isSuggesting={suggestMutation.isPending && suggestMutation.variables?.sectionId === section.id}
        />
      ))}
    </div>
  );
}

// ── Individual section review card ──

interface SectionReviewCardProps {
  section: ClientCopySection;
  onApprove: () => void;
  onSuggest: (originalText: string, suggestedText: string) => void;
  isApproving: boolean;
  isSuggesting: boolean;
}

function SectionReviewCard({ section, onApprove, onSuggest, isApproving, isSuggesting }: SectionReviewCardProps) {
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestedText, setSuggestedText] = useState('');
  const isApproved = section.status === 'approved';
  const isReviewable = section.status === 'client_review';

  // Extract section type from the sectionPlanItemId (format: "sp_xxx_hero" etc.)
  const sectionTypeRaw = section.sectionPlanItemId.split('_').slice(2).join('_') || 'section';
  const sectionLabel = SECTION_TYPE_LABELS[sectionTypeRaw] ?? sectionTypeRaw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const badgeConfig = COPY_STATUS_BADGE[section.status];

  const handleSubmitSuggestion = useCallback(() => {
    if (!suggestedText.trim() || !section.generatedCopy) return;
    onSuggest(section.generatedCopy, suggestedText.trim());
    setSuggestedText('');
    setShowSuggestForm(false);
  }, [suggestedText, section.generatedCopy, onSuggest]);

  return (
    <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/50">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PenLine className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="text-xs font-medium text-zinc-300">{sectionLabel}</span>
        </div>
        <Badge label={badgeConfig.label} color={badgeConfig.color} />
      </div>

      {/* Copy text */}
      {section.generatedCopy && (
        <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap bg-zinc-800/30 rounded p-3">
          {section.generatedCopy}
        </div>
      )}

      {/* AI annotation (context for client — why this section was written this way) */}
      {section.aiAnnotation && (
        <div className="text-xs text-zinc-500 italic border-l-2 border-zinc-700 pl-2">
          {section.aiAnnotation}
        </div>
      )}

      {/* Previous suggestions */}
      {section.clientSuggestions && section.clientSuggestions.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-zinc-500">Your previous suggestions</span>
          {section.clientSuggestions.map((s, i) => (
            <div key={i} className="text-xs bg-zinc-800/50 rounded p-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3 text-zinc-500" />
                <span className="text-zinc-400">
                  {s.status === 'pending' ? 'Pending review' :
                   s.status === 'accepted' ? 'Accepted' :
                   s.status === 'rejected' ? 'Not applied' :
                   'Modified'}
                </span>
              </div>
              <p className="text-zinc-400 line-through">{s.originalText.slice(0, 100)}{s.originalText.length > 100 ? '...' : ''}</p>
              <p className="text-zinc-300">{s.suggestedText.slice(0, 100)}{s.suggestedText.length > 100 ? '...' : ''}</p>
              {s.reviewNote && (
                <p className="text-zinc-500 italic">{s.reviewNote}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons (only for sections in client_review) */}
      {isReviewable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={onApprove}
            disabled={isApproving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApproving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Approve
          </button>
          <button
            onClick={() => setShowSuggestForm(!showSuggestForm)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            Suggest Changes
          </button>
        </div>
      )}

      {/* Approved confirmation */}
      {isApproved && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Check className="w-3.5 h-3.5" />
          <span>This section is approved and ready to go.</span>
        </div>
      )}

      {/* Suggestion form */}
      {showSuggestForm && isReviewable && (
        <div className="border-t border-zinc-800 pt-3 space-y-2">
          <label className="text-xs text-zinc-400 block">
            How would you like this section to read?
          </label>
          <textarea
            value={suggestedText}
            onChange={e => setSuggestedText(e.target.value)}
            placeholder="Type your suggested version here..."
            rows={4}
            className="w-full text-sm bg-zinc-800 border border-zinc-700 rounded p-2 text-zinc-200 placeholder-zinc-600 focus:border-teal-600 focus:outline-none resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmitSuggestion}
              disabled={!suggestedText.trim() || isSuggesting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSuggesting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <MessageSquare className="w-3 h-3" />
              )}
              Submit Suggestion
            </button>
            <button
              onClick={() => { setShowSuggestForm(false); setSuggestedText(''); }}
              className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
