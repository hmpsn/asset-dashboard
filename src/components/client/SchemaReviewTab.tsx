/**
 * SchemaReviewTab — Client-facing schema plan review.
 * Simplified view of the admin's SchemaSuggester: shows page roles,
 * schema types, and lets clients approve or request changes at the plan level.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOptional, post } from '../../api/client';
import { EmptyState, Icon} from '../ui';
import {
  Loader2, CheckCircle, Globe, ChevronDown, ChevronRight,
  MessageSquare, Sparkles, Shield,
} from 'lucide-react';
import type { SchemaSitePlan, SchemaPageRole } from '../../../shared/types/schema-plan';
import { SCHEMA_ROLE_LABELS, SCHEMA_ROLE_CLIENT_DESC } from '../../../shared/types/schema-plan';
import { queryKeys } from '../../lib/queryKeys';

interface SchemaSnapshotPage {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  schemaTypes: string[];
  priority: 'high' | 'medium' | 'low';
}

interface SchemaSnapshotSummary {
  pages: SchemaSnapshotPage[];
  pageCount: number;
  createdAt: string;
}

interface Props {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

const ROLE_COLORS: Partial<Record<SchemaPageRole, string>> = {
  homepage: 'bg-amber-500/15 text-accent-warning border-amber-500/30',
  pillar: 'bg-teal-500/15 text-accent-brand border-teal-500/30',
  service: 'bg-blue-500/15 text-accent-info border-blue-500/30',
  audience: 'bg-blue-500/15 text-accent-info border-blue-500/30',
  'lead-gen': 'bg-teal-500/15 text-accent-brand border-teal-500/30',
  blog: 'bg-blue-500/15 text-accent-info border-blue-500/30',
  about: 'bg-[var(--surface-3)]/15 text-[var(--brand-text)] border-[var(--brand-border)]/30',
  contact: 'bg-[var(--surface-3)]/15 text-[var(--brand-text)] border-[var(--brand-border)]/30',
  location: 'bg-emerald-500/15 text-accent-success border-emerald-500/30',
  product: 'bg-emerald-500/15 text-accent-success border-emerald-500/30',
  partnership: 'bg-amber-500/15 text-accent-warning border-amber-500/30',
  faq: 'bg-blue-500/15 text-accent-info border-blue-500/30',
  'case-study': 'bg-blue-500/15 text-accent-info border-blue-500/30',
  comparison: 'bg-amber-500/15 text-accent-warning border-amber-500/30',
  generic: 'bg-[var(--surface-3)]/10 text-[var(--brand-text-muted)] border-[var(--brand-border-strong)]/30',
};
const DEFAULT_ROLE_COLOR = 'bg-[var(--surface-3)]/10 text-[var(--brand-text-muted)] border-[var(--brand-border-strong)]/30';

export function SchemaReviewTab({ workspaceId, setToast }: Props) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const planQuery = useQuery({
    queryKey: queryKeys.client.schemaPlan(workspaceId),
    queryFn: () => getOptional<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const snapshotQuery = useQuery({
    queryKey: queryKeys.client.schemaSnapshot(workspaceId),
    queryFn: () => getOptional<SchemaSnapshotSummary>(`/api/public/schema-snapshot/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const plan = planQuery.data ?? null;
  const snapshot = snapshotQuery.data ?? null;
  const loading = planQuery.isLoading || snapshotQuery.isLoading;

  const handleFeedback = async (action: 'approve' | 'request_changes') => {
    setSubmitting(true);
    try {
      const result = await post<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}/feedback`, {
        action,
        note: feedbackNote.trim() || undefined,
      });
      queryClient.setQueryData(queryKeys.client.schemaPlan(workspaceId), result);
      setShowFeedback(false);
      setFeedbackNote('');
      setToast({
        message: action === 'approve'
          ? 'Schema strategy approved! Your agency will begin implementation.'
          : 'Feedback sent. Your agency will review your notes.',
        type: 'success',
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to submit feedback', type: 'error' });
    }
    setSubmitting(false);
  };

  const toggleRole = (role: string) => {
    setExpandedRoles(prev => {
      const n = new Set(prev);
      if (n.has(role)) n.delete(role); else n.add(role);
      return n;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Icon as={Loader2} size="lg" className="animate-spin text-accent-brand" />
      </div>
    );
  }

  // No plan — nothing to review (snapshot alone is stale data from a retracted plan)
  if (!plan) {
    return (
      <EmptyState icon={Globe} title="No schema strategy yet" description="Your agency will create a structured data strategy for your site. Once ready, you'll be able to review it here." />
    );
  }

  // Group pages by role if plan exists
  const roleGroups: Record<string, typeof plan extends null ? never : NonNullable<typeof plan>['pageRoles']> = {};
  if (plan) {
    for (const pr of plan.pageRoles) {
      if (!roleGroups[pr.role]) roleGroups[pr.role] = [];
      roleGroups[pr.role].push(pr);
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      draft: { label: 'Awaiting Review', cls: 'bg-amber-500/15 text-accent-warning border-amber-500/30' },
      sent_to_client: { label: 'Ready for Review', cls: 'bg-teal-500/15 text-accent-brand border-teal-500/30' },
      client_approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-accent-success border-emerald-500/30' },
      client_changes_requested: { label: 'Changes Requested', cls: 'bg-amber-500/15 text-accent-warning border-amber-500/30' },
      active: { label: 'Active', cls: 'bg-emerald-500/15 text-accent-success border-emerald-500/30' },
    };
    const s = map[status] || map.draft;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-[var(--radius-pill)] t-caption-sm font-medium border ${s.cls}`}>{s.label}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Icon as={Shield} size="lg" className="text-accent-brand" />
        <div>
          <h2 className="t-h2 text-[var(--brand-text)]">Schema Strategy Review</h2>
          <p className="t-body text-[var(--brand-text-muted)] mt-1">
            Review the structured data plan for your website. This determines how your pages appear in Google search results.
          </p>
        </div>
      </div>

      {/* What is schema — education blurb */}
      <div className="bg-[var(--surface-2)]/50 border border-[var(--brand-border)] px-5 py-4" style={{ borderRadius: 'var(--radius-signature)' }}>
        <div className="flex items-start gap-3">
          <Icon as={Sparkles} size="md" className="text-accent-brand mt-0.5 shrink-0" />
          <div className="t-caption text-[var(--brand-text-muted)] leading-relaxed">
            <strong className="text-[var(--brand-text)]">What is structured data?</strong> It's code added to your website that helps Google understand your content better.
            This can lead to enhanced search results (rich snippets) — like star ratings, FAQ dropdowns, product info,
            and company details appearing directly in Google. Each page type gets different markup to maximize your search visibility.
          </div>
        </div>
      </div>

      {/* Plan status + actions */}
      {plan && (
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon as={Globe} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">Your Schema Plan</span>
              {statusBadge(plan.status)}
            </div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {plan.pageRoles.length} pages · {plan.canonicalEntities.length} entities
            </span>
          </div>

          {/* Summary stats */}
          <div className="px-5 py-3 border-t border-[var(--brand-border)] bg-[var(--surface-2)]/50">
            <div className="flex flex-wrap gap-2">
              {Object.entries(roleGroups)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([role, pages]) => (
                  <span
                    key={role}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-pill)] t-caption-sm font-medium border ${ROLE_COLORS[role as SchemaPageRole] ?? DEFAULT_ROLE_COLOR}`}
                  >
                    {SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role} ({pages.length})
                  </span>
                ))}
            </div>
          </div>

          {/* Page roles grouped by type */}
          <div className="divide-y divide-[var(--brand-border)]/50">
            {Object.entries(roleGroups)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([role, pages]) => {
                const isExpanded = expandedRoles.has(role);
                const desc = SCHEMA_ROLE_CLIENT_DESC[role as SchemaPageRole] || '';
                return (
                  <div key={role}>
                    <button
                      onClick={() => toggleRole(role)}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-[var(--surface-3)]/30 transition-colors text-left"
                    >
                      {isExpanded
                        ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
                        : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] shrink-0" />}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded t-caption-sm font-medium border ${ROLE_COLORS[role as SchemaPageRole] ?? DEFAULT_ROLE_COLOR}`}>
                        {SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role}
                      </span>
                      <span className="t-caption text-[var(--brand-text-muted)] flex-1 min-w-0 truncate">{desc}</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)] shrink-0">{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-5 pb-3 pl-12 space-y-1">
                        {pages.map(pr => (
                          <div key={pr.pagePath} className="flex items-center gap-3 py-1.5 px-3 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/30">
                            <div className="flex-1 min-w-0">
                              <div className="t-caption text-[var(--brand-text)] truncate">{pr.pageTitle}</div>
                              <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{pr.pagePath}</div>
                            </div>
                            <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono shrink-0">{pr.primaryType}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Entities */}
          {plan.canonicalEntities.length > 0 && (
            <div className="px-5 py-3 border-t border-[var(--brand-border)]">
              <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium mb-2">Site Entities</div>
              <div className="flex flex-wrap gap-2">
                {plan.canonicalEntities.map((entity, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-lg)] t-caption-sm bg-[var(--surface-3)]/50 border border-[var(--brand-border-strong)]">
                    <span className="text-accent-brand font-mono t-caption-sm">{entity.type}</span>
                    <span className="text-[var(--brand-text)]">{entity.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Approve / Request Changes */}
          {plan.status === 'sent_to_client' && (
            <div className="px-5 py-4 border-t border-[var(--brand-border)] bg-[var(--surface-2)]/50">
              {showFeedback ? (
                <div className="space-y-3">
                  <textarea
                    value={feedbackNote}
                    onChange={e => setFeedbackNote(e.target.value)}
                    placeholder="What changes would you like? (optional)"
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500 resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFeedback('request_changes')}
                      disabled={submitting}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-lg)] t-caption font-medium bg-amber-600/20 hover:bg-amber-600/30 text-accent-warning border border-amber-500/30 transition-colors disabled:opacity-50"
                    >
                      {submitting ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={MessageSquare} size="sm" />}
                      Send Feedback
                    </button>
                    <button
                      onClick={() => { setShowFeedback(false); setFeedbackNote(''); }}
                      className="px-3 py-2 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleFeedback('approve')}
                    disabled={submitting}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-[var(--radius-lg)] t-body font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
                  >
                    {submitting ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={CheckCircle} size="md" />}
                    Approve Strategy
                  </button>
                  <button
                    onClick={() => setShowFeedback(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-[var(--radius-lg)] t-body font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text)] border border-[var(--brand-border-strong)] transition-colors"
                  >
                    <Icon as={MessageSquare} size="md" /> Request Changes
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Already approved / active */}
          {plan.status === 'client_approved' && (
            <div className="px-5 py-3 border-t border-[var(--brand-border)] flex items-center gap-2 t-caption text-accent-success">
              <Icon as={CheckCircle} size="md" /> You approved this strategy. Your agency is implementing it.
            </div>
          )}
          {plan.status === 'active' && (
            <div className="px-5 py-3 border-t border-[var(--brand-border)] flex items-center gap-2 t-caption text-accent-success">
              <Icon as={CheckCircle} size="md" /> This schema strategy is live on your website.
            </div>
          )}
          {plan.status === 'client_changes_requested' && (
            <div className="px-5 py-3 border-t border-[var(--brand-border)] flex items-center gap-2 t-caption text-accent-warning">
              <Icon as={MessageSquare} size="md" /> Your feedback has been sent. Your agency is reviewing your notes.
            </div>
          )}

          {/* Metadata */}
          <div className="px-5 py-2 border-t border-[var(--brand-border)]/50 t-caption-sm text-[var(--brand-text-faint)] flex items-center gap-3">
            <span>Created {new Date(plan.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {plan.updatedAt !== plan.generatedAt && (
              <span>Updated {new Date(plan.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </div>
        </div>
      )}

      {/* Schema snapshot summary (if no plan but snapshot exists) */}
      {!plan && snapshot && (
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon as={Globe} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">Schema Analysis</span>
            </div>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {snapshot.pageCount} pages analyzed · {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <div className="divide-y divide-[var(--brand-border)]/50">
            {snapshot.pages.map(page => (
              <div key={page.pageId} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="t-caption text-[var(--brand-text)] truncate">{page.pageTitle}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {page.existingSchemas.length > 0 && (
                    <span className="t-caption-sm px-1.5 py-0.5 rounded bg-emerald-500/10 text-accent-success border border-emerald-500/20">
                      {page.existingSchemas.length} live
                    </span>
                  )}
                  {page.schemaTypes.map(t => (
                    <span key={t} className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-accent-brand border border-teal-500/20 font-mono">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
