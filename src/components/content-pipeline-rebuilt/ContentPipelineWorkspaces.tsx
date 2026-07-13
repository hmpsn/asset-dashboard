// @ds-rebuilt
import { Suspense, type ReactNode } from 'react';
import {
  REVIEW_CHECKLIST_KEYS,
  type ContentBrief,
  type GeneratedPost,
  type ReviewChecklistKey,
} from '../../../shared/types/content';
import type { FixContext } from '../../types/fix-context';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { Badge, DefinitionList, Drawer, Icon, Meter, SectionCard } from '../ui';
import { ContentPipelineInteriorLoading } from './ContentPipelineInteriorLoading';
import { formatContentDate } from './contentPipelineFormatters';

const LazyContentBriefs = lazyWithRetry(() => import('../ContentBriefs').then((module) => ({
  default: module.ContentBriefs,
})));
const LazyContentManager = lazyWithRetry(() => import('../ContentManager').then((module) => ({
  default: module.ContentManager,
})));
const LazyContentSubscriptions = lazyWithRetry(() => import('../ContentSubscriptions').then((module) => ({
  default: module.ContentSubscriptions,
})));

interface ContentPipelineWorkspacesProps {
  workspaceId: string;
  focusedBrief: ContentBrief | null;
  blankBriefOpen: boolean;
  focusedPost: GeneratedPost | null;
  postId: string | null;
  postWorkspaceOpen: boolean;
  capacityOpen: boolean;
  briefFixContext: FixContext | null;
  onClearBriefFixContext: () => void;
  onCloseBrief: () => void;
  onClosePost: () => void;
  onCloseCapacity: () => void;
}

const FULLSCREEN_DRAWER_STYLE = { maxWidth: 'none' } as const;
const REVIEW_LABELS: Record<ReviewChecklistKey, string> = {
  factual_accuracy: 'Factual accuracy',
  brand_voice: 'Brand voice',
  internal_links: 'Internal links',
  no_hallucinations: 'No hallucinations',
  meta_optimized: 'Meta optimized',
  word_count_target: 'Word-count target',
};

function sourceLabel(brief: ContentBrief): string {
  if (brief.keywordSource === 'matrix' || brief.keywordSource === 'template') return 'Matrix';
  if (brief.keywordSource === 'gsc' || brief.keywordSource === 'semrush' || brief.keywordSource === 'dataforseo') return 'Keywords';
  if (brief.keywordSource === 'manual') return 'Manual';
  return 'Generated brief';
}

function RailNav({ label, items }: { label: string; items: Array<{ label: string; meta?: string; active?: boolean }> }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <div className="mb-2 t-micro text-[var(--brand-text-dim)]">{label}</div>
      {items.map((item, index) => (
        <div
          key={`${index}-${item.label}`}
          className={`flex items-start gap-2 rounded-[var(--radius-md)] border-l-2 px-2 py-2 ${item.active ? 'border-[var(--teal)] bg-[var(--surface-active)]' : 'border-transparent'}`}
        >
          <span className={`w-5 shrink-0 text-right t-micro ${item.active ? 'text-[var(--teal)]' : 'text-[var(--brand-text-dim)]'}`}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block t-caption font-medium text-[var(--brand-text)]">{item.label}</span>
            {item.meta && <span className="mt-0.5 block t-micro text-[var(--brand-text-dim)]">{item.meta}</span>}
          </span>
        </div>
      ))}
    </nav>
  );
}

function WorkspaceGrid({ left, center, right }: { left: ReactNode; center: ReactNode; right: ReactNode }) {
  return (
    <div className="-m-5 grid h-[calc(100vh-100px)] min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[250px_minmax(0,1fr)_348px]">
      <aside className="hidden min-h-0 overflow-y-auto border-r border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-5 lg:block">
        {left}
      </aside>
      <div className="min-h-0 overflow-y-auto bg-[var(--surface-1)] px-4 py-5 lg:px-6">
        {center}
      </div>
      <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-5 lg:block">
        {right}
      </aside>
    </div>
  );
}

function BriefLeftRail({ brief }: { brief: ContentBrief | null }) {
  if (!brief) {
    return (
      <RailNav
        label="Brief sections"
        items={[{ label: 'Generate the brief', meta: 'Start with a keyword', active: true }]}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="brief-workspace-section-rail">
      <RailNav
        label="Brief sections"
        items={[
          { label: 'Angle & intent', meta: brief.intent || 'Not set', active: true },
          { label: 'Target keywords', meta: `${1 + brief.secondaryKeywords.length} terms` },
          { label: 'Outline', meta: `${brief.outline.length} sections` },
          { label: 'Internal links', meta: `${brief.internalLinkSuggestions.length} suggestions` },
          { label: 'Meta & targets', meta: `${brief.wordCountTarget.toLocaleString()} words` },
          { label: 'E-E-A-T & checklist', meta: `${brief.contentChecklist?.length ?? 0} checks` },
        ]}
      />
      <SectionCard title="Source" variant="subtle">
        <DefinitionList items={[
          { label: 'Origin', value: sourceLabel(brief) },
          { label: 'Page type', value: brief.pageType || brief.contentFormat || 'Brief' },
          { label: 'Created', value: formatContentDate(brief.createdAt) },
        ]} />
      </SectionCard>
    </div>
  );
}

function BriefRightRail({ brief }: { brief: ContentBrief | null }) {
  if (!brief) {
    return (
      <SectionCard
        title="Queued"
        subtitle="No brief exists yet"
        titleIcon={<Icon name="clock" size="sm" className="text-[var(--brand-text-muted)]" />}
        iconChip
        variant="subtle"
      >
        <p className="t-caption text-[var(--brand-text-muted)]">
          Enter the target keyword and business context. Readiness begins after the brief is created.
        </p>
      </SectionCard>
    );
  }

  const checks = [
    { label: 'Angle & intent', complete: Boolean(brief.intent && brief.audience) },
    { label: 'Target keywords', complete: Boolean(brief.targetKeyword) },
    { label: 'Outline', complete: brief.outline.length > 0 },
    { label: 'Internal links', complete: brief.internalLinkSuggestions.length > 0 },
    { label: 'Meta & targets', complete: Boolean(brief.suggestedTitle && brief.suggestedMetaDesc && brief.wordCountTarget) },
    { label: 'E-E-A-T & checklist', complete: Boolean(brief.eeatGuidance || brief.contentChecklist?.length) },
  ];
  const complete = checks.filter((check) => check.complete).length;

  return (
    <div className="flex flex-col gap-4" data-testid="brief-workspace-readiness-rail">
      <SectionCard
        title="Brief readiness"
        titleExtra={<Badge label={`${complete}/${checks.length}`} tone={complete === checks.length ? 'emerald' : 'blue'} variant="soft" size="sm" />}
        variant="subtle"
      >
        <Meter value={complete} max={checks.length} ariaLabel="Brief readiness" />
        <div className="mt-3 flex flex-col">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center gap-2 border-t border-[var(--brand-border)] py-2 first:border-t-0">
              <Icon name={check.complete ? 'check' : 'clock'} size="sm" className={check.complete ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-dim)]'} />
              <span className="t-caption text-[var(--brand-text)]">{check.label}</span>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Brief facts" variant="subtle">
        <DefinitionList items={[
          { label: 'Primary keyword', value: brief.targetKeyword },
          { label: 'Word target', value: brief.wordCountTarget.toLocaleString() },
          { label: 'Sections', value: brief.outline.length },
          { label: 'Status', value: 'Brief ready', valueColor: 'var(--emerald)' },
        ]} />
      </SectionCard>
    </div>
  );
}

function DraftLeftRail({ post }: { post: GeneratedPost | null }) {
  const sections = post?.sections ?? [];
  return (
    <div className="flex flex-col gap-5" data-testid="draft-workspace-section-rail">
      <RailNav
        label="On this page"
        items={sections.length > 0
          ? sections.map((section, index) => ({
              label: section.heading || `Section ${index + 1}`,
              meta: `${section.wordCount.toLocaleString()} words`,
              active: index === 0,
            }))
          : [{ label: 'Draft document', meta: post ? `${post.totalWordCount.toLocaleString()} words` : 'Loading', active: true }]}
      />
      {post && (
        <SectionCard title="Brief" variant="subtle">
          <DefinitionList items={[
            { label: 'Keyword', value: post.targetKeyword },
            { label: 'Word target', value: post.targetWordCount.toLocaleString() },
            { label: 'Sections', value: post.sections.length },
          ]} />
        </SectionCard>
      )}
    </div>
  );
}

function DraftRightRail({ post }: { post: GeneratedPost | null }) {
  if (!post) {
    return <p className="t-caption text-[var(--brand-text-muted)]">Loading draft status…</p>;
  }
  const isReview = post.status === 'review';
  const needsAttention = post.status === 'needs_attention';
  const progress = post.targetWordCount > 0 ? Math.min(100, Math.round((post.totalWordCount / post.targetWordCount) * 100)) : 0;
  const checklist = REVIEW_CHECKLIST_KEYS.map((key) => ({
    key,
    label: REVIEW_LABELS[key],
    complete: post.reviewChecklist?.[key] === true,
  }));
  const completedChecks = checklist.filter((item) => item.complete).length;

  return (
    <div className="flex flex-col gap-4" data-testid={isReview ? 'review-workspace-status-rail' : needsAttention ? 'repair-workspace-status-rail' : 'draft-workspace-status-rail'}>
      <SectionCard
        title={isReview ? 'Review status' : needsAttention ? 'Repair required' : 'Draft progress'}
        titleExtra={<Badge label={isReview ? 'In review' : needsAttention ? 'Needs attention' : `${progress}%`} tone={isReview || needsAttention ? 'amber' : 'blue'} variant="soft" size="sm" />}
        titleIcon={<Icon name={isReview ? 'eye' : needsAttention ? 'alert' : 'pencil'} size="sm" className={isReview || needsAttention ? 'text-[var(--amber)]' : 'text-[var(--blue)]'} />}
        iconChip
        variant="subtle"
      >
        {!isReview && !needsAttention && (
          <>
            <Meter value={post.totalWordCount} max={post.targetWordCount || 1} ariaLabel="Draft word-count progress" />
            <p className="mt-2 t-caption text-[var(--brand-text-muted)]">
              {post.totalWordCount.toLocaleString()} of {post.targetWordCount.toLocaleString()} words written.
            </p>
          </>
        )}
        {isReview && (
          <p className="t-caption text-[var(--brand-text-muted)]">
            This draft is in review. The checklist reflects its latest saved review; actions remain in the editor.
          </p>
        )}
        {needsAttention && (
          <p className="t-caption text-[var(--brand-text-muted)]">
            Required generated content is missing. Repair the flagged stages in the editor before review or delivery.
          </p>
        )}
      </SectionCard>

      {needsAttention && (
        <SectionCard
          title="Generation diagnostics"
          titleExtra={<Badge label={`${post.generationDiagnostics?.length ?? 0}`} tone="amber" variant="outline" size="sm" />}
          variant="subtle"
        >
          {post.generationDiagnostics?.length ? (
            <div className="flex flex-col">
              {post.generationDiagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.stage}-${diagnostic.sectionIndex ?? 'all'}-${index}`} className="border-t border-[var(--brand-border)] py-2 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <Icon name="alert" size="sm" className="text-[var(--amber)]" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">
                      {diagnostic.stage === 'section' && diagnostic.sectionIndex !== undefined
                        ? `Section ${diagnostic.sectionIndex + 1}`
                        : diagnostic.stage === 'generation'
                          ? 'Generation'
                          : diagnostic.stage[0].toUpperCase() + diagnostic.stage.slice(1)}
                    </span>
                  </div>
                  <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{diagnostic.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-caption text-[var(--brand-text-muted)]">Open the editor to inspect the incomplete stages.</p>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Review checklist"
        titleExtra={<Badge label={`${completedChecks}/${checklist.length}`} tone={completedChecks === checklist.length ? 'emerald' : isReview ? 'amber' : 'zinc'} variant="outline" size="sm" />}
        variant="subtle"
      >
        {post.reviewChecklist ? (
          <div className="flex flex-col">
            {checklist.map((item) => (
              <div key={item.key} className="flex items-center gap-2 border-t border-[var(--brand-border)] py-2 first:border-t-0">
                <Icon name={item.complete ? 'check' : 'clock'} size="sm" className={item.complete ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-dim)]'} />
                <span className="t-caption text-[var(--brand-text)]">{item.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="t-caption text-[var(--brand-text-muted)]">No checklist results yet.</p>
        )}
      </SectionCard>

      <SectionCard title="Version" variant="subtle">
        <DefinitionList items={[
          { label: 'Created', value: formatContentDate(post.createdAt) },
          { label: 'Updated', value: formatContentDate(post.updatedAt) },
          { label: 'Status', value: isReview ? 'In review' : needsAttention ? 'Needs attention' : post.status, valueColor: isReview || needsAttention ? 'var(--amber)' : 'var(--blue)' },
        ]} />
      </SectionCard>
    </div>
  );
}

export function ContentPipelineWorkspaces({
  workspaceId,
  focusedBrief,
  blankBriefOpen,
  focusedPost,
  postId,
  postWorkspaceOpen,
  capacityOpen,
  briefFixContext,
  onClearBriefFixContext,
  onCloseBrief,
  onClosePost,
  onCloseCapacity,
}: ContentPipelineWorkspacesProps) {
  const briefWorkspaceOpen = Boolean(focusedBrief) || blankBriefOpen;
  const briefTitle = focusedBrief?.suggestedTitle ?? (briefFixContext?.primaryKeyword ? `New brief · ${briefFixContext.primaryKeyword}` : 'New content brief');

  return (
    <>
      <Drawer
        open={briefWorkspaceOpen}
        onClose={onCloseBrief}
        title={briefTitle}
        subtitle={focusedBrief
          ? `${focusedBrief.targetKeyword} · ${focusedBrief.pageType ? `${focusedBrief.pageType} · ` : ''}${focusedBrief.wordCountTarget.toLocaleString()} word target`
          : 'Enter a keyword and context to create the brief.'}
        eyebrow={focusedBrief ? 'Brief workspace' : 'Queued · brief workspace'}
        width="100vw"
        className="!max-w-none"
        style={FULLSCREEN_DRAWER_STYLE}
        closeOnBackdrop={false}
      >
        <Suspense fallback={<ContentPipelineInteriorLoading label="the brief workspace" />}>
          <WorkspaceGrid
            left={<BriefLeftRail brief={focusedBrief} />}
            center={focusedBrief ? (
              <LazyContentBriefs workspaceId={workspaceId} initialBriefId={focusedBrief.id} embedded />
            ) : (
              <LazyContentBriefs
                workspaceId={workspaceId}
                fixContext={briefFixContext}
                clearFixContext={onClearBriefFixContext}
                display="generator"
                embedded
              />
            )}
            right={<BriefRightRail brief={focusedBrief} />}
          />
        </Suspense>
      </Drawer>

      <Drawer
        open={postWorkspaceOpen}
        onClose={onClosePost}
        title={focusedPost?.title ?? 'Draft workspace'}
        subtitle={focusedPost ? `${focusedPost.targetKeyword} · ${focusedPost.status === 'review' ? 'In review' : focusedPost.status === 'needs_attention' ? 'Needs attention' : 'Draft'}` : 'Continue this draft.'}
        eyebrow={focusedPost?.status === 'review' ? 'Review workspace' : focusedPost?.status === 'needs_attention' ? 'Repair workspace' : 'Draft workspace'}
        width="100vw"
        className="!max-w-none"
        style={FULLSCREEN_DRAWER_STYLE}
        closeOnBackdrop={false}
      >
        <Suspense fallback={<ContentPipelineInteriorLoading label="the draft workspace" />}>
          <WorkspaceGrid
            left={<DraftLeftRail post={focusedPost} />}
            center={<LazyContentManager key={postId ?? 'post-workspace'} workspaceId={workspaceId} embedded />}
            right={<DraftRightRail post={focusedPost} />}
          />
        </Suspense>
      </Drawer>

      <Drawer
        open={capacityOpen}
        onClose={onCloseCapacity}
        title="Content subscription"
        subtitle="Recurring monthly content package"
        eyebrow="Content capacity"
        width={440}
      >
        <Suspense fallback={<ContentPipelineInteriorLoading label="content capacity" compact />}>
          <LazyContentSubscriptions workspaceId={workspaceId} embedded />
        </Suspense>
      </Drawer>
    </>
  );
}
