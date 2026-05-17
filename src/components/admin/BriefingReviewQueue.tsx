import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, Send, X, RefreshCw, Check, FileText, Star } from 'lucide-react';
import {
  useBriefingDrafts,
  useApproveBriefing,
  usePublishBriefing,
  useSkipBriefing,
  useGenerateBriefingNow,
} from '../../hooks/admin/useBriefingDrafts';
import { SectionCard, Badge, EmptyState, ErrorState, LoadingState, Icon, Button, ClickableRow, FormInput, Modal } from '../ui';
import type { BriefingCategory, BriefingDraft, BriefingDraftStatus } from '../../../shared/types/briefing';

function statusColor(s: BriefingDraftStatus): 'teal' | 'emerald' | 'zinc' {
  if (s === 'draft') return 'teal';
  if (s === 'approved' || s === 'published') return 'emerald';
  return 'zinc'; // skipped
}

// Mirrors the client-side SecondaryStoryRow category-color map so admins
// preview-review with the same palette the client will see. Title-cased
// labels read better than the raw enum values ("Period change" vs
// "period_change"). Mirrors the legacy InsightsDigest severity → color
// pattern (the old cards' source of truth) for win/risk/opportunity.
const CATEGORY_BADGE: Record<BriefingCategory, { label: string; color: 'emerald' | 'amber' | 'blue' | 'teal' }> = {
  win:           { label: 'Win',          color: 'emerald' },
  risk:          { label: 'Risk',         color: 'amber'   },
  opportunity:   { label: 'Opportunity',  color: 'blue'    },
  competitive:   { label: 'Competitive',  color: 'teal'    },
  period_change: { label: 'Period change', color: 'blue'   },
};

interface BriefingReviewQueueProps {
  workspaceId: string;
}

export function BriefingReviewQueue({ workspaceId }: BriefingReviewQueueProps) {
  const {
    data: drafts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useBriefingDrafts(workspaceId);
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
    <Button
      onClick={() => genM.mutate()}
      disabled={genM.isPending}
      icon={RefreshCw}
      size="sm"
      variant="secondary"
      className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-600/10 text-accent-brand hover:bg-teal-600/20 border border-teal-600/30 disabled:opacity-50"
    >
      Generate now
    </Button>
  );

  if (isLoading) {
    return (
      <SectionCard title="Weekly Briefings" titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />} action={generateNowAction}>
        <LoadingState message="Loading briefings..." />
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Weekly Briefings" titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />} action={generateNowAction}>
        <ErrorState
          title="Couldn't load briefings"
          message={error instanceof Error ? error.message : 'Try refetching, or check the server logs if the issue persists.'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Weekly Briefings" titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />} action={generateNowAction}>
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
                <ClickableRow
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
                    <Badge label={d.status} tone={statusColor(d.status)} />
                    <span className="t-caption text-[var(--brand-text-muted)]">
                      {d.stories.length} {d.stories.length === 1 ? 'story' : 'stories'}
                    </span>
                  </div>
                  <span className="t-caption text-[var(--brand-text-muted)] flex-shrink-0 ml-3">
                    {new Date(d.updatedAt).toLocaleString()}
                  </span>
                </ClickableRow>

                {isExpanded && (
                  <div className="border-t border-[var(--brand-border)] p-3 space-y-3 bg-[var(--surface-3)]">
                    {d.stories.map(s => {
                      const cat = CATEGORY_BADGE[s.category];
                      return (
                      <div key={s.id} className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge label={cat.label} tone={cat.color} />
                          {s.isHeadline && (
                            <Icon as={Star} size="sm" className="text-accent-brand" aria-label="Headline story" />
                          )}
                        </div>
                        <div className="t-body text-[var(--brand-text-bright)] font-medium">{s.headline}</div>
                        <div className="t-caption text-[var(--brand-text)]">{s.narrative}</div>
                      </div>
                      );
                    })}

                    {!isTerminal && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--brand-border)]">
                        {d.status === 'draft' && (
                          <Button
                            onClick={() => approveM.mutate({ draftId: d.id })}
                            disabled={approveM.isPending}
                            icon={Check}
                            size="sm"
                            variant="secondary"
                            className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-emerald-500/10 text-accent-success hover:bg-emerald-500/20 border border-emerald-500/20 disabled:opacity-50"
                          >
                            Approve
                          </Button>
                        )}
                        <Button
                          onClick={() => publishM.mutate({ draftId: d.id })}
                          disabled={publishM.isPending}
                          icon={Send}
                          size="sm"
                          variant="secondary"
                          className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-teal-600/15 text-accent-brand hover:bg-teal-600/25 border border-teal-600/30 disabled:opacity-50"
                        >
                          Publish
                        </Button>
                        <Button
                          onClick={() => {
                            setSkipping(d.id);
                            setSkipNote('');
                          }}
                          icon={X}
                          size="sm"
                          variant="secondary"
                          className="t-caption px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] border border-[var(--brand-border)]"
                        >
                          Skip
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Skip confirmation modal — uses <Modal> + <Button> primitives */}
      <Modal open={skipping !== null} onClose={() => setSkipping(null)} size="sm">
        <Modal.Header title="Skip this briefing?" onClose={() => setSkipping(null)} />
        <Modal.Body>
          <p className="t-body text-[var(--brand-text)] mb-4">
            Skipped briefings are not published to the client. This is terminal — the briefing for this week cannot be un-skipped. Note your reason:
          </p>
          <FormInput
            value={skipNote}
            onChange={setSkipNote}
            className="w-full px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-1)] border border-[var(--brand-border)] t-body text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500/50"
            placeholder="e.g. quiet week, low confidence in stories"
            autoFocus
          />
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setSkipping(null)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!skipNote.trim() || skipM.isPending}
            loading={skipM.isPending}
            onClick={() => {
              if (skipping && skipNote.trim()) {
                skipM.mutate({ draftId: skipping, adminNote: skipNote.trim() });
                setSkipping(null);
              }
            }}
          >
            Skip
          </Button>
        </Modal.Footer>
      </Modal>
    </SectionCard>
  );
}
