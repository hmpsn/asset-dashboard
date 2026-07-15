import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronUp, Edit3, Loader2 } from 'lucide-react';
import { Button, ClickableRow, FormInput, FormTextarea, Icon } from '../ui';
import type { ClientContentRequest } from './types';
import type { PublicContentPost, PublicContentTopicRequest, PostSection } from '../../../shared/types/content';
import { publicPostReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { countWordsFromHtml } from '../../lib/utils';
import { useClientPostPreview } from '../../hooks/client/useClientPostPreview';
import { RichTextEditor } from '../post-editor/RichTextEditor';
import { clientRichTextClass } from '../post-editor/richTextStyles';
import { useAutoSave, type SaveStatus } from '../../hooks/useAutoSave';
import {
  useSerializedArtifactSave,
  type SerializedArtifactAuthorityCapture,
} from '../../hooks/useSerializedArtifactSave';

type ClientPostEditUpdates = Parameters<typeof publicPostReview.clientEdit>[3];
type AutoSaveFlush = () => Promise<{ ok: boolean }>;

interface SectionEditDraft {
  index: number;
  heading: string;
  content: string;
  wordCount: number;
}

const UNSAVED_EDIT_MESSAGE = 'Some edits could not be saved. Refresh before approving or sending feedback.';
const STALE_EDIT_MESSAGE = 'This post changed while you were editing. Refresh before trying again.';

async function flushForExit(status: SaveStatus, flush: AutoSaveFlush): Promise<boolean> {
  if (status === 'error') return false;
  return (await flush()).ok;
}

function mergeAcceptedPostEdit(
  current: PublicContentPost | undefined,
  accepted: PublicContentPost,
  submitted: ClientPostEditUpdates,
): PublicContentPost {
  if (!current || current.id !== accepted.id) return accepted;

  const sections = accepted.sections.map((acceptedSection) => {
    const localSection = current.sections.find(section => section.index === acceptedSection.index);
    if (!localSection) return acceptedSection;
    const submittedSection = submitted.sections?.find(section => section.index === acceptedSection.index);
    if (!submittedSection) return localSection;

    const localStillMatchesSubmission = localSection.heading === submittedSection.heading
      && localSection.content === submittedSection.content
      && localSection.wordCount === submittedSection.wordCount;
    return localStillMatchesSubmission ? acceptedSection : localSection;
  });

  return {
    ...accepted,
    // A sibling timer may hold a newer local buffer that was not part of this
    // response. Preserve it; use the accepted canonical value only when this
    // request submitted that exact still-current buffer.
    title: submitted.title !== undefined && current.title === submitted.title
      ? accepted.title
      : current.title,
    metaDescription: submitted.metaDescription !== undefined
      && current.metaDescription === submitted.metaDescription
      ? accepted.metaDescription
      : current.metaDescription,
    introduction: submitted.introduction !== undefined
      && current.introduction === submitted.introduction
      ? accepted.introduction
      : current.introduction,
    sections,
    conclusion: submitted.conclusion !== undefined
      && current.conclusion === submitted.conclusion
      ? accepted.conclusion
      : current.conclusion,
  };
}

// Keep any still-local presentation fields while applying the authoritative
// status fields returned by the shared public request projection.
function toClientRequest(updated: PublicContentTopicRequest, current: ClientContentRequest): ClientContentRequest {
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
  const [post, setPost] = useState<PublicContentPost | undefined>(undefined);
  // Editor state — unconditional, even though they're only used when post is loaded
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editingIntro, setEditingIntro] = useState(false);
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [metaEditSession, setMetaEditSession] = useState<SerializedArtifactAuthorityCapture | null>(null);
  const [introEditSession, setIntroEditSession] = useState<SerializedArtifactAuthorityCapture | null>(null);
  const [conclusionEditSession, setConclusionEditSession] = useState<SerializedArtifactAuthorityCapture | null>(null);
  const [sectionEditSession, setSectionEditSession] = useState<SerializedArtifactAuthorityCapture | null>(null);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const sectionEditDraftRef = useRef<SectionEditDraft | null>(null);
  const sectionEditSequenceRef = useRef(0);

  // Track canonical authority independently from the presentation copy. An
  // accepted local save may advance before the invalidated query catches up,
  // while an external refetch may advance while an editor intentionally keeps
  // its local buffer visible.
  const lastFetchedAuthorityRef = useRef<string | undefined>(fetchedPost?.updatedAt);
  const canonicalAuthorityRef = useRef<string | undefined>(fetchedPost?.updatedAt);
  if (fetchedPost?.updatedAt !== undefined
    && !Object.is(lastFetchedAuthorityRef.current, fetchedPost.updatedAt)) {
    lastFetchedAuthorityRef.current = fetchedPost.updatedAt;
    canonicalAuthorityRef.current = fetchedPost.updatedAt;
  }

  const invalidatePostPreview = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.postPreview(workspaceId, request.postId) });
  };

  const updateLocalPost = (updates: Partial<PublicContentPost>) => {
    setPost(prev => prev ? { ...prev, ...updates } : prev);
  };

  const updateLocalSection = (index: number, updates: Partial<PostSection>) => {
    setPost(prev => prev ? {
      ...prev,
      sections: prev.sections.map(section => section.index === index ? { ...section, ...updates } : section),
    } : prev);
  };

  const serializedPostEdit = useSerializedArtifactSave<string, ClientPostEditUpdates, PublicContentPost>({
    // The query result is the canonical external authority even while local
    // editor buffers intentionally remain visible. This lets a newer server
    // revision invalidate debounce work authored under the old token.
    authority: fetchedPost?.updatedAt ?? post?.updatedAt,
    save: (expectedUpdatedAt, updates) => {
      if (!request.postId) throw new Error('Post is not available for editing.');
      return publicPostReview.clientEdit(workspaceId, request.postId, expectedUpdatedAt, updates);
    },
    getAcceptedAuthority: updated => updated.updatedAt,
    onAccepted: (updated, submitted) => {
      canonicalAuthorityRef.current = updated.updatedAt;
      setPost(current => mergeAcceptedPostEdit(current, updated, submitted));
      invalidatePostPreview();
    },
  });

  const preparePostEdit = (
    updates: ClientPostEditUpdates,
    editSession: SerializedArtifactAuthorityCapture | null,
  ) => {
    if (editSession === null) {
      return async () => { throw new Error(STALE_EDIT_MESSAGE); };
    }
    const prepared = serializedPostEdit.prepareAt(editSession, updates);
    return async () => {
      try {
        await prepared();
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('This content changed')) {
          throw new Error(STALE_EDIT_MESSAGE);
        }
        throw err;
      }
    };
  };

  const showSaveError = (err: unknown, fallback: string) => {
    setToast({ message: err instanceof Error ? err.message : fallback, type: 'error' });
  };

  const canonicalPostForEdit = (): PublicContentPost | undefined => {
    // A sibling editor may hold a local buffer while the canonical read model
    // catches up with an accepted in-flight save. Never replace that buffer
    // merely because another editor opens.
    if (editingMeta || editingIntro || editingConclusion || editingSection !== null) return post;
    const authority = canonicalAuthorityRef.current;
    if (fetchedPost?.updatedAt === authority) return fetchedPost;
    if (post?.updatedAt === authority) return post;
    return undefined;
  };

  const beginMetaEdit = () => {
    const canonical = canonicalPostForEdit();
    if (!canonical) {
      showSaveError(new Error('Refresh before editing this post.'), 'Refresh before editing this post.');
      return;
    }
    setPost(canonical);
    setMetaEditSession(serializedPostEdit.captureAuthority());
    setEditingMeta(true);
  };

  const beginIntroEdit = () => {
    const canonical = canonicalPostForEdit();
    if (!canonical) {
      showSaveError(new Error('Refresh before editing this post.'), 'Refresh before editing this post.');
      return;
    }
    setPost(canonical);
    setIntroEditSession(serializedPostEdit.captureAuthority());
    setEditingIntro(true);
  };

  const beginConclusionEdit = () => {
    const canonical = canonicalPostForEdit();
    if (!canonical) {
      showSaveError(new Error('Refresh before editing this post.'), 'Refresh before editing this post.');
      return;
    }
    setPost(canonical);
    setConclusionEditSession(serializedPostEdit.captureAuthority());
    setEditingConclusion(true);
  };

  const beginSectionEdit = (index: number) => {
    const canonical = canonicalPostForEdit();
    if (!canonical) {
      showSaveError(new Error('Refresh before editing this post.'), 'Refresh before editing this post.');
      return;
    }
    const section = canonical.sections.find(candidate => candidate.index === index);
    if (!section) {
      showSaveError(new Error('Refresh before editing this section.'), 'Refresh before editing this section.');
      return;
    }
    sectionEditDraftRef.current = {
      index: section.index,
      heading: section.heading,
      content: section.content,
      wordCount: section.wordCount,
    };
    setPost(canonical);
    setSectionEditSession(serializedPostEdit.captureAuthority());
    setEditingSection(index);
  };

  const { scheduleAutoSave: scheduleTitleSave, flush: flushTitle, saveStatus: titleSaveStatus } = useAutoSave(
    async (title: string) => {
      await serializedPostEdit({ title });
    },
    1200,
    err => { showSaveError(err, 'Failed to save title'); },
    undefined,
    title => preparePostEdit({ title }, metaEditSession),
  );

  const { scheduleAutoSave: scheduleMetaSave, flush: flushMeta, saveStatus: metaSaveStatus } = useAutoSave(
    async (metaDescription: string) => {
      await serializedPostEdit({ metaDescription });
    },
    1200,
    err => { showSaveError(err, 'Failed to save meta description'); },
    undefined,
    metaDescription => preparePostEdit({ metaDescription }, metaEditSession),
  );

  const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
    async (html: string) => {
      await serializedPostEdit({ introduction: html });
    },
    2000,
    err => { showSaveError(err, 'Failed to save introduction'); },
    undefined,
    html => preparePostEdit({ introduction: html }, introEditSession),
  );

  const buildSectionEdit = (): ClientPostEditUpdates | null => {
    const draft = sectionEditDraftRef.current;
    if (!draft) return null;
    return {
      sections: [{
        index: draft.index,
        heading: draft.heading,
        content: draft.content,
        wordCount: draft.wordCount,
      }],
    };
  };
  const autoSaveSection = async (_sequence: string) => {
    const updates = buildSectionEdit();
    if (!updates) return;
    await serializedPostEdit(updates);
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(
    autoSaveSection,
    2000,
    err => { showSaveError(err, 'Failed to save section'); },
    undefined,
    _sequence => {
      // useAutoSave calls prepare synchronously when scheduling, so this freezes
      // one combined heading+content snapshot for the debounced attempt.
      const updates = buildSectionEdit();
      return updates ? preparePostEdit(updates, sectionEditSession) : async () => {};
    },
  );

  const updateSectionDraft = (index: number, updates: Partial<Pick<SectionEditDraft, 'heading' | 'content'>>) => {
    const current = sectionEditDraftRef.current;
    if (!current || current.index !== index) return;
    const next: SectionEditDraft = {
      ...current,
      ...updates,
      wordCount: updates.content === undefined
        ? current.wordCount
        : countWordsFromHtml(updates.content),
    };
    sectionEditDraftRef.current = next;
    updateLocalSection(index, {
      ...updates,
      wordCount: next.wordCount,
    });
    sectionEditSequenceRef.current += 1;
    scheduleSectionSave(String(sectionEditSequenceRef.current));
  };

  const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
    async (html: string) => {
      await serializedPostEdit({ conclusion: html });
    },
    2000,
    err => { showSaveError(err, 'Failed to save conclusion'); },
    undefined,
    html => preparePostEdit({ conclusion: html }, conclusionEditSession),
  );

  const hasOpenEditor = editingMeta || editingIntro || editingConclusion || editingSection !== null;
  useEffect(() => {
    if (!fetchedPost || hasOpenEditor) return;
    // Do not regress an accepted local response while its invalidated query is
    // still returning the previous token. Only the latest observed canonical
    // token is eligible to replace the closed editor presentation.
    if (!Object.is(fetchedPost.updatedAt, canonicalAuthorityRef.current)) return;
    setPost(fetchedPost);
  }, [fetchedPost, hasOpenEditor]);

  async function flushPendingEdits() {
    const saves: Array<[SaveStatus, AutoSaveFlush]> = [
      [titleSaveStatus, flushTitle],
      [metaSaveStatus, flushMeta],
      [introSaveStatus, flushIntro],
      [sectionSaveStatus, flushSection],
      [conclusionSaveStatus, flushConclusion],
    ];
    // A known failure retains its pending buffer. Do not turn a lifecycle action
    // into an implicit retry of a rejected conditional write.
    if (saves.some(([status]) => status === 'error')) {
      throw new Error(UNSAVED_EDIT_MESSAGE);
    }
    for (const [, flush] of saves) {
      const { ok } = await flush();
      if (!ok) throw new Error(UNSAVED_EDIT_MESSAGE);
    }
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
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to approve post', type: 'error' });
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
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to send feedback', type: 'error' });
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
              onClick={beginMetaEdit}
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
              <FormInput
                value={post.title}
                onChange={value => {
                  updateLocalPost({ title: value });
                  scheduleTitleSave(value);
                }}
                className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
              />
            </label>
            <label className="block">
              <span className="t-label text-[var(--brand-text-muted)]">Meta description</span>
              <FormTextarea
                value={post.metaDescription}
                onChange={value => {
                  updateLocalPost({ metaDescription: value });
                  scheduleMetaSave(value);
                }}
                rows={3}
                className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:border-teal-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 resize-y"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                onClick={async () => {
                  if (!await flushForExit(titleSaveStatus, flushTitle)) return;
                  if (!await flushForExit(metaSaveStatus, flushMeta)) return;
                  setMetaEditSession(null);
                  setEditingMeta(false);
                }}
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
              onClick={beginIntroEdit}
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
                onClick={async () => {
                  if (await flushForExit(introSaveStatus, flushIntro)) {
                    setIntroEditSession(null);
                    setEditingIntro(false);
                  }
                }}
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
            className={clientRichTextClass}
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
                onClick={async () => {
                  if (!await flushForExit(sectionSaveStatus, flushSection)) return;
                  beginSectionEdit(section.index);
                }}
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
                <FormInput
                  value={section.heading}
                  onChange={value => {
                    updateSectionDraft(section.index, { heading: value });
                  }}
                  className="mt-1 w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption font-semibold text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                />
              </label>
              <RichTextEditor
                initialValue={section.content}
                onChange={(html) => {
                  updateSectionDraft(section.index, { content: html });
                }}
                variant="client"
                minHeight="220px"
              />
              <div className="flex gap-2 items-center">
                <Button
                  onClick={async () => {
                    if (!await flushForExit(sectionSaveStatus, flushSection)) return;
                    sectionEditDraftRef.current = null;
                    setSectionEditSession(null);
                    setEditingSection(null);
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Done
                </Button>
                {sectionSaveStatus === 'saving' && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                  </span>
                )}
                {sectionSaveStatus === 'saved' && (
                  <span className="t-caption-sm text-accent-success">Saved</span>
                )}
              </div>
            </div>
          ) : (
            <div
              className={clientRichTextClass}
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
              onClick={beginConclusionEdit}
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
                onClick={async () => {
                  if (await flushForExit(conclusionSaveStatus, flushConclusion)) {
                    setConclusionEditSession(null);
                    setEditingConclusion(false);
                  }
                }}
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
            className={clientRichTextClass}
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
          <FormTextarea
            value={feedback}
            onChange={setFeedback}
            placeholder="e.g. 'Please make the tone less formal' or 'Add more specifics about our pricing model in section 2'"
            className="mt-2 w-full t-caption"
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
