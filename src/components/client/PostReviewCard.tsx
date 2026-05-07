import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronUp, Edit3, Loader2 } from 'lucide-react';
import { Button, ClickableRow, Icon } from '../ui';
import type { ClientContentRequest } from './types';
import type { GeneratedPost, ContentTopicRequest, PostSection } from '../../../shared/types/content';
import { publicPostReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { countWordsFromHtml } from '../../lib/utils';
import { useClientPostPreview } from '../../hooks/client/useClientPostPreview';
import { RichTextEditor } from '../post-editor/RichTextEditor';
import { useAutoSave } from '../../hooks/useAutoSave';

// Adapter: server returns the full ContentTopicRequest; the client portal
// only consumes the ClientContentRequest projection. We merge the few changed
// fields into the existing client view.
function toClientRequest(updated: ContentTopicRequest, current: ClientContentRequest): ClientContentRequest {
  return {
    ...current,
    status: updated.status,
    clientFeedback: updated.clientFeedback ?? current.clientFeedback,
    updatedAt: updated.updatedAt,
  };
}

interface PostReviewCardProps {
  request: ClientContentRequest;
  workspaceId: string;
  onUpdate: (updated: ClientContentRequest) => void;
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
}

const richTextPreviewClass = [
  't-body text-[var(--brand-text)] leading-7 max-w-none',
  '[&_p]:mb-3 [&_p:last-child]:mb-0',
  '[&_a]:text-accent-brand [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_strong]:text-[var(--brand-text-bright)]',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:mb-1.5',
].join(' ');

export function PostReviewCard({ request, workspaceId, onUpdate, setToast }: PostReviewCardProps) {
  // ALL hooks must be declared before any early returns (Rules of Hooks).
  const queryClient = useQueryClient();
  // Self-fetches post data via React Query (no hand-rolled state/effect needed)
  const { data: fetchedPost, isLoading: postLoading } = useClientPostPreview(workspaceId, request.postId, true);
  const [post, setPost] = useState<GeneratedPost | undefined>(undefined);
  // Editor state — unconditional, even though they're only used when post is loaded
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editingIntro, setEditingIntro] = useState(false);
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const invalidatePostPreview = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
  };

  const updateLocalPost = (updates: Partial<GeneratedPost>) => {
    setPost(prev => prev ? { ...prev, ...updates } : prev);
  };

  const updateLocalSection = (index: number, updates: Partial<PostSection>) => {
    setPost(prev => prev ? {
      ...prev,
      sections: prev.sections.map(section => section.index === index ? { ...section, ...updates } : section),
    } : prev);
  };

  const { scheduleAutoSave: scheduleTitleSave, flush: flushTitle, saveStatus: titleSaveStatus } = useAutoSave(
    async (title: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { title });
      setPost(updated);
      invalidatePostPreview();
    },
    1200,
    () => { setToast({ message: 'Failed to save title', type: 'error' }); },
  );

  const { scheduleAutoSave: scheduleMetaSave, flush: flushMeta, saveStatus: metaSaveStatus } = useAutoSave(
    async (metaDescription: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { metaDescription });
      setPost(updated);
      invalidatePostPreview();
    },
    1200,
    () => { setToast({ message: 'Failed to save meta description', type: 'error' }); },
  );

  const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
    async (html: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { introduction: html });
      setPost(updated);
      invalidatePostPreview();
    },
    2000,
    () => { setToast({ message: 'Failed to save introduction', type: 'error' }); },
  );

  const autoSaveSectionContent = async (html: string) => {
    if (editingSection === null) return;
    const existing = post!.sections.find(s => s.index === editingSection);
    const sections = [{
      index: editingSection,
      heading: existing?.heading ?? '',
      content: html,
      wordCount: countWordsFromHtml(html),
    }];
    const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { sections });
    setPost(updated);
    invalidatePostPreview();
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(
    autoSaveSectionContent,
    2000,
    () => { setToast({ message: 'Failed to save section', type: 'error' }); },
  );

  const autoSaveSectionHeading = async (heading: string) => {
    if (editingSection === null) return;
    const existing = post!.sections.find(s => s.index === editingSection);
    const content = existing?.content ?? '';
    const sections = [{
      index: editingSection,
      heading,
      content,
      wordCount: existing?.wordCount ?? countWordsFromHtml(content),
    }];
    const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { sections });
    setPost(updated);
    invalidatePostPreview();
  };
  const { scheduleAutoSave: scheduleSectionHeadingSave, flush: flushSectionHeading, saveStatus: sectionHeadingSaveStatus } = useAutoSave(
    autoSaveSectionHeading,
    1200,
    () => { setToast({ message: 'Failed to save heading', type: 'error' }); },
  );

  const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
    async (html: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { conclusion: html });
      setPost(updated);
      invalidatePostPreview();
    },
    2000,
    () => { setToast({ message: 'Failed to save conclusion', type: 'error' }); },
  );

  useEffect(() => {
    if (!fetchedPost) return;
    setPost(prev => prev?.id === fetchedPost.id ? prev : fetchedPost);
  }, [fetchedPost]);

  async function flushPendingEdits() {
    await flushTitle();
    await flushMeta();
    await flushIntro();
    await flushSectionHeading();
    await flushSection();
    await flushConclusion();
  }

  // Early returns AFTER all hooks — this is the correct order per Rules of Hooks
  if (postLoading) return <p className="t-caption text-[var(--brand-text-muted)] mt-3 animate-pulse">Loading post…</p>;
  if (!post) return <p className="t-caption text-[var(--brand-text-muted)] mt-3">Post not available.</p>;

  async function handleApprove() {
    setApproving(true);
    try {
      await flushPendingEdits();
      const updated = await publicPostReview.approvePost(workspaceId, request.id);
      onUpdate(toClientRequest(updated, request));
      setToast({ message: 'Post approved! Your team has been notified.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to approve post', type: 'error' });
    } finally {
      setApproving(false);
    }
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) {
      setShowFeedback(true);
      return;
    }
    setSubmitting(true);
    try {
      await flushPendingEdits();
      const updated = await publicPostReview.requestPostChanges(workspaceId, request.id, feedback.trim());
      onUpdate(toClientRequest(updated, request));
      setToast({ message: 'Feedback sent to your team.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to send feedback', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 mt-3">
      {/* Post header */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="t-page font-semibold leading-snug text-[var(--brand-text-bright)]">{post.title}</h3>
            {post.metaDescription && (
              <p className="t-caption text-[var(--brand-text)] mt-1 italic leading-relaxed">{post.metaDescription}</p>
            )}
          </div>
          {!editingMeta && (
            <Button
              onClick={() => setEditingMeta(true)}
              variant="link"
              size="sm"
              icon={Edit3}
              className="shrink-0"
            >
              Edit
            </Button>
          )}
        </div>
        {editingMeta && (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="t-label text-[var(--brand-text-muted)]">Title</span>
              <input
                value={post.title}
                onChange={e => {
                  updateLocalPost({ title: e.target.value });
                  scheduleTitleSave(e.target.value);
                }}
                className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="t-label text-[var(--brand-text-muted)]">Meta description</span>
              <textarea
                value={post.metaDescription}
                onChange={e => {
                  updateLocalPost({ metaDescription: e.target.value });
                  scheduleMetaSave(e.target.value);
                }}
                rows={3}
                className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:border-teal-500/50 focus:outline-none resize-y"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                onClick={async () => { await flushTitle(); await flushMeta(); setEditingMeta(false); }}
                variant="secondary"
                size="sm"
              >
                Done
              </Button>
              {(titleSaveStatus === 'saving' || metaSaveStatus === 'saving') && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                </span>
              )}
              {(titleSaveStatus === 'saved' || metaSaveStatus === 'saved') && titleSaveStatus !== 'saving' && metaSaveStatus !== 'saving' && (
                <span className="t-caption-sm text-accent-success">Saved</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Introduction */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="t-label text-[var(--brand-text-muted)]">Introduction</span>
          {!editingIntro && (
            <Button
              onClick={() => setEditingIntro(true)}
              variant="link"
              size="sm"
              icon={Edit3}
            >
              Edit
            </Button>
          )}
        </div>
        {editingIntro ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.introduction}
              onChange={(html) => {
                updateLocalPost({ introduction: html });
                scheduleIntroSave(html);
              }}
              variant="client"
              minHeight="180px"
            />
            <div className="flex gap-2 items-center">
              <Button
                onClick={async () => { await flushIntro(); setEditingIntro(false); }}
                variant="secondary"
                size="sm"
              >
                Done
              </Button>
              {introSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {introSaveStatus === 'saved' && (
                <span className="t-caption-sm text-accent-success">Saved</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className={richTextPreviewClass}
            dangerouslySetInnerHTML={{ __html: post.introduction }}
          />
        )}
      </div>

      {/* Sections */}
      {post.sections.map(section => (
        <div key={section.index} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="t-body font-semibold text-[var(--brand-text-bright)]">{section.heading}</span>
            {editingSection !== section.index && (
              <Button
                onClick={async () => { await flushSectionHeading(); await flushSection(); setEditingSection(section.index); }}
                variant="link"
                size="sm"
                icon={Edit3}
              >
                Edit
              </Button>
            )}
          </div>
          {editingSection === section.index ? (
            <div className="space-y-2">
              <label className="block">
                <span className="t-label text-[var(--brand-text-muted)]">Heading</span>
                <input
                  value={section.heading}
                  onChange={e => {
                    updateLocalSection(section.index, { heading: e.target.value });
                    scheduleSectionHeadingSave(e.target.value);
                  }}
                  className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption font-semibold text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none"
                />
              </label>
              <RichTextEditor
                initialValue={section.content}
                onChange={(html) => {
                  updateLocalSection(section.index, { content: html, wordCount: countWordsFromHtml(html) });
                  scheduleSectionSave(html);
                }}
                variant="client"
                minHeight="220px"
              />
              <div className="flex gap-2 items-center">
                <Button
                  onClick={async () => { await flushSectionHeading(); await flushSection(); setEditingSection(null); }}
                  variant="secondary"
                  size="sm"
                >
                  Done
                </Button>
                {(sectionSaveStatus === 'saving' || sectionHeadingSaveStatus === 'saving') && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                  </span>
                )}
                {(sectionSaveStatus === 'saved' || sectionHeadingSaveStatus === 'saved') && sectionSaveStatus !== 'saving' && sectionHeadingSaveStatus !== 'saving' && (
                  <span className="t-caption-sm text-accent-success">Saved</span>
                )}
              </div>
            </div>
          ) : (
            <div
              className={richTextPreviewClass}
              dangerouslySetInnerHTML={{ __html: section.content }}
            />
          )}
        </div>
      ))}

      {/* Conclusion */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="t-label text-[var(--brand-text-muted)]">Conclusion</span>
          {!editingConclusion && (
            <Button
              onClick={() => setEditingConclusion(true)}
              variant="link"
              size="sm"
              icon={Edit3}
            >
              Edit
            </Button>
          )}
        </div>
        {editingConclusion ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.conclusion}
              onChange={(html) => {
                updateLocalPost({ conclusion: html });
                scheduleConclusionSave(html);
              }}
              variant="client"
              minHeight="180px"
            />
            <div className="flex gap-2 items-center">
              <Button
                onClick={async () => { await flushConclusion(); setEditingConclusion(false); }}
                variant="secondary"
                size="sm"
              >
                Done
              </Button>
              {conclusionSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {conclusionSaveStatus === 'saved' && (
                <span className="t-caption-sm text-accent-success">Saved</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className={richTextPreviewClass}
            dangerouslySetInnerHTML={{ __html: post.conclusion }}
          />
        )}
      </div>

      {/* Steering feedback */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/80 p-3">
        <ClickableRow
          onClick={() => setShowFeedback(v => !v)}
          className="flex items-center justify-between rounded-[var(--radius-lg)]"
        >
          <span className="t-caption-sm font-medium text-[var(--brand-text)]">Notes for the team <span className="text-[var(--brand-text-muted)]">(optional steering feedback)</span></span>
          {showFeedback ? <Icon as={ChevronUp} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" />}
        </ClickableRow>
        {showFeedback && (
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="e.g. 'Please make the tone less formal' or 'Add more specifics about our pricing model in section 2'"
            className="mt-2 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:border-teal-500/50 focus:outline-none resize-y"
            rows={3}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={handleApprove}
          disabled={approving || submitting}
          icon={Check}
          className="rounded-[var(--radius-lg)] t-caption"
        >
          {approving ? 'Approving…' : 'Approve Post'}
        </Button>
        <Button
          onClick={() => { setShowFeedback(true); handleRequestChanges(); }}
          disabled={approving || submitting}
          variant="secondary"
          icon={X}
          className="rounded-[var(--radius-lg)]"
        >
          {submitting ? 'Sending…' : 'Request Changes'}
        </Button>
      </div>
      {showFeedback && !feedback.trim() && (
        <p className="t-caption-sm text-accent-warning">Please add notes describing what you'd like changed before requesting revisions.</p>
      )}
    </div>
  );
}
