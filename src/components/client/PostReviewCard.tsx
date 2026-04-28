import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import { Icon, Button } from '../ui';
import type { ClientContentRequest } from './types';
import type { GeneratedPost, ContentTopicRequest } from '../../../shared/types/content';
import { publicPostReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { useClientPostPreview } from '../../hooks/client/useClientPostPreview';

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
  const [sectionDraft, setSectionDraft] = useState('');
  const [editingIntro, setEditingIntro] = useState(false);
  const [introDraft, setIntroDraft] = useState('');
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  // Sync fetched post into local state once (so edits can update it without refetching).
  // This runs on every render but is guarded by `!post` so it only fires on the first
  // render where fetchedPost arrives. Safe to do during render (no side effects).
  if (fetchedPost && !post) setPost(fetchedPost);

  // Early returns AFTER all hooks — this is the correct order per Rules of Hooks
  if (postLoading) return <p className="t-caption text-[var(--brand-text-muted)] mt-3 animate-pulse">Loading post…</p>;
  if (!post) return <p className="t-caption text-[var(--brand-text-muted)] mt-3">Post not available.</p>;

  async function saveSection(index: number, content: string) {
    try {
      // Send only the single changed section — NOT post.sections.map() over the full array.
      // The server-side merge (Step 4.5) iterates the DB sections and replaces only the
      // matching index, leaving all others untouched. Rebuilding and sending the full array
      // from the stale `post` closure would corrupt concurrent saves: save B would overwrite
      // save A's changes because it captured the pre-A `post.sections` snapshot.
      const existing = post!.sections.find(s => s.index === index);
      const sections = [{
        index,
        heading: existing?.heading ?? '',
        content,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      }];
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { sections });
      setPost(updated);
      // Invalidate React Query cache so remounts within staleTime don't serve pre-edit data.
      // Without this, the `if (fetchedPost && !post)` sync guard would restore stale content.
      queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
      setEditingSection(null);
      setToast({ message: 'Section saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save section', type: 'error' });
    }
  }

  async function saveIntro(content: string) {
    try {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { introduction: content });
      setPost(updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
      setEditingIntro(false);
      setToast({ message: 'Introduction saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save introduction', type: 'error' });
    }
  }

  async function saveConclusion(content: string) {
    try {
      const updated = await publicPostReview.clientEdit(workspaceId, post!.id, { conclusion: content });
      setPost(updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
      setEditingConclusion(false);
      setToast({ message: 'Conclusion saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save conclusion', type: 'error' });
    }
  }

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
              // v1 simplification: HTML tags are stripped for the textarea draft. Saving plain
              // text back to an HTML field loses formatting (paragraphs, bold, links). A
              // Markdown or WYSIWYG editor would be needed to preserve formatting in a future
              // iteration. The strip is intentional — it avoids exposing raw HTML to clients.
              onClick={() => { setIntroDraft(post.introduction.replace(/<[^>]+>/g, '')); setEditingIntro(true); }}
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            >
              <Icon as={Edit3} size="sm" /> Edit
            </button>
          )}
        </div>
        {editingIntro ? (
          <div className="space-y-2">
            <textarea
              value={introDraft}
              onChange={e => setIntroDraft(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveIntro(introDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingIntro(false)} className="px-2.5 py-1 rounded t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">Cancel</button>
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
                onClick={() => { setSectionDraft(section.content.replace(/<[^>]+>/g, '')); setEditingSection(section.index); }}
                className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
              >
                <Icon as={Edit3} size="sm" /> Edit
              </button>
            )}
          </div>
          {editingSection === section.index ? (
            <div className="space-y-2">
              <textarea
                value={sectionDraft}
                onChange={e => setSectionDraft(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:border-teal-500/50 focus:outline-none resize-y"
                rows={6}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => saveSection(section.index, sectionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
                <button onClick={() => setEditingSection(null)} className="px-2.5 py-1 rounded t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">Cancel</button>
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
              onClick={() => { setConclusionDraft(post.conclusion.replace(/<[^>]+>/g, '')); setEditingConclusion(true); }}
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            >
              <Icon as={Edit3} size="sm" /> Edit
            </button>
          )}
        </div>
        {editingConclusion ? (
          <div className="space-y-2">
            <textarea
              value={conclusionDraft}
              onChange={e => setConclusionDraft(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveConclusion(conclusionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingConclusion(false)} className="px-2.5 py-1 rounded t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">Cancel</button>
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
          className="rounded-[var(--radius-lg)]"
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
