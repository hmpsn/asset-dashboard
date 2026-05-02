// src/components/client/ClientCopyReview.tsx
// Client portal copy review — lets clients review, approve, and suggest edits
// on generated copy sections sent for their review.
// Design rules: no purple, teal for CTAs, blue for data, shared UI primitives.

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Check, MessageSquare, ChevronDown, ChevronUp,
  AlertCircle, PenLine, FileCheck,
} from 'lucide-react';
import { Button } from '../ui';
import { SectionCard } from '../ui/SectionCard';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton, SectionCardSkeleton } from '../ui/Skeleton';
import { ErrorBoundary } from '../ErrorBoundary';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import { COPY_STATUS_BADGE } from '../../lib/copyStatusConfig';
import { queryKeys } from '../../lib/queryKeys';
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
  // Invalidate all section queries for the workspace (not just the currently expanded
  // entry) so that when the user later expands a different entry, React Query doesn't
  // serve stale section data from before the WS event arrived.
  const wsHandlers = useMemo(() => ({
    // ws-invalidation-ok — client keys (copyEntries, copySectionsAll) differ from admin keys in central hook
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntries(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntriesCount(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copySectionsAll(workspaceId) });
    },
  }), [queryClient, workspaceId]);

  useWorkspaceEvents(workspaceId, wsHandlers);

  // ── Query: entries list ──
  const {
    data: entriesData,
    isLoading: entriesLoading,
    error: entriesError,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: queryKeys.client.copyEntries(workspaceId),
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
        <SectionCard title="Copy Review" titleIcon={<FileText className="w-4 h-4 text-[var(--brand-text)]" />}>
          <div className="flex flex-col items-center py-8 gap-3">
            <AlertCircle className="w-8 h-8 text-accent-danger" />
            <p className="t-body text-[var(--brand-text)]">Something went wrong loading your copy review.</p>
            <Button variant="primary" onClick={() => refetchEntries()} className="t-caption px-3 py-1.5">
              Try Again
            </Button>
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
        <h2 className="t-h2 text-[var(--brand-text-bright)]">Copy Review</h2>
        <p className="t-body text-[var(--brand-text)] mt-1">
          Review your website copy and approve sections or suggest changes.
        </p>
      </div>

      {/* Summary stats */}
      <div className="flex gap-4 t-caption text-[var(--brand-text)]">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[var(--radius-pill)] bg-teal-500" />
          {entries.reduce((n, e) => n + e.copyStatus.clientReviewSections, 0)} awaiting your review
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[var(--radius-pill)] bg-emerald-500" />
          {entries.reduce((n, e) => n + e.copyStatus.approvedSections, 0)} approved
        </span>
      </div>

      {/* Entry list grouped by blueprint */}
      {Object.entries(grouped).map(([bpId, { blueprintName, items }]) => (
        <div key={bpId} className="space-y-3">
          <h3 className="t-caption font-medium text-[var(--brand-text-muted)] uppercase tracking-wide">{blueprintName}</h3>
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
          <FileText className="w-4 h-4 text-[var(--brand-text)] shrink-0" />
          <div className="min-w-0">
            <span className="t-body font-medium text-[var(--brand-text-bright)] block truncate">{entry.name}</span>
            <span className="t-caption text-[var(--brand-text-muted)]">{pageLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge label={badgeConfig.label} color={badgeConfig.color} />
          {/* Progress indicator — both fraction and bar use totalSections as denominator */}
          {copyStatus.totalSections > 0 && (
            <span className="t-caption text-[var(--brand-text-muted)]">
              {copyStatus.approvedSections}/{copyStatus.totalSections}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-[var(--brand-text-muted)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--brand-text-muted)]" />
          )}
        </div>
      </button>

      {/* Approval progress bar */}
      {copyStatus.totalSections > 0 && (
        <div className="mt-3">
          <div className="w-full h-1 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-[var(--radius-pill)] transition-all duration-500"
              style={{ width: `${copyStatus.approvalPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded sections */}
      {isExpanded && (
        <div className="mt-4 border-t border-[var(--brand-border)] pt-4">
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
    queryKey: queryKeys.client.copySections(workspaceId, entryId),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copySections(workspaceId, entryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntries(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntriesCount(workspaceId) });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copySections(workspaceId, entryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntries(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.copyEntriesCount(workspaceId) });
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
        <AlertCircle className="w-5 h-5 text-accent-danger" />
        <p className="t-caption text-[var(--brand-text)]">Could not load sections.</p>
        <button
          onClick={() => refetch()}
          className="t-caption text-accent-brand hover:text-accent-brand transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <p className="t-caption text-[var(--brand-text-muted)] py-4 text-center">
        No sections are ready for review yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="flex items-center gap-2 t-caption text-accent-danger bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
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
    <div className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] p-4 space-y-3 bg-[var(--surface-2)]/50">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PenLine className="w-3.5 h-3.5 text-[var(--brand-text)] shrink-0" />
          <span className="t-caption font-medium text-[var(--brand-text)]">{sectionLabel}</span>
        </div>
        <Badge label={badgeConfig.label} color={badgeConfig.color} />
      </div>

      {/* Copy text */}
      {section.generatedCopy && (
        <div className="t-body text-[var(--brand-text)] leading-relaxed whitespace-pre-wrap bg-[var(--surface-3)]/30 rounded p-3">
          {section.generatedCopy}
        </div>
      )}

      {/* AI annotation (context for client — why this section was written this way) */}
      {section.aiAnnotation && (
        <div className="t-caption text-[var(--brand-text-muted)] italic border-l-2 border-[var(--brand-border)] pl-2">
          {section.aiAnnotation}
        </div>
      )}

      {/* Previous suggestions */}
      {section.clientSuggestions && section.clientSuggestions.length > 0 && (
        <div className="space-y-2">
          <span className="t-caption font-medium text-[var(--brand-text-muted)]">Your previous suggestions</span>
          {section.clientSuggestions.map((s, i) => (
            <div key={i} className="t-caption bg-[var(--surface-3)]/50 rounded p-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3 text-[var(--brand-text-muted)]" />
                <span className="text-[var(--brand-text)]">
                  {s.status === 'pending' ? 'Pending review' :
                   s.status === 'accepted' ? 'Accepted' :
                   s.status === 'rejected' ? 'Not applied' :
                   'Modified'}
                </span>
              </div>
              <p className="text-[var(--brand-text)] line-through">{s.originalText.slice(0, 100)}{s.originalText.length > 100 ? '...' : ''}</p>
              <p className="text-[var(--brand-text-bright)]">{s.suggestedText.slice(0, 100)}{s.suggestedText.length > 100 ? '...' : ''}</p>
              {s.reviewNote && (
                <p className="text-[var(--brand-text-muted)] italic">{s.reviewNote}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons (only for sections in client_review) */}
      {isReviewable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="primary"
            onClick={onApprove}
            disabled={isApproving}
            loading={isApproving}
            className="flex items-center gap-1.5 t-caption px-3 py-1.5"
          >
            {!isApproving && <Check className="w-3 h-3" />}
            Approve
          </Button>
          <button
            onClick={() => setShowSuggestForm(!showSuggestForm)}
            className="flex items-center gap-1.5 t-caption px-3 py-1.5 rounded border border-[var(--brand-border)] text-[var(--brand-text)] hover:border-[var(--brand-border-hover)] hover:text-[var(--brand-text-bright)] transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            Suggest Changes
          </button>
        </div>
      )}

      {/* Approved confirmation */}
      {isApproved && (
        <div className="flex items-center gap-1.5 t-caption text-accent-success">
          <Check className="w-3.5 h-3.5" />
          <span>This section is approved and ready to go.</span>
        </div>
      )}

      {/* Suggestion form */}
      {showSuggestForm && isReviewable && (
        <div className="border-t border-[var(--brand-border)] pt-3 space-y-2">
          <label className="t-caption text-[var(--brand-text)] block">
            How would you like this section to read?
          </label>
          <textarea
            value={suggestedText}
            onChange={e => setSuggestedText(e.target.value)}
            placeholder="Type your suggested version here..."
            rows={4}
            className="w-full t-body bg-[var(--surface-3)] border border-[var(--brand-border)] rounded p-2 text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:border-teal-600 focus:outline-none resize-y"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleSubmitSuggestion}
              disabled={!suggestedText.trim() || isSuggesting}
              loading={isSuggesting}
              className="flex items-center gap-1.5 t-caption px-3 py-1.5"
            >
              {!isSuggesting && <MessageSquare className="w-3 h-3" />}
              Submit Suggestion
            </Button>
            <button
              onClick={() => { setShowSuggestForm(false); setSuggestedText(''); }}
              className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
