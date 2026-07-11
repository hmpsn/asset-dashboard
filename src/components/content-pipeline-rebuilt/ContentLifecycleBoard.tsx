// @ds-rebuilt
import { useMemo, useState, type ReactNode } from 'react';
import type { ContentBrief, ContentTopicRequest, GeneratedPost } from '../../../shared/types/content';
import { Badge, BoardCard, BoardColumn, Icon, type BadgeTone } from '../ui';

type BoardFocus = 'brief' | 'intake';
export type LifecycleBoardStage = 'queued' | 'brief' | 'draft' | 'review';
export type LifecycleBoardKind = 'brief' | 'post';

export interface LifecycleBoardItem {
  id: string;
  entityId: string;
  kind: LifecycleBoardKind;
  stage: LifecycleBoardStage;
  sourceLabel: string;
  sourceTone: BadgeTone;
  ageLabel: string;
  title: string;
  keyword: string;
  pageType: string;
  statusLabel: string;
  statusTone: BadgeTone;
  detail?: string;
  nextAction: string;
}

export interface LifecycleBoardInputs {
  briefs?: readonly ContentBrief[];
  requests?: readonly ContentTopicRequest[];
  posts?: readonly GeneratedPost[];
}

interface ContentLifecycleBoardProps {
  items: readonly LifecycleBoardItem[];
  focus: BoardFocus;
  intakeCount: number;
  intakeSummary: string;
  intakeContent?: ReactNode;
  onOpenBriefs: () => void;
  onOpenDrafts: () => void;
  onOpenBrief: (briefId: string) => void;
  onOpenPost: (postId: string) => void;
}

function titleCase(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ageLabel(value: string | null | undefined, now: Date): string {
  if (!value) return 'Date unavailable';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const days = Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function briefSource(brief: ContentBrief): { label: string; tone: BadgeTone } {
  if (brief.keywordSource === 'matrix' || brief.keywordSource === 'template') return { label: 'Matrix', tone: 'teal' };
  if (brief.keywordSource === 'gsc' || brief.keywordSource === 'semrush' || brief.keywordSource === 'dataforseo') return { label: 'Keywords', tone: 'blue' };
  if (brief.keywordSource === 'manual') return { label: 'Manual', tone: 'zinc' };
  return { label: 'Brief', tone: 'blue' };
}

function requestSource(request: ContentTopicRequest | undefined): { label: string; tone: BadgeTone } {
  return request?.source === 'client'
    ? { label: 'Client request', tone: 'teal' }
    : { label: 'Strategy', tone: 'blue' };
}

function postDetail(post: GeneratedPost): string {
  if (post.status === 'generating') return 'Generation in progress';
  if (post.status === 'error') return 'Generation needs attention';
  if (post.status === 'review') return `${post.totalWordCount.toLocaleString()} words ready for review`;
  if (post.targetWordCount > 0) {
    const progress = Math.min(100, Math.round((post.totalWordCount / post.targetWordCount) * 100));
    return `${progress}% · ${post.totalWordCount.toLocaleString()}/${post.targetWordCount.toLocaleString()} words`;
  }
  return `${post.totalWordCount.toLocaleString()} words drafted`;
}

/**
 * Builds one board card per active production artifact. A linked request → brief →
 * post chain is represented only by its most advanced persisted artifact.
 */
export function deriveLifecycleBoardItems(inputs: LifecycleBoardInputs, now = new Date()): LifecycleBoardItem[] {
  const briefs = inputs.briefs ?? [];
  const requests = inputs.requests ?? [];
  const posts = inputs.posts ?? [];
  const requestByBrief = new Map(requests.filter((request) => request.briefId).map((request) => [request.briefId!, request]));
  const requestByPost = new Map(requests.filter((request) => request.postId).map((request) => [request.postId!, request]));
  const briefById = new Map(briefs.map((brief) => [brief.id, brief]));
  const postBriefIds = new Set(posts.map((post) => post.briefId).filter(Boolean));
  const items: LifecycleBoardItem[] = [];

  for (const brief of briefs) {
    if (brief.supersededBy || postBriefIds.has(brief.id)) continue;
    const request = requestByBrief.get(brief.id);
    const source = request ? requestSource(request) : briefSource(brief);
    items.push({
      id: `brief:${brief.id}`,
      entityId: brief.id,
      kind: 'brief',
      stage: 'brief',
      sourceLabel: source.label,
      sourceTone: source.tone,
      ageLabel: ageLabel(brief.createdAt, now),
      title: brief.suggestedTitle || brief.targetKeyword || 'Untitled brief',
      keyword: brief.targetKeyword || 'Keyword not set',
      pageType: titleCase(brief.pageType || brief.contentFormat, 'Brief'),
      statusLabel: request?.status === 'client_review' ? 'Client review' : 'Brief ready',
      statusTone: request?.status === 'client_review' ? 'amber' : 'blue',
      detail: `${brief.wordCountTarget.toLocaleString()} word target`,
      nextAction: 'Open brief',
    });
  }

  for (const post of posts) {
    if (post.status === 'approved') continue;
    const request = requestByPost.get(post.id) ?? requestByBrief.get(post.briefId);
    const linkedBrief = briefById.get(post.briefId);
    const source = request ? requestSource(request) : linkedBrief ? briefSource(linkedBrief) : { label: 'Draft', tone: 'blue' as BadgeTone };
    const review = post.status === 'review';
    items.push({
      id: `post:${post.id}`,
      entityId: post.id,
      kind: 'post',
      stage: review ? 'review' : 'draft',
      sourceLabel: source.label,
      sourceTone: source.tone,
      ageLabel: ageLabel(post.updatedAt || post.createdAt, now),
      title: post.title || post.targetKeyword || 'Untitled draft',
      keyword: post.targetKeyword || 'Keyword not set',
      pageType: titleCase(linkedBrief?.pageType ?? request?.pageType, 'Post'),
      statusLabel: review ? 'In review' : titleCase(post.status, 'Draft'),
      statusTone: review ? 'amber' : post.status === 'error' ? 'red' : 'blue',
      detail: postDetail(post),
      nextAction: review ? 'Review draft' : 'Continue draft',
    });
  }

  const stageOrder: Record<LifecycleBoardStage, number> = { queued: 0, brief: 1, draft: 2, review: 3 };
  return items.sort((left, right) => stageOrder[left.stage] - stageOrder[right.stage] || left.title.localeCompare(right.title));
}

function stageClass(isFocused: boolean): string {
  return isFocused ? 'ring-1 ring-[var(--teal)]' : '';
}

function LifecycleItemCard({ item, onOpen }: { item: LifecycleBoardItem; onOpen: () => void }) {
  return (
    <BoardCard onClick={onOpen} className="px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge label={item.sourceLabel} tone={item.sourceTone} variant="soft" size="sm" />
        <span className="t-micro text-[var(--brand-text-dim)]">{item.ageLabel}</span>
      </div>
      <div className="t-ui font-semibold leading-snug text-[var(--brand-text-bright)]">{item.title}</div>
      <div className="mt-2 flex items-start gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
        <Icon name="key" size="sm" className="mt-0.5 shrink-0 text-[var(--brand-text-dim)]" />
        <span className="min-w-0 flex-1 line-clamp-2">{item.keyword}</span>
        <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--surface-1)] px-2 py-0.5 t-micro text-[var(--brand-text-dim)]">{item.pageType}</span>
      </div>
      <div className="mt-3 border-t border-[var(--brand-border)] pt-2.5">
        <div className="flex items-center gap-2">
          <Badge label={item.statusLabel} tone={item.statusTone} variant="outline" size="sm" />
          {item.detail && <span className="min-w-0 flex-1 truncate t-caption-sm text-[var(--brand-text-muted)]">{item.detail}</span>}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 t-caption-sm font-semibold text-[var(--teal)]">
          {item.nextAction}
          <Icon name="arrowRight" size="sm" />
        </div>
      </div>
    </BoardCard>
  );
}

export function ContentLifecycleBoard({
  items,
  focus,
  intakeCount,
  intakeSummary,
  intakeContent,
  onOpenBriefs,
  onOpenDrafts,
  onOpenBrief,
  onOpenPost,
}: ContentLifecycleBoardProps) {
  const [intakeOpen, setIntakeOpen] = useState(focus === 'intake');
  const grouped = useMemo(() => ({
    queued: items.filter((item) => item.stage === 'queued'),
    brief: items.filter((item) => item.stage === 'brief'),
    draft: items.filter((item) => item.stage === 'draft'),
    review: items.filter((item) => item.stage === 'review'),
  }), [items]);

  const openItem = (item: LifecycleBoardItem) => {
    if (item.kind === 'brief') onOpenBrief(item.entityId);
    else onOpenPost(item.entityId);
  };

  return (
    <section
      aria-label="Content lifecycle board"
      className="flex flex-col gap-3"
      data-testid="content-pipeline-board"
      data-board-focus={focus}
      data-intake-state={intakeOpen ? 'expanded' : 'collapsed'}
    >
      <details
        open={intakeOpen}
        onToggle={(event) => setIntakeOpen(event.currentTarget.open)}
        className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-1.5 marker:hidden">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--teal)]" aria-hidden="true">
            <Icon name="sparkle" size="sm" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block t-ui font-semibold text-[var(--brand-text-bright)]">Intake</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{intakeSummary}</span>
          </span>
          <Badge label={`${intakeCount}`} tone="blue" variant="soft" size="sm" />
          <Icon name={intakeOpen ? 'chevronUp' : 'chevronDown'} size="sm" className="text-[var(--brand-text-muted)]" />
        </summary>
        {intakeOpen && (
          <div className="border-t border-[var(--brand-border)] px-4 py-4">
            {intakeContent}
          </div>
        )}
      </details>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[920px] grid-cols-4 items-start gap-3">
          <BoardColumn title="Queued" count={grouped.queued.length} accent="var(--zinc-500)" empty="Nothing is waiting to be triaged." className={`max-h-[calc(100vh-300px)] ${stageClass(focus === 'intake')}`}>
            {grouped.queued.map((item) => <LifecycleItemCard key={item.id} item={item} onOpen={() => openItem(item)} />)}
          </BoardColumn>

          <div data-testid="content-pipeline-board-stage-brief">
            <BoardColumn title="Brief" count={grouped.brief.length} accent="var(--blue)" empty="No briefs are ready to open." className={`max-h-[calc(100vh-300px)] ${stageClass(focus === 'brief')}`}>
              {grouped.brief.map((item) => <LifecycleItemCard key={item.id} item={item} onOpen={() => openItem(item)} />)}
              {grouped.brief.length === 0 && (
                <BoardCard title="Plan a new brief" meta="Open brief planning to start new content" onClick={onOpenBriefs}>
                  <span className="t-caption-sm font-semibold text-[var(--teal)]">Open briefs</span>
                </BoardCard>
              )}
            </BoardColumn>
          </div>

          <BoardColumn title="Draft" count={grouped.draft.length} accent="var(--teal)" empty="No drafts are in progress." className="max-h-[calc(100vh-300px)]">
            {grouped.draft.map((item) => <LifecycleItemCard key={item.id} item={item} onOpen={() => openItem(item)} />)}
            {grouped.draft.length === 0 && (
              <BoardCard title="Open draft workspace" meta="Continue writing and production work" onClick={onOpenDrafts}>
                <span className="t-caption-sm font-semibold text-[var(--teal)]">Open drafts</span>
              </BoardCard>
            )}
          </BoardColumn>

          <BoardColumn title="In review" count={grouped.review.length} accent="var(--amber)" empty="No drafts are marked for review." className="max-h-[calc(100vh-300px)]">
            {grouped.review.map((item) => <LifecycleItemCard key={item.id} item={item} onOpen={() => openItem(item)} />)}
          </BoardColumn>
        </div>
      </div>
    </section>
  );
}
