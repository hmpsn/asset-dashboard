import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import type { ClientContentRequest } from './types';
import type { GeneratedPost } from '../../../shared/types/content';
import { publicPostReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { useClientPostPreview } from '../../hooks/client/useClientPostPreview';

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
  if (postLoading) return <p className="text-xs text-zinc-500 mt-3 animate-pulse">Loading post…</p>;
  if (!post) return <p className="text-xs text-zinc-500 mt-3">Post not available.</p>;

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
      onUpdate(updated as unknown as ClientContentRequest);
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
      onUpdate(updated as unknown as ClientContentRequest);
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
        <h3 className="text-sm font-semibold text-zinc-100">{post.title}</h3>
        {post.metaDescription && (
          <p className="text-xs text-zinc-400 mt-1 italic">{post.metaDescription}</p>
        )}
      </div>

      {/* Introduction */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Introduction</span>
          {!editingIntro && (
            <button
              // v1 simplification: HTML tags are stripped for the textarea draft. Saving plain
              // text back to an HTML field loses formatting (paragraphs, bold, links). A
              // Markdown or WYSIWYG editor would be needed to preserve formatting in a future
              // iteration. The strip is intentional — it avoids exposing raw HTML to clients.
              onClick={() => { setIntroDraft(post.introduction.replace(/<[^>]+>/g, '')); setEditingIntro(true); }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
        {editingIntro ? (
          <div className="space-y-2">
            <textarea
              value={introDraft}
              onChange={e => setIntroDraft(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveIntro(introDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingIntro(false)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.introduction }}
          />
        )}
      </div>

      {/* Sections */}
      {post.sections.map(section => (
        <div key={section.index} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-200">{section.heading}</span>
            {editingSection !== section.index && (
              <button
                onClick={() => { setSectionDraft(section.content.replace(/<[^>]+>/g, '')); setEditingSection(section.index); }}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
          </div>
          {editingSection === section.index ? (
            <div className="space-y-2">
              <textarea
                value={sectionDraft}
                onChange={e => setSectionDraft(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
                rows={6}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => saveSection(section.index, sectionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
                <button onClick={() => setEditingSection(null)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div
              className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: section.content }}
            />
          )}
        </div>
      ))}

      {/* Conclusion */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Conclusion</span>
          {!editingConclusion && (
            <button
              onClick={() => { setConclusionDraft(post.conclusion.replace(/<[^>]+>/g, '')); setEditingConclusion(true); }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
        {editingConclusion ? (
          <div className="space-y-2">
            <textarea
              value={conclusionDraft}
              onChange={e => setConclusionDraft(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveConclusion(conclusionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingConclusion(false)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.conclusion }}
          />
        )}
      </div>

      {/* Steering feedback */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-3">
        <button
          onClick={() => setShowFeedback(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="text-[11px] font-medium text-zinc-400">Notes for the team <span className="text-zinc-600">(optional steering feedback)</span></span>
          {showFeedback ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
        </button>
        {showFeedback && (
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="e.g. 'Please make the tone less formal' or 'Add more specifics about our pricing model in section 2'"
            className="mt-2 w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/50 focus:outline-none resize-y"
            rows={3}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleApprove}
          disabled={approving || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs font-medium hover:from-teal-500 hover:to-emerald-500 transition-all disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {approving ? 'Approving…' : 'Approve Post'}
        </button>
        <button
          onClick={() => { setShowFeedback(true); handleRequestChanges(); }}
          disabled={approving || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-xs font-medium hover:border-zinc-600 hover:text-zinc-300 transition-all disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          {submitting ? 'Sending…' : 'Request Changes'}
        </button>
      </div>
      {showFeedback && !feedback.trim() && (
        <p className="text-[11px] text-amber-400">Please add notes describing what you'd like changed before requesting revisions.</p>
      )}
    </div>
  );
}
