/**
 * SchemaReviewTab — Client-facing schema plan review.
 * Simplified view of the admin's SchemaSuggester: shows page roles,
 * schema types, and lets clients approve or request changes at the plan level.
 */
import { useState, useEffect } from 'react';
import { getOptional, post } from '../../api/client';
import { EmptyState } from '../ui';
import {
  Loader2, CheckCircle, Globe, ChevronDown, ChevronRight,
  MessageSquare, Sparkles, Shield,
} from 'lucide-react';
import type { SchemaSitePlan, SchemaPageRole } from '../../../shared/types/schema-plan';
import { SCHEMA_ROLE_LABELS, SCHEMA_ROLE_CLIENT_DESC } from '../../../shared/types/schema-plan';

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
  homepage: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pillar: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  service: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  audience: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'lead-gen': 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  blog: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  about: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  contact: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  location: 'bg-green-500/15 text-green-300 border-green-500/30',
  product: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  partnership: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  faq: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'case-study': 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  comparison: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  generic: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/30',
};
const DEFAULT_ROLE_COLOR = 'bg-zinc-500/10 text-zinc-400 border-zinc-600/30';

export function SchemaReviewTab({ workspaceId, setToast }: Props) {
  const [plan, setPlan] = useState<SchemaSitePlan | null>(null);
  const [snapshot, setSnapshot] = useState<SchemaSnapshotSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [planData, snapData] = await Promise.all([
          getOptional<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}`),
          getOptional<SchemaSnapshotSummary>(`/api/public/schema-snapshot/${workspaceId}`),
        ]);
        if (!cancelled) {
          setPlan(planData ?? null);
          setSnapshot(snapData ?? null);
        }
      } catch (err) {
        console.error('SchemaReviewTab load error:', err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const handleFeedback = async (action: 'approve' | 'request_changes') => {
    setSubmitting(true);
    try {
      const result = await post<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}/feedback`, {
        action,
        note: feedbackNote.trim() || undefined,
      });
      setPlan(result);
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
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
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
      draft: { label: 'Awaiting Review', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
      sent_to_client: { label: 'Ready for Review', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
      client_approved: { label: 'Approved', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
      client_changes_requested: { label: 'Changes Requested', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
      active: { label: 'Active', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
    };
    const s = map[status] || map.draft;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border ${s.cls}`}>{s.label}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-teal-400" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Schema Strategy Review</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Review the structured data plan for your website. This determines how your pages appear in Google search results.
          </p>
        </div>
      </div>

      {/* What is schema — education blurb */}
      <div className="bg-zinc-900/50 border border-zinc-800 px-5 py-4" style={{ borderRadius: '6px 12px 6px 12px' }}>
        <div className="flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
          <div className="text-xs text-zinc-400 leading-relaxed">
            <strong className="text-zinc-300">What is structured data?</strong> It's code added to your website that helps Google understand your content better.
            This can lead to enhanced search results (rich snippets) — like star ratings, FAQ dropdowns, product info,
            and company details appearing directly in Google. Each page type gets different markup to maximize your search visibility.
          </div>
        </div>
      </div>

      {/* Plan status + actions */}
      {plan && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-200">Your Schema Plan</span>
              {statusBadge(plan.status)}
            </div>
            <span className="text-[11px] text-zinc-500">
              {plan.pageRoles.length} pages · {plan.canonicalEntities.length} entities
            </span>
          </div>

          {/* Summary stats */}
          <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50">
            <div className="flex flex-wrap gap-2">
              {Object.entries(roleGroups)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([role, pages]) => (
                  <span
                    key={role}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${ROLE_COLORS[role as SchemaPageRole] ?? DEFAULT_ROLE_COLOR}`}
                  >
                    {SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role} ({pages.length})
                  </span>
                ))}
            </div>
          </div>

          {/* Page roles grouped by type */}
          <div className="divide-y divide-zinc-800/50">
            {Object.entries(roleGroups)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([role, pages]) => {
                const isExpanded = expandedRoles.has(role);
                const desc = SCHEMA_ROLE_CLIENT_DESC[role as SchemaPageRole] || '';
                return (
                  <div key={role}>
                    <button
                      onClick={() => toggleRole(role)}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-zinc-800/30 transition-colors text-left"
                    >
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${ROLE_COLORS[role as SchemaPageRole] ?? DEFAULT_ROLE_COLOR}`}>
                        {SCHEMA_ROLE_LABELS[role as SchemaPageRole] || role}
                      </span>
                      <span className="text-xs text-zinc-400 flex-1 min-w-0 truncate">{desc}</span>
                      <span className="text-[11px] text-zinc-500 shrink-0">{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-5 pb-3 pl-12 space-y-1">
                        {pages.map(pr => (
                          <div key={pr.pagePath} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-zinc-800/30">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-zinc-300 truncate">{pr.pageTitle}</div>
                              <div className="text-[10px] text-zinc-500 truncate">{pr.pagePath}</div>
                            </div>
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0">{pr.primaryType}</span>
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
            <div className="px-5 py-3 border-t border-zinc-800">
              <div className="text-[11px] text-zinc-500 font-medium mb-2">Site Entities</div>
              <div className="flex flex-wrap gap-2">
                {plan.canonicalEntities.map((entity, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-zinc-800/50 border border-zinc-700">
                    <span className="text-teal-400 font-mono text-[10px]">{entity.type}</span>
                    <span className="text-zinc-300">{entity.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Approve / Request Changes */}
          {(plan.status === 'sent_to_client' || plan.status === 'draft') && (
            <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-900/50">
              {showFeedback ? (
                <div className="space-y-3">
                  <textarea
                    value={feedbackNote}
                    onChange={e => setFeedbackNote(e.target.value)}
                    placeholder="What changes would you like? (optional)"
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFeedback('request_changes')}
                      disabled={submitting}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50"
                    >
                      {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                      Send Feedback
                    </button>
                    <button
                      onClick={() => { setShowFeedback(false); setFeedbackNote(''); }}
                      className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
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
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Approve Strategy
                  </button>
                  <button
                    onClick={() => setShowFeedback(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Request Changes
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Already approved / active */}
          {plan.status === 'client_approved' && (
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" /> You approved this strategy. Your agency is implementing it.
            </div>
          )}
          {plan.status === 'active' && (
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" /> This schema strategy is live on your website.
            </div>
          )}
          {plan.status === 'client_changes_requested' && (
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2 text-xs text-amber-400">
              <MessageSquare className="w-3.5 h-3.5" /> Your feedback has been sent. Your agency is reviewing your notes.
            </div>
          )}

          {/* Metadata */}
          <div className="px-5 py-2 border-t border-zinc-800/50 text-[10px] text-zinc-600 flex items-center gap-3">
            <span>Created {new Date(plan.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {plan.updatedAt !== plan.generatedAt && (
              <span>Updated {new Date(plan.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </div>
        </div>
      )}

      {/* Schema snapshot summary (if no plan but snapshot exists) */}
      {!plan && snapshot && (
        <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-200">Schema Analysis</span>
            </div>
            <span className="text-[11px] text-zinc-500">
              {snapshot.pageCount} pages analyzed · {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <div className="divide-y divide-zinc-800/50">
            {snapshot.pages.map(page => (
              <div key={page.pageId} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-300 truncate">{page.pageTitle}</div>
                  <div className="text-[10px] text-zinc-500 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {page.existingSchemas.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                      {page.existingSchemas.length} live
                    </span>
                  )}
                  {page.schemaTypes.map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 font-mono">
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
