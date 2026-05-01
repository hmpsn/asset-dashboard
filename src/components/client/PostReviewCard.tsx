import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronUp, Edit3, Loader2 } from 'lucide-react';
import { Icon, Button } from '../ui';
import type { ClientContentRequest } from './types';
import type { GeneratedPost, ContentTopicRequest } from '../../../shared/types/content';
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

export function PostReviewCard({ request, workspaceId, onUpdate, setToast }: PostReviewCardProps) {
  // ALL hooks must be declared before any early returns (Rules of Hooks).
  const queryClient = useQueryClient();
  // Self-fetches post data via React Query (no hand-rolled state/effect needed)
  const { data: fetchedPost, isLoading: postLoading } = useClientPostPreview(workspaceId, request.postId, true);
  const [post, setPost] = useState<GeneratedPost | undefined>(undefined);
  // Editor state — unconditional, even though they're only used when post is loaded
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editingIntro, setEditingIntro] = useState(false);
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
    async (html: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { introduction: html });
      setPost(updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
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
    queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(
    autoSaveSectionContent,
    2000,
    () => { setToast({ message: 'Failed to save section', type: 'error' }); },
  );

  const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
    async (html: string) => {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { conclusion: html });
      setPost(updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
    },
    2000,
    () => { setToast({ message: 'Failed to save conclusion', type: 'error' }); },
  );

  // Sync fetched post into local state once (so edits can update it without refetching).
  // This runs on every render but is guarded by `!post` so it only fires on the first
  // render where fetchedPost arrives. Safe to do during render (no side effects).
  if (fetchedPost && !post) setPost(fetchedPost);

  // Early returns AFTER all hooks — this is the correct order per Rules of Hooks
  if (postLoading) return <p className="t-caption text-[var(--brand-text-muted)] mt-3 animate-pulse">Loading post…</p>;
  if (!post) return <p className="t-caption text-[var(--brand-text-muted)] mt-3">Post not available.</p>;

  async function handleApprove() {
    setApproving(true);
    try {
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
      <div className="px-1">
        <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">{post.title}</h3>
        {post.metaDescription && (
          <p className="t-caption text-[var(--brand-text)] mt-1 italic">{post.metaDescription}</p>
        )}
      </div>

      {/* Introduction */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="t-label text-[var(--brand-text-muted)]">Introduction</span>
          {!editingIntro && (
            <button
              onClick={() => setEditingIntro(true)}
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            >
              <Icon as={Edit3} size="sm" /> Edit
            </button>
          )}
        </div>
        {editingIntro ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.introduction}
              onChange={scheduleIntroSave}
            />
            <div className="flex gap-2 items-center">
              <button
                onClick={async () => { await flushIntro(); setEditingIntro(false); }}
                className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
              >
                Done
              </button>
              {introSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {introSaveStatus === 'saved' && (
                <span className="t-caption-sm text-emerald-400/70">Saved</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="t-caption text-[var(--brand-text)] leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.introduction }}
          />
        )}
      </div>

      {/* Sections */}
      {post.sections.map(section => (
        <div key={section.index} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="t-caption font-semibold text-[var(--brand-text-bright)]">{section.heading}</span>
            {editingSection !== section.index && (
              <button
                onClick={async () => { await flushSection(); setEditingSection(section.index); }}
                className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
              >
                <Icon as={Edit3} size="sm" /> Edit
              </button>
            )}
          </div>
          {editingSection === section.index ? (
            <div className="space-y-2">
              <RichTextEditor
                initialValue={section.content}
                onChange={scheduleSectionSave}
              />
              <div className="flex gap-2 items-center">
                <button
                  onClick={async () => { await flushSection(); setEditingSection(null); }}
                  className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
                >
                  Done
                </button>
                {sectionSaveStatus === 'saving' && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                )}
                {sectionSaveStatus === 'saved' && (
                  <span className="t-caption-sm text-emerald-400/70">Saved</span>
                )}
              </div>
            </div>
          ) : (
            <div
              className="t-caption text-[var(--brand-text)] leading-relaxed prose prose-invert prose-sm max-w-none"
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
            <button
              onClick={() => setEditingConclusion(true)}
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            >
              <Icon as={Edit3} size="sm" /> Edit
            </button>
          )}
        </div>
        {editingConclusion ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.conclusion}
              onChange={scheduleConclusionSave}
            />
            <div className="flex gap-2 items-center">
              <button
                onClick={async () => { await flushConclusion(); setEditingConclusion(false); }}
                className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
              >
                Done
              </button>
              {conclusionSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {conclusionSaveStatus === 'saved' && (
                <span className="t-caption-sm text-emerald-400/70">Saved</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="t-caption text-[var(--brand-text)] leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.conclusion }}
          />
        )}
      </div>

      {/* Steering feedback */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]/80 p-3">
        <button
          onClick={() => setShowFeedback(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="t-caption-sm font-medium text-[var(--brand-text)]">Notes for the team <span className="text-[var(--brand-text-dim)]">(optional steering feedback)</span></span>
          {showFeedback ? <Icon as={ChevronUp} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" />}
        </button>
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
        <button
          onClick={() => { setShowFeedback(true); handleRequestChanges(); }}
          disabled={approving || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] text-[var(--brand-text)] t-caption font-medium hover:border-[var(--brand-border-strong)] hover:text-[var(--brand-text)] transition-all disabled:opacity-50"
        >
          <Icon as={X} size="sm" />
          {submitting ? 'Sending…' : 'Request Changes'}
        </button>
      </div>
      {showFeedback && !feedback.trim() && (
        <p className="t-caption-sm text-amber-400">Please add notes describing what you'd like changed before requesting revisions.</p>
      )}
    </div>
  );
}
