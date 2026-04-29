import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Send, X, RefreshCw, Check, FileText } from 'lucide-react';
import {
  useBriefingDrafts,
  useApproveBriefing,
  usePublishBriefing,
  useSkipBriefing,
  useGenerateBriefingNow,
} from '../../hooks/admin/useBriefingDrafts';
import { SectionCard, Badge, EmptyState, LoadingState, Icon } from '../ui';
import type { BriefingDraft, BriefingDraftStatus } from '../../../shared/types/briefing';

function statusColor(s: BriefingDraftStatus): 'teal' | 'emerald' | 'zinc' {
  if (s === 'draft') return 'teal';
  if (s === 'approved' || s === 'published') return 'emerald';
  return 'zinc'; // skipped
}

interface BriefingReviewQueueProps {
  workspaceId: string;
}

export function BriefingReviewQueue({ workspaceId }: BriefingReviewQueueProps) {
  const { data: drafts = [], isLoading } = useBriefingDrafts(workspaceId);
  const approveM = useApproveBriefing(workspaceId);
  const publishM = usePublishBriefing(workspaceId);
  const skipM = useSkipBriefing(workspaceId);
  const genM = useGenerateBriefingNow(workspaceId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [skipping, setSkipping] = useState<string | null>(null);
  const [skipNote, setSkipNote] = useState('');

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generateNowAction = (
    <button
      onClick={() => genM.mutate()}
      disabled={genM.isPending}
      className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-600/10 text-teal-400 hover:bg-teal-600/20 border border-teal-600/30 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
    >
      <Icon as={RefreshCw} size="sm" />
      Generate now
    </button>
  );

  if (isLoading) {
    return (
      <SectionCard title="Weekly Briefings" titleIcon={<Icon as={Sparkles} size="md" className="text-teal-400" />} action={generateNowAction}>
        <LoadingState message="Loading briefings..." />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Weekly Briefings" titleIcon={<Icon as={Sparkles} size="md" className="text-teal-400" />} action={generateNowAction}>
      {drafts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No briefings yet"
          description="Runs Mondays at 14:00 UTC"
        />
      ) : (
        <div className="space-y-2">
          {drafts.map((d: BriefingDraft) => {
            const isExpanded = expanded.has(d.id);
            const isTerminal = d.status === 'published' || d.status === 'skipped';
            return (
              <div key={d.id} className="border border-[var(--brand-border)] rounded-[var(--radius-md)] overflow-hidden">
                <button
                  onClick={() => toggleExpanded(d.id)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--surface-3)] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      as={isExpanded ? ChevronDown : ChevronRight}
                      size="md"
                      className="text-[var(--brand-text-muted)] flex-shrink-0"
                    />
                    <span className="t-body text-[var(--brand-text-bright)]">{d.weekOf}</span>
                    <Badge label={d.status} color={statusColor(d.status)} />
                    <span className="t-caption text-[var(--brand-text-muted)]">
                      {d.stories.length} {d.stories.length === 1 ? 'story' : 'stories'}
                    </span>
                  </div>
                  <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 ml-3">
                    {new Date(d.updatedAt).toLocaleString()}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-[var(--brand-border)] p-3 space-y-3 bg-[var(--surface-3)]">
                    {d.stories.map(s => (
                      <div key={s.id} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge label={s.category} color={s.isHeadline ? 'teal' : 'zinc'} />
                          {s.isHeadline && (
                            <span className="t-caption-sm uppercase tracking-wide text-teal-400 font-medium">
                              Headline
                            </span>
                          )}
                        </div>
                        <div className="t-body text-[var(--brand-text-bright)] font-medium">{s.headline}</div>
                        <div className="t-caption text-[var(--brand-text)]">{s.narrative}</div>
                      </div>
                    ))}

                    {!isTerminal && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--brand-border)]">
                        {d.status === 'draft' && (
                          <button
                            onClick={() => approveM.mutate({ draftId: d.id })}
                            disabled={approveM.isPending}
                            className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                          >
                            <Icon as={Check} size="sm" />
                            Approve
                          </button>
                        )}
                        <button
                          onClick={() => publishM.mutate({ draftId: d.id })}
                          disabled={publishM.isPending}
                          className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-600/15 text-teal-400 hover:bg-teal-600/25 border border-teal-600/30 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <Icon as={Send} size="sm" />
                          Publish
                        </button>
                        <button
                          onClick={() => {
                            setSkipping(d.id);
                            setSkipNote('');
                          }}
                          className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] border border-[var(--brand-border)] inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Icon as={X} size="sm" />
                          Skip
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Skip confirmation modal — inline because ConfirmDialog only accepts a plain string `message` prop */}
      {skipping !== null && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
          style={{ background: 'var(--brand-overlay, rgba(15,23,42,0.35))' }}
          onClick={() => setSkipping(null)}
        >
          <div
            className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-6 w-full max-w-sm mx-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="t-body font-semibold text-[var(--brand-text-bright)] mb-2">Skip this briefing?</h3>
            <p className="t-body text-[var(--brand-text)] mb-4">
              Skipped briefings are not published to the client. This is terminal — the briefing for this week cannot be un-skipped. Note your reason:
            </p>
            <input
              value={skipNote}
              onChange={e => setSkipNote(e.target.value)}
              className="w-full px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-1)] border border-[var(--brand-border)] t-body text-[var(--brand-text-bright)] mb-6 focus:outline-none focus:border-teal-500/50"
              placeholder="e.g. quiet week, low confidence in stories"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSkipping(null)}
                className="px-4 py-2 rounded-[var(--radius-lg)] t-body font-medium text-[var(--brand-text)] border border-[var(--brand-border)] hover:bg-[var(--surface-3)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (skipping && skipNote.trim()) {
                    skipM.mutate({ draftId: skipping, adminNote: skipNote.trim() });
                    setSkipping(null);
                  }
                }}
                disabled={!skipNote.trim() || skipM.isPending}
                className="px-4 py-2 rounded-[var(--radius-lg)] t-body font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
