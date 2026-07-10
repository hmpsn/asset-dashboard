// @ds-rebuilt
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ContentPipelineSlice } from '../../../shared/types/intelligence';
import { Badge, BoardCard, BoardColumn, Icon } from '../ui';
import type { ContentPipelineData } from './ContentPipelineLenses';

type BoardFocus = 'brief' | 'intake';

interface ContentLifecycleBoardProps {
  pipelineData?: ContentPipelineData;
  contentPipeline?: ContentPipelineSlice;
  focus: BoardFocus;
  intakeContent?: ReactNode;
  onOpenIntake: () => void;
  onOpenBriefs: () => void;
  onOpenDrafts: () => void;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function stageClass(isFocused: boolean): string {
  return isFocused ? 'ring-1 ring-[var(--teal)]' : '';
}

export function ContentLifecycleBoard({
  pipelineData,
  contentPipeline,
  focus,
  intakeContent,
  onOpenIntake,
  onOpenBriefs,
  onOpenDrafts,
}: ContentLifecycleBoardProps) {
  const [intakeOpen, setIntakeOpen] = useState(focus === 'intake');
  const queuedRequests = contentPipeline?.requests.pending ?? 0;
  const suggestedBriefs = contentPipeline?.suggestedBriefs ?? 0;
  const activeWorkOrders = contentPipeline?.workOrders.active ?? 0;
  const briefCount = contentPipeline?.briefs.total ?? pipelineData?.summary?.briefs ?? 0;
  const draftCount = contentPipeline?.posts.byStatus.draft ?? 0;
  const reviewCount = contentPipeline?.posts.byStatus.review ?? 0;
  const queuedCount = queuedRequests + suggestedBriefs + activeWorkOrders;

  useEffect(() => {
    setIntakeOpen(focus === 'intake');
  }, [focus]);

  const intakeSummary = useMemo(() => {
    const items = [
      queuedRequests > 0 && pluralize(queuedRequests, 'client request'),
      suggestedBriefs > 0 && pluralize(suggestedBriefs, 'suggested brief'),
      activeWorkOrders > 0 && pluralize(activeWorkOrders, 'active work order'),
    ].filter((item): item is string => Boolean(item));

    return items.length > 0 ? items.join(' · ') : 'New requests and suggestions will appear here.';
  }, [activeWorkOrders, queuedRequests, suggestedBriefs]);

  return (
    <section
      aria-label="Content lifecycle board"
      className="flex flex-col gap-4"
      data-testid="content-pipeline-board"
      data-board-focus={focus}
      data-intake-state={intakeOpen ? 'expanded' : 'collapsed'}
    >
      <details
        open={intakeOpen}
        onToggle={(event) => setIntakeOpen(event.currentTarget.open)}
        className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--teal)]" aria-hidden="true">
            <Icon name="sparkle" size="sm" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block t-ui font-semibold text-[var(--brand-text-bright)]">Intake</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{intakeSummary}</span>
          </span>
          <Badge label={pluralize(queuedCount, 'item')} tone="teal" variant="soft" size="sm" />
          <Icon name={intakeOpen ? 'chevronUp' : 'chevronDown'} size="sm" className="text-[var(--brand-text-muted)]" />
        </summary>
        {intakeOpen && (
          <div className="border-t border-[var(--brand-border)] px-4 py-4">
            {intakeContent}
          </div>
        )}
      </details>

      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="t-page font-semibold text-[var(--brand-text-bright)]">Lifecycle board</h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Follow active content from triage through review. Scheduled and published work stays in its own mode.</p>
        </div>
        <span className="hidden t-caption-sm text-[var(--brand-text-muted)] lg:block">Open a card to continue in its existing workspace.</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[920px] grid-cols-4 gap-3">
          <BoardColumn
            id="content-pipeline-board-stage-queued"
            title="Queued"
            count={queuedCount}
            accent="var(--amber)"
            empty="Nothing is waiting to be triaged."
            className={stageClass(focus === 'intake')}
          >
            {queuedRequests > 0 && (
              <BoardCard title={pluralize(queuedRequests, 'client request')} meta="Ready to turn into a brief" onClick={onOpenIntake}>
                <span className="t-caption-sm text-[var(--teal)]">Review intake</span>
              </BoardCard>
            )}
            {suggestedBriefs > 0 && (
              <BoardCard title={pluralize(suggestedBriefs, 'suggested brief')} meta="Generated from current workspace signals" onClick={onOpenIntake}>
                <span className="t-caption-sm text-[var(--teal)]">Review intake</span>
              </BoardCard>
            )}
            {activeWorkOrders > 0 && (
              <BoardCard title={pluralize(activeWorkOrders, 'active work order')} meta="Strategy work is ready for production context" onClick={onOpenIntake}>
                <span className="t-caption-sm text-[var(--teal)]">Review intake</span>
              </BoardCard>
            )}
          </BoardColumn>

          <div data-testid="content-pipeline-board-stage-brief">
            <BoardColumn
              id="content-pipeline-board-stage-brief"
              title="Brief"
              count={briefCount}
              accent="var(--blue)"
              empty="No briefs are ready to open."
              className={stageClass(focus === 'brief')}
            >
              {briefCount > 0 && (
                <BoardCard title={pluralize(briefCount, 'brief')} meta="Briefs stay in the existing brief workspace" onClick={onOpenBriefs}>
                  <span className="t-caption-sm text-[var(--teal)]">Open briefs</span>
                </BoardCard>
              )}
            </BoardColumn>
          </div>

          <BoardColumn
            id="content-pipeline-board-stage-draft"
            title="Draft"
            count={draftCount}
            accent="var(--teal)"
            empty="No drafts are in progress."
          >
            {draftCount > 0 && (
              <BoardCard title={pluralize(draftCount, 'draft')} meta="Draft status comes from the current posts workspace" onClick={onOpenDrafts}>
                <span className="t-caption-sm text-[var(--teal)]">Open drafts</span>
              </BoardCard>
            )}
          </BoardColumn>

          <BoardColumn
            id="content-pipeline-board-stage-review"
            title="Review"
            count={reviewCount}
            accent="var(--emerald)"
            empty="No drafts are marked for review."
          >
            {reviewCount > 0 && (
              <BoardCard title={pluralize(reviewCount, 'draft')} meta="Review actions stay with the current posts workspace" onClick={onOpenDrafts}>
                <span className="t-caption-sm text-[var(--teal)]">Open drafts</span>
              </BoardCard>
            )}
          </BoardColumn>
        </div>
      </div>
    </section>
  );
}
