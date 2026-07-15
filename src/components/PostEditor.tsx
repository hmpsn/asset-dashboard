import { useEffect, useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Copy, Download, FileText, Check,
  Pencil, X, Eye, Hash, Clock, Sparkles, AlertTriangle, Trash2, Globe, ExternalLink,
  History,
} from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';
import {
  useSerializedArtifactSave,
  type SerializedArtifactAuthorityCapture,
} from '../hooks/useSerializedArtifactSave';
import { contentBriefs, contentPosts } from '../api/content';
import { getText } from '../api/client';
import { useAdminPost, useAdminPostVersions, usePublishTarget } from '../hooks/admin';
import { SectionCard, Icon, Modal, Button, IconButton, FormInput, FormTextarea } from './ui';
import { SectionEditor } from './post-editor/SectionEditor';
import { RichTextEditor } from './post-editor/RichTextEditor';
import { PostPreview } from './post-editor/PostPreview';
import { VersionHistory } from './post-editor/VersionHistory';
import { ReviewChecklist, CHECKLIST_ITEMS } from './post-editor/ReviewChecklist';
import { FixDiffModal } from './post-editor/FixDiffModal';
import { useBackgroundTasks, isTerminalJobStatus, type BackgroundJob } from '../hooks/useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import { adminRichTextClass } from './post-editor/richTextStyles';
import type { AiFeedbackTarget, AiFixJobResult, AiFixRequest, AiFixResult, AIReviewResponse, ContentBrief, ContentReviewEvidence, IssueKey, StoredAIReview } from '../../shared/types/content';
import { queryKeys } from '../lib/queryKeys';
import { countWordsFromHtml } from '../lib/utils';
import { formatDate } from '../utils/formatDates';
import { useToast } from './Toast';
import { isDeliverableContentPost } from '../../shared/content-post-integrity';

interface PostSection {
  index: number;
  heading: string;
  content: string;
  wordCount: number;
  targetWordCount: number;
  keywords: string[];
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

interface GeneratedPost {
  id: string;
  workspaceId: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  introduction: string;
  sections: PostSection[];
  conclusion: string;
  totalWordCount: number;
  targetWordCount?: number;
  seoTitle?: string;
  seoMetaDescription?: string;
  status: 'generating' | 'needs_attention' | 'draft' | 'review' | 'approved' | 'error';
  unificationStatus?: 'pending' | 'success' | 'failed' | 'skipped';
  unificationNote?: string;
  reviewChecklist?: ReviewChecklist;
  /** Persisted AI review verdicts — seeded into ReviewChecklist on open (C4). */
  aiReview?: StoredAIReview;
  webflowItemId?: string;
  webflowCollectionId?: string;
  publishedAt?: string;
  publishedSlug?: string;
  generationRevision?: number;
  createdAt: string;
  updatedAt: string;
}

interface ReviewChecklist {
  factual_accuracy: boolean;
  brand_voice: boolean;
  internal_links: boolean;
  no_hallucinations: boolean;
  meta_optimized: boolean;
  word_count_target: boolean;
}


interface PostEditorProps {
  workspaceId: string;
  postId: string;
  onClose: () => void;
  onDelete?: () => void;
  workspaceLayout?: boolean;
}

type EditingTarget =
  | { type: 'title' }
  | { type: 'intro' }
  | { type: 'conclusion' }
  | { type: 'section'; index: number }
  | null;

interface FeedbackFixModalState {
  open: boolean;
  target: AiFeedbackTarget;
  label: string;
  sectionIndex?: number;
  sourceRevision: number | null;
}

const STALE_RICH_TEXT_EDIT_MESSAGE = 'This post changed while you were editing. Cancel and reopen the editor before saving.';
const STALE_FEEDBACK_FIX_MESSAGE = 'This post changed after you opened the feedback form. Cancel and reopen it before generating a preview.';

function PostStatusBadge({ status }: { status: GeneratedPost['status'] }) {
  const cfg: Record<string, { color: string; label: string }> = {
    generating: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Generating...' },
    needs_attention: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Needs attention' },
    error: { color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Failed' },
    draft: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Draft' },
    review: { color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', label: 'In Review' },
    approved: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Approved' },
  };
  const c = cfg[status] || cfg.draft;
  return <span className={`t-caption-sm px-2 py-0.5 rounded-[var(--radius-sm)] border font-medium ${c.color}`}>{c.label}</span>;
}

export function PostEditor({ workspaceId, postId, onClose, onDelete, workspaceLayout = false }: PostEditorProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // W6.2: ai-review / ai-fix / score-voice now run on the background job platform.
  // The route returns { jobId } and the result lands on the terminal job. These
  // helpers preserve the existing synchronous-feeling UI affordances (ReviewChecklist's
  // onRunAIReview promise, FixDiffModal) by awaiting the tracked job's terminal state.
  const tasks = useBackgroundTasks();
  const tasksJobsRef = useRef<BackgroundJob[]>(tasks.jobs);
  useEffect(() => { tasksJobsRef.current = tasks.jobs; }, [tasks.jobs]);

  // Resolve when the given job reaches a terminal state. Returns the job.result on
  // 'done', throws on error/cancelled. Polls tasksJobsRef (kept fresh by the effect
  // above) — useBackgroundTasks already hydrates active jobs every 2s + via WS.
  const awaitJobResult = <T,>(jobId: string, timeoutMs = 150_000): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const job = tasksJobsRef.current.find(j => j.id === jobId);
        if (job && isTerminalJobStatus(job.status)) {
          if (job.status === 'done') return resolve(job.result as T);
          return reject(new Error(job.error || 'Operation failed'));
        }
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for the operation to finish'));
        window.setTimeout(tick, 400);
      };
      tick();
    });
  };
  const postQ = useAdminPost(workspaceId, postId);
  const post = (postQ.data ?? null) as GeneratedPost | null;
  const briefQ = useQuery({
    queryKey: post?.briefId ? queryKeys.admin.brief(workspaceId, post.briefId) : queryKeys.admin.brief(workspaceId, 'none'),
    queryFn: () => contentBriefs.getById(workspaceId, post!.briefId),
    enabled: !!post?.briefId,
    staleTime: 5 * 60 * 1000,
  });
  const reviewEvidence: ContentReviewEvidence | undefined = (() => {
    const brief = briefQ.data as ContentBrief | undefined;
    const referenceUrls = brief?.referenceUrls?.filter(Boolean).slice(0, 8) ?? [];
    const peopleAlsoAsk = brief?.realPeopleAlsoAsk?.filter(Boolean).slice(0, 8) ?? [];
    const topResults = brief?.realTopResults?.filter(result => result.title && result.url).slice(0, 8) ?? [];
    if (!referenceUrls.length && !peopleAlsoAsk.length && !topResults.length) return undefined;
    return {
      referenceUrls,
      peopleAlsoAsk,
      topResults,
      note: 'SERP evidence used for grounding support. Verify important factual claims against the original sources before checking provenance-sensitive items.',
    };
  })();
  const loading = postQ.isLoading;
  const error = postQ.error ? (postQ.error instanceof Error ? postQ.error.message : 'Failed to load') : '';
  const hasPublishTarget = usePublishTarget(workspaceId).data ?? false;
  const [showVersions, setShowVersions] = useState(false);
  const versionsQ = useAdminPostVersions(workspaceId, postId, showVersions);
  const versions = (versionsQ.data ?? []) as Array<{ id: string; versionNumber: number; trigger: string; triggerDetail?: string; totalWordCount: number; createdAt: string }>;
  const versionsLoading = versionsQ.isLoading;
  const renderedPostAuthority = post ? post.generationRevision ?? 0 : undefined;
  const lastRenderedPostAuthorityRef = useRef<number | undefined>(renderedPostAuthority);
  const canonicalPostAuthorityRef = useRef<number | undefined>(renderedPostAuthority);
  if (!Object.is(lastRenderedPostAuthorityRef.current, renderedPostAuthority)) {
    lastRenderedPostAuthorityRef.current = renderedPostAuthority;
    canonicalPostAuthorityRef.current = renderedPostAuthority;
  }

  const [expandedSectionsByPost, setExpandedSectionsByPost] = useState<Record<string, Set<number>>>({});
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [titleBuffer, setTitleBuffer] = useState('');
  const [titleEditAuthority, setTitleEditAuthority] = useState<number | null>(null);
  const [richTextEditSession, setRichTextEditSession] = useState<SerializedArtifactAuthorityCapture | null>(null);
  const [titleSaving, setTitleSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [showChecklist, setShowChecklist] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixApplying, setFixApplying] = useState(false);
  const [fixResult, setFixResult] = useState<AiFixResult | null>(null);
  const [fixJobId, setFixJobId] = useState<string | null>(null);
  const [fixIssueLabel, setFixIssueLabel] = useState('');
  const [feedbackFixModal, setFeedbackFixModal] = useState<FeedbackFixModalState>({
    open: false,
    target: 'section',
    label: '',
    sourceRevision: null,
  });
  const [feedbackText, setFeedbackText] = useState('');
  // Only the section-level retry banner uses this. Intro/conclusion retry is driven by
  // their own saveStatus === 'error', so this is intentionally section-only.
  const [autoSaveError, setAutoSaveError] = useState<'section' | null>(null);
  // Captures the exact section index + html that failed so the retry button re-attempts
  // the original failed save rather than whatever section happens to be active at retry time.
  // Fixed: cross-section retry corruption (reviewer Finding 4).
  const sectionSaveErrorCapture = useRef<{ sectionIndex: number; html: string } | null>(null);
  // Tracks the last save attempt parameters so onError can capture them for retry binding.
  // Set synchronously at the start of sectionAutoSaveFn before any await.
  const lastSectionSaveAttempt = useRef<{ sectionIndex: number; html: string } | null>(null);
  const editingTitle = editingTarget?.type === 'title';
  const editingIntro = editingTarget?.type === 'intro';
  const editingConclusion = editingTarget?.type === 'conclusion';
  const editingSection = editingTarget?.type === 'section' ? editingTarget.index : null;
  const canStartEdit = editingTarget === null;
  const canStartSectionEdit = editingTarget === null || editingTarget.type === 'section';
  const requireSettledEditor = (action: string): boolean => {
    if (editingTarget === null) return true;
    toast(`Finish or cancel the current edit before ${action}.`, 'error');
    return false;
  };
  const editTitle = () => {
    if (!post) return;
    setTitleBuffer(post?.title ?? '');
    setTitleEditAuthority(canonicalPostAuthorityRef.current ?? post.generationRevision ?? 0);
    setEditingTarget({ type: 'title' });
  };
  const cancelTitleEdit = () => {
    setTitleEditAuthority(null);
    setEditingTarget(null);
  };
  const editSection = (index: number | null) => {
    if (index === null) {
      setRichTextEditSession(null);
      setEditingTarget(null);
      return;
    }
    if (!post || canonicalPostAuthorityRef.current === undefined) return;
    setRichTextEditSession(serializedSaveField.captureAuthority());
    setEditingTarget({ type: 'section', index });
  };
  const editIntroduction = () => {
    if (!post || canonicalPostAuthorityRef.current === undefined) return;
    setRichTextEditSession(serializedSaveField.captureAuthority());
    setEditingTarget({ type: 'intro' });
  };
  const editConclusion = () => {
    if (!post || canonicalPostAuthorityRef.current === undefined) return;
    setRichTextEditSession(serializedSaveField.captureAuthority());
    setEditingTarget({ type: 'conclusion' });
  };
  const finishRichTextEdit = () => {
    setRichTextEditSession(null);
    setEditingTarget(null);
  };

  const serializedSaveField = useSerializedArtifactSave<number, Record<string, unknown>, GeneratedPost>({
    authority: post ? post.generationRevision ?? 0 : undefined,
    save: (expectedRevision, updates) => contentPosts.update(
      workspaceId,
      postId,
      expectedRevision,
      updates,
    ) as Promise<GeneratedPost>,
    getAcceptedAuthority: updated => updated.generationRevision,
    onAccepted: updated => {
      canonicalPostAuthorityRef.current = updated.generationRevision;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), updated);
    },
  });

  const saveField = async (updates: Record<string, unknown>) => {
    if (!post) return;
    try {
      await serializedSaveField(updates);
    } catch (err) {
      console.error('PostEditor save failed:', err);
      throw err; // rethrow so useAutoSave can catch it and transition to 'error'
    }
  };

  const prepareFieldSave = (
    updates: Record<string, unknown>,
    editSession?: SerializedArtifactAuthorityCapture | null,
  ) => {
    if (editSession === null) {
      const rejectStaleEdit = async () => { throw new Error(STALE_RICH_TEXT_EDIT_MESSAGE); };
      rejectStaleEdit.retry = rejectStaleEdit;
      return rejectStaleEdit;
    }
    const prepared = editSession === undefined
      ? serializedSaveField.prepare(updates)
      : serializedSaveField.prepareAt(editSession, updates);
    const normalizeEditError = (err: unknown): unknown => {
      if (editSession !== undefined
        && err instanceof Error
        && err.message.startsWith('This content changed')) {
        return new Error(STALE_RICH_TEXT_EDIT_MESSAGE);
      }
      return err;
    };
    const run = async () => {
      try {
        await prepared();
      } catch (err) {
        console.error('PostEditor save failed:', err);
        throw normalizeEditError(err);
      }
    };
    run.retry = async () => {
      try {
        await prepared.retry();
      } catch (err) {
        console.error('PostEditor save retry failed:', err);
        throw normalizeEditError(err);
      }
    };
    return run;
  };

  // Auto-save for section editing via RichTextEditor (SectionEditor new interface)
  const buildSectionSave = (html: string) => {
    if (editingSection === null || !post) return;
    const sections = [...post.sections];
    const idx = sections.findIndex(s => s.index === editingSection);
    if (idx === -1) return;
    sections[idx] = { ...sections[idx], content: html, wordCount: countWordsFromHtml(html) };
    return { sectionIndex: editingSection, html, updates: { sections } };
  };
  const sectionAutoSaveFn = async (html: string) => {
    const attempt = buildSectionSave(html);
    if (!attempt) return;
    // Capture the target synchronously BEFORE any await so the onError callback can
    // reliably read it even if editingSection changes while the request is in-flight.
    lastSectionSaveAttempt.current = {
      sectionIndex: attempt.sectionIndex,
      html: attempt.html,
    };
    await saveField(attempt.updates);
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, retry: retrySection, saveStatus: sectionSaveStatus } = useAutoSave(
    sectionAutoSaveFn,
    2000,
    // onError: capture the section index and html at error time so retry is safe even if
    // the user switches to a different section before clicking retry (Finding 4).
    (err) => {
      if (lastSectionSaveAttempt.current !== null) {
        sectionSaveErrorCapture.current = lastSectionSaveAttempt.current;
      }
      setAutoSaveError('section');
      if (err instanceof Error && err.message === STALE_RICH_TEXT_EDIT_MESSAGE) {
        toast(err.message, 'error');
      }
    },
    // onSuccess: clear stale error so re-opening any section doesn't show a ghost retry
    // affordance from a previous failure that has since been resolved (Finding 3).
    () => {
      sectionSaveErrorCapture.current = null;
      setAutoSaveError(prev => (prev === 'section' ? null : prev));
    },
    (html) => {
      const attempt = buildSectionSave(html);
      if (!attempt) return async () => {};
      lastSectionSaveAttempt.current = {
        sectionIndex: attempt.sectionIndex,
        html: attempt.html,
      };
      return prepareFieldSave(attempt.updates, richTextEditSession);
    },
  );

  // Intro/conclusion error + retry UI is driven entirely by their own saveStatus
  // ('error' → retry button), so they do not write to autoSaveError (which only
  // gates the section-level retry banner). Avoid write-only state.
  const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, retry: retryIntro, saveStatus: introSaveStatus } = useAutoSave(
    async (html: string) => { await saveField({ introduction: html }); },
    2000,
    (err) => {
      if (err instanceof Error && err.message === STALE_RICH_TEXT_EDIT_MESSAGE) {
        toast(err.message, 'error');
      }
    },
    undefined,
    (html) => prepareFieldSave({ introduction: html }, richTextEditSession),
  );

  const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, retry: retryConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
    async (html: string) => { await saveField({ conclusion: html }); },
    2000,
    (err) => {
      if (err instanceof Error && err.message === STALE_RICH_TEXT_EDIT_MESSAGE) {
        toast(err.message, 'error');
      }
    },
    undefined,
    (html) => prepareFieldSave({ conclusion: html }, richTextEditSession),
  );

  const invalidatePost = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.post(workspaceId, postId) });
  const invalidateVersions = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.postVersions(workspaceId, postId) });

  const handlePublish = async (generateImage = false) => {
    if (!post || !requireSettledEditor('publishing')) return;
    setPublishing(true);
    setPublishError('');
    try {
      const data = await contentPosts.publishToWebflow(
        workspaceId,
        postId,
        post.generationRevision ?? 0,
        { generateImage },
      );
      if (!data.success) {
        setPublishError(data.error || 'Publish failed');
      } else {
        setPublishConfirm(false);
        invalidatePost();
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed');
    }
    setPublishing(false);
  };

  const handleRegenerate = async (sectionIndex: number) => {
    if (!post || !requireSettledEditor('regenerating content')) return;
    const sourceBrief = briefQ.data as ContentBrief | undefined;
    if (sourceBrief?.generationRevision === undefined) {
      toast('The source brief is not ready. Refresh before regenerating this section.', 'error');
      return;
    }
    setRegenerating(sectionIndex);
    try {
      const updated = await contentPosts.regenerateSection(
        workspaceId,
        postId,
        post.generationRevision ?? 0,
        sourceBrief.generationRevision,
        sectionIndex,
      ) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), updated);
    } catch (err) { console.error('PostEditor operation failed:', err); }
    setRegenerating(null);
  };

  const saveTitleEdit = async () => {
    if (!post) return;
    if (titleEditAuthority === null
      || (post.generationRevision ?? 0) !== titleEditAuthority) {
      toast('This post changed while you were editing the title. Cancel and reopen it before saving.', 'error');
      return;
    }
    setTitleSaving(true);
    try {
      await saveField({ title: titleBuffer });
      setTitleEditAuthority(null);
      setEditingTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save title', 'error');
    } finally {
      setTitleSaving(false);
    }
  };

  const copyAllHTML = () => {
    if (!post) return;
    const parts = [`<h1>${post.title}</h1>`, post.introduction, ...post.sections.map(s => s.content), post.conclusion];
    navigator.clipboard.writeText(parts.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportMarkdown = () => {
    window.open(`/api/content-posts/${workspaceId}/${postId}/export/markdown`, '_blank');
  };

  const exportHTML = () => {
    window.open(`/api/content-posts/${workspaceId}/${postId}/export/html`, '_blank');
  };

  const exportPDF = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<p style="font-family:sans-serif;padding:40px">Loading PDF preview…</p>');
    getText(`/api/content-posts/${workspaceId}/${postId}/export/pdf`)
      .then(html => { w.document.open(); w.document.write(html); w.document.close(); })
      .catch(() => { w.location.href = `/api/content-posts/${workspaceId}/${postId}/export/pdf`; });
  };

  const handleDelete = async () => {
    if (!post || !requireSettledEditor('deleting this post')) return;
    try {
      await contentPosts.remove(workspaceId, postId, post.generationRevision ?? 0);
      onDelete?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete post', 'error');
    }
  };

  const handleRevert = async (versionId: string) => {
    if (!post || !requireSettledEditor('restoring a version')) return;
    setReverting(versionId);
    try {
      const reverted = await contentPosts.revertVersion(
        workspaceId,
        postId,
        versionId,
        post.generationRevision ?? 0,
      ) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), reverted);
      invalidateVersions();
    } catch (err) { console.error('PostEditor operation failed:', err); }
    setReverting(null);
  };

  // Generation counter prevents a stale AI response (from a request whose modal
  // the user already dismissed) from re-opening the modal when it eventually resolves.
  const fixGenRef = useRef(0);

  const handleRequestFix = async (issueKey: string, reason: string) => {
    if (fixLoading || !requireSettledEditor('requesting an AI fix')) return;
    const gen = ++fixGenRef.current;
    setFixLoading(true);
    setFixIssueLabel(CHECKLIST_ITEMS.find(i => i.key === issueKey)?.label ?? issueKey);
    try {
      if (!post) return;
      const { jobId } = await contentPosts.aifix(
        workspaceId,
        postId,
        post.generationRevision ?? 0,
        { issueKey: issueKey as IssueKey, reason },
      );
      tasks.trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX, jobId, { workspaceId });
      const result = await awaitJobResult<AiFixJobResult>(jobId);
      if (gen === fixGenRef.current) {
        setFixResult(result);
        setFixJobId(jobId);
      }
    } catch (err) {
      console.error('PostEditor operation failed:', err);
      if (gen === fixGenRef.current) toast(err instanceof Error ? err.message : 'AI fix failed', 'error');
    } finally {
      if (gen === fixGenRef.current) setFixLoading(false);
    }
  };

  const openFeedbackFix = (target: AiFeedbackTarget, label: string, sectionIndex?: number) => {
    const sourceRevision = canonicalPostAuthorityRef.current;
    if (!post || sourceRevision === undefined) {
      toast('Refresh the post before requesting an AI preview.', 'error');
      return;
    }
    setFeedbackFixModal({ open: true, target, label, sectionIndex, sourceRevision });
    setFeedbackText('');
  };

  const closeFeedbackFix = () => {
    setFeedbackFixModal(prev => ({ ...prev, open: false, sourceRevision: null }));
    setFeedbackText('');
  };

  const handleRequestFeedbackFix = async () => {
    if (fixLoading || !requireSettledEditor('requesting an AI fix')) return;
    const trimmedFeedback = feedbackText.trim();
    if (!trimmedFeedback) return;
    const request = feedbackFixModal;
    if (request.sourceRevision === null
      || !Object.is(request.sourceRevision, canonicalPostAuthorityRef.current)) {
      toast(STALE_FEEDBACK_FIX_MESSAGE, 'error');
      return;
    }
    const gen = ++fixGenRef.current;
    setFixLoading(true);
    setFixIssueLabel(request.label);
    closeFeedbackFix();
    try {
      const body: AiFixRequest = request.target === 'section'
        ? {
          mode: 'feedback',
          target: 'section',
          feedback: trimmedFeedback,
          sectionIndex: request.sectionIndex,
        }
        : {
          mode: 'feedback',
          target: request.target,
          feedback: trimmedFeedback,
        };
      if (!post) return;
      const { jobId } = await contentPosts.aifix(
        workspaceId,
        postId,
        request.sourceRevision,
        body,
      );
      tasks.trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX, jobId, { workspaceId });
      const result = await awaitJobResult<AiFixJobResult>(jobId);
      if (gen === fixGenRef.current) {
        setFixResult(result);
        setFixJobId(jobId);
      }
    } catch (err) {
      console.error('PostEditor operation failed:', err);
      if (gen === fixGenRef.current) toast(err instanceof Error ? err.message : 'AI fix failed', 'error');
    } finally {
      if (gen === fixGenRef.current) setFixLoading(false);
    }
  };

  const handleDismissFix = () => {
    fixGenRef.current++;
    setFixResult(null);
    setFixJobId(null);
    setFixLoading(false);
  };

  const feedbackFixAuthorityConflict = feedbackFixModal.open
    && (feedbackFixModal.sourceRevision === null
      || !Object.is(feedbackFixModal.sourceRevision, canonicalPostAuthorityRef.current));

  const handleApplyFix = async (_result: AiFixResult) => {
    if (!post || !fixJobId) return;
    setFixApplying(true);
    try {
      const updated = await contentPosts.applyAiFix(workspaceId, postId, fixJobId) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), updated);
      handleDismissFix();
      invalidateVersions();
    } catch (err) {
      console.error('PostEditor operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to apply AI fix', 'error');
    } finally {
      setFixApplying(false);
    }
  };

  // use-toggle-set-ok -- section expansion is keyed by postId, so this is a map of Sets rather than one Set state.
  const toggleSection = (i: number) => {
    setExpandedSectionsByPost(prev => {
      const autoExpanded = new Set(post?.sections.filter(s => s.status === 'done').map(s => s.index) ?? []);
      const next = new Set(prev[postId] ?? autoExpanded);
      if (next.has(i)) next.delete(i); else next.add(i);
      return { ...prev, [postId]: next };
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Icon as={Loader2} size="lg" className="animate-spin text-teal-400" />
    </div>
  );

  if (error || !post) return (
    <div className="text-center py-16 text-sm text-red-400">{error || 'Post not found'}</div>
  );

  const isGenerating = post.status === 'generating';
  const needsAttention = post.status === 'needs_attention';
  const isDeliverable = isDeliverableContentPost(post);
  const completedSections = post.sections.filter(s => s.status === 'done').length;
  const totalSections = post.sections.length;
  const progress = isGenerating ? Math.round(((completedSections + (post.introduction ? 1 : 0)) / (totalSections + 2)) * 100) : 100;
  const autoExpandedSections = new Set(post.sections.filter(s => s.status === 'done').map(s => s.index));
  const expandedSections = expandedSectionsByPost[postId] ?? autoExpandedSections;

  return (
    <div className="space-y-8">
      {/* Delete Confirmation */}
      {deleteConfirm && (
        <Modal open={deleteConfirm} onClose={() => setDeleteConfirm(false)} size="sm">
          <Modal.Header title="Delete Post?" onClose={() => setDeleteConfirm(false)} />
          <Modal.Body>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-pill)] bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Icon as={AlertTriangle} size="lg" className="text-red-400" />
              </div>
              <div>
                <div className="text-xs text-[var(--brand-text-muted)]">This action cannot be undone</div>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            <Button variant="danger" size="sm" icon={Trash2} onClick={handleDelete}>Delete</Button>
          </Modal.Footer>
        </Modal>
      )}

      {/* Header */}
      <div className={`flex items-start justify-between gap-4 ${workspaceLayout ? 'flex-col' : ''}`}>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <FormInput value={titleBuffer} onChange={setTitleBuffer} disabled={titleSaving} className="flex-1" />
              <IconButton icon={Check} label="Save title" size="sm" variant="solid" disabled={titleSaving} className="bg-teal-600/20 text-teal-300 hover:bg-teal-600/30" onClick={() => { void saveTitleEdit(); }} />
              <IconButton icon={X} label="Cancel title edit" size="sm" variant="solid" disabled={titleSaving} className="bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]" onClick={cancelTitleEdit} />
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              {/* duplicate-heading-ok -- inline editor title and exported html heading intentionally share post.title */}
              <h2 className="text-lg font-semibold text-[var(--brand-text-bright)] truncate">{post.title}</h2>
              {canStartEdit && (
                <IconButton
                  icon={Pencil}
                  label="Edit title"
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-all"
                  onClick={editTitle}
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <PostStatusBadge status={post.status} />
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={Hash} size="sm" />{post.targetKeyword}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={FileText} size="sm" />{post.totalWordCount.toLocaleString()}{post.targetWordCount ? `/${post.targetWordCount.toLocaleString()}` : ''} words</span>
            {post.unificationStatus && post.unificationStatus !== 'pending' && (
              <span title={post.unificationNote || ''} className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border font-medium flex items-center gap-1 ${
                post.unificationStatus === 'success' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                post.unificationStatus === 'failed' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                'text-[var(--brand-text)] bg-[var(--surface-3)]/10 border-[var(--brand-border)]'
              }`}>
                <Icon as={Sparkles} size="sm" />
                {post.unificationStatus === 'success' ? 'Unified' : post.unificationStatus === 'failed' ? 'Unify Failed' : 'Unify Skipped'}
              </span>
            )}
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={Clock} size="sm" />{formatDate(post.updatedAt)}</span>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 flex-shrink-0 ${workspaceLayout ? 'flex-wrap' : ''}`}>
          {isDeliverable && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={Eye}
                onClick={() => setShowPreview(!showPreview)}
                className={showPreview ? 'bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30' : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}
              >
                Preview
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? Check : Copy}
                onClick={copyAllHTML}
                className={copied ? 'text-emerald-400 hover:text-emerald-300' : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="secondary" size="sm" icon={Download} onClick={exportMarkdown} className="text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]">
                .md
              </Button>
              <Button variant="secondary" size="sm" icon={Download} onClick={exportHTML} className="text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]">
                .html
              </Button>
              <Button variant="secondary" size="sm" icon={Download} onClick={exportPDF} className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30">
                Export PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={History}
                onClick={() => setShowVersions(!showVersions)}
                className={showVersions ? 'bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30' : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}
              >
                History
              </Button>
              {hasPublishTarget && (post.status === 'approved' || post.status === 'draft' || post.status === 'review') && (
                post.publishedAt ? (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Icon as={Check} size="sm" /> Published {post.publishedSlug && <Icon as={ExternalLink} size="sm" className="ml-0.5" />}
                  </span>
                ) : (
                  <Button
                    onClick={() => {
                      if (requireSettledEditor('publishing')) setPublishConfirm(true);
                    }}
                    disabled={publishing}
                    size="sm"
                    variant="secondary"
                    loading={publishing}
                    icon={Globe}
                    className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
                  >
                    {publishing ? 'Publishing...' : 'Publish to Webflow'}
                  </Button>
                )
              )}
            </>
          )}
          <IconButton
            icon={Trash2}
            label="Delete post"
            variant="danger"
            size="sm"
            onClick={() => {
              if (requireSettledEditor('deleting this post')) setDeleteConfirm(true);
            }}
          />
          {!workspaceLayout && (
            <IconButton
              icon={X}
              label="Close editor"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (requireSettledEditor('closing the editor')) onClose();
              }}
            />
          )}
        </div>
      </div>

      {/* Progress bar during generation */}
      {isGenerating && (
        <SectionCard className="!border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Icon as={Loader2} size="md" className="animate-spin text-amber-400" />
            <span className="text-xs font-medium text-amber-300">Generating post... {completedSections}/{totalSections} sections</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className="h-full bg-amber-400/60 rounded-[var(--radius-pill)] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </SectionCard>
      )}

      {/* Review Checklist + Status controls */}
      {post.status === 'error' && (
        <SectionCard className="!border-red-500/20">
          <div className="flex items-start gap-2">
            <Icon as={AlertTriangle} size="md" className="text-red-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-300">Generation failed</p>
              <p className="t-caption text-[var(--brand-text-muted)] mt-1">{post.unificationNote || 'The post could not be generated. Review the section errors below before retrying.'}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {needsAttention && (
        <SectionCard className="!border-amber-500/20">
          <div className="flex items-start gap-2">
            <Icon as={AlertTriangle} size="md" className="text-amber-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-300">Generation needs attention</p>
              <p className="t-caption text-[var(--brand-text-muted)] mt-1">Some required content could not be generated. Review the marked sections before moving this post into review.</p>
            </div>
          </div>
        </SectionCard>
      )}

      {post.status === 'draft' || post.status === 'review' ? (
        <ReviewChecklist
          postStatus={post.status}
          reviewChecklist={post.reviewChecklist}
          showChecklist={showChecklist}
          onToggleShowChecklist={() => setShowChecklist(!showChecklist)}
          onToggleItem={(key) => {
            const checklist = post.reviewChecklist ?? { factual_accuracy: false, brand_voice: false, internal_links: false, no_hallucinations: false, meta_optimized: false, word_count_target: false };
            saveField({ reviewChecklist: { ...checklist, [key]: !checklist[key] } }).catch((err) => {
              toast(err instanceof Error ? err.message : 'Failed to save checklist', 'error');
            });
          }}
          onChangeStatus={(status) => {
            if (!requireSettledEditor('changing post status')) return;
            saveField({ status }).catch((err) => {
              toast(err instanceof Error ? err.message : 'Failed to update status', 'error');
            });
          }}
          onRunAIReview={async () => {
            if (!post) throw new Error('Post not loaded');
            if (!requireSettledEditor('running an AI review')) {
              throw new Error('Finish or cancel the current edit before running an AI review.');
            }
            const { jobId } = await contentPosts.aiReview(
              workspaceId,
              postId,
              post.generationRevision ?? 0,
            );
            tasks.trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW, jobId, { workspaceId });
            const result = await awaitJobResult<AIReviewResponse>(jobId);
            // The review verdicts are persisted on the post by the job; refresh so the
            // persisted-review read-back (W5.2) stays in sync after the editor reopens.
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.post(workspaceId, postId) });
            return result ?? null;
          }}
          onRequestFix={handleRequestFix}
          evidence={reviewEvidence}
          persistedAIReview={post.aiReview}
        />
      ) : null}

      {/* Version History Panel */}
      {showVersions && (
        <VersionHistory
          versions={versions} versionsLoading={versionsLoading}
          reverting={reverting} onRevert={handleRevert}
          onClose={() => setShowVersions(false)}
        />
      )}

      {/* Full Preview Mode */}
      {showPreview ? (
        <PostPreview post={post} />
      ) : (
        <>
          {/* Introduction */}
          <SectionCard noPadding variant="subtle">
            <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon as={Sparkles} size="md" className="text-teal-400" />
                <span className="text-xs font-medium text-[var(--brand-text-bright)]">Introduction</span>
                {post.introduction && <span className="t-caption-sm text-[var(--brand-text-muted)]">{countWordsFromHtml(post.introduction)}w</span>}
              </div>
              {post.introduction && canStartEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  onClick={editIntroduction}
                  className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] !px-0 !py-0 bg-transparent hover:bg-transparent"
                >
                  Edit
                </Button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.introduction && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-[var(--brand-text-muted)]"><Icon as={Loader2} size="sm" className="animate-spin" /> Writing introduction...</div>
              ) : editingIntro ? (
                <div className="space-y-2">
                  <RichTextEditor
                    initialValue={post.introduction}
                    onChange={scheduleIntroSave}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Check}
                      onClick={async () => {
                        const { ok } = await flushIntro();
                        // Only exit edit mode if the save succeeded (Finding 2).
                        if (ok) finishRichTextEdit();
                      }}
                      className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
                    >
                      Done
                    </Button>
                    {introSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {introSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                    {introSaveStatus === 'error' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={AlertTriangle}
                        onClick={() => { void retryIntro(); }}
                        className="t-caption-sm text-red-400 hover:text-red-300 !px-0 !py-0 bg-transparent hover:bg-transparent gap-1"
                      >
                        Save failed — retry
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className={adminRichTextClass} dangerouslySetInnerHTML={{ __html: post.introduction }} />
              )}
            </div>
          </SectionCard>

          {/* Body Sections */}
          {post.sections.map((section) => (
            <div key={section.index}>
              <SectionEditor
                section={section}
                expanded={expandedSections.has(section.index)}
                editing={editingSection === section.index}
                regenerating={regenerating === section.index}
                isGenerating={isGenerating}
                canStartSectionEdit={canStartSectionEdit}
                saveStatus={sectionSaveStatus === 'error' ? 'idle' : sectionSaveStatus}
                onToggleExpand={toggleSection}
                onStartEdit={async (index) => {
                  // Block the section switch if flushing the current section's pending save
                  // failed (mirrors onDone). Otherwise a later successful save in the new
                  // section would fire onSuccess and silently clear the failed section's
                  // error + capture, making the failure vanish (invariant 4).
                  const { ok } = await flushSection();
                  if (ok) editSection(index);
                }}
                onChange={(html) => { setAutoSaveError(null); scheduleSectionSave(html); }}
                onDone={async () => {
                  // Only exit edit mode if the save succeeded (Finding 2).
                  const { ok } = await flushSection();
                  if (ok) editSection(null);
                }}
                onRegenerate={handleRegenerate}
                onGenerateWithFeedback={(sectionIndex) => {
                  const s = post.sections.find(item => item.index === sectionIndex);
                  openFeedbackFix('section', s ? `Section: ${s.heading}` : `Section ${sectionIndex + 1}`, sectionIndex);
                }}
              />
              {autoSaveError === 'section' && sectionSaveErrorCapture.current?.sectionIndex === section.index && (
                <div className="flex items-center gap-2 px-4 py-2 -mt-2 mb-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={AlertTriangle}
                    onClick={() => {
                      setAutoSaveError(null);
                      // The hook retains the exact prepared payload and retries
                      // only against the authority used by the failed request.
                      // A newer canonical revision rejects without a PATCH.
                      void retrySection();
                    }}
                    className="t-caption-sm text-red-400 hover:text-red-300 !px-0 !py-0 bg-transparent hover:bg-transparent gap-1"
                  >
                    Save failed — retry
                  </Button>
                </div>
              )}
            </div>
          ))}

          {/* Conclusion */}
          <SectionCard noPadding variant="subtle">
            <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon as={Sparkles} size="md" className="text-teal-400" />
                <span className="text-xs font-medium text-[var(--brand-text-bright)]">Conclusion</span>
                {post.conclusion && <span className="t-caption-sm text-[var(--brand-text-muted)]">{countWordsFromHtml(post.conclusion)}w</span>}
              </div>
              {post.conclusion && canStartEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  onClick={editConclusion}
                  className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] !px-0 !py-0 bg-transparent hover:bg-transparent"
                >
                  Edit
                </Button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.conclusion && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-[var(--brand-text-muted)]"><Icon as={Loader2} size="sm" className="animate-spin" /> Writing conclusion...</div>
              ) : editingConclusion ? (
                <div className="space-y-2">
                  <RichTextEditor
                    initialValue={post.conclusion}
                    onChange={scheduleConclusionSave}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Check}
                      onClick={async () => {
                        const { ok } = await flushConclusion();
                        // Only exit edit mode if the save succeeded (Finding 2).
                        if (ok) finishRichTextEdit();
                      }}
                      className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
                    >
                      Done
                    </Button>
                    {conclusionSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {conclusionSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                    {conclusionSaveStatus === 'error' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={AlertTriangle}
                        onClick={() => { void retryConclusion(); }}
                        className="t-caption-sm text-red-400 hover:text-red-300 !px-0 !py-0 bg-transparent hover:bg-transparent gap-1"
                      >
                        Save failed — retry
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className={adminRichTextClass} dangerouslySetInnerHTML={{ __html: post.conclusion }} />
              )}
            </div>
          </SectionCard>
        </>
      )}

      {/* Publish confirmation dialog */}
      {publishConfirm && post && (
        // pr-check-disable-next-line -- publish confirmation card with teal accent border; not a standard section card
        <div className="bg-[var(--surface-2)] rounded-[var(--radius-xl)] border border-teal-500/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Icon as={Globe} size="md" className="text-teal-400" />
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">
              {post.webflowItemId ? 'Update on Webflow' : 'Publish to Webflow'}
            </h3>
          </div>
          <div className="text-xs text-[var(--brand-text)] space-y-1">
            <p><span className="text-[var(--brand-text-bright)] font-medium">Title:</span> {post.title}</p>
            <p><span className="text-[var(--brand-text-bright)] font-medium">Status:</span> {post.status}</p>
          </div>
          {publishError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-[var(--radius-lg)] px-3 py-2">
              {publishError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handlePublish(false)}
              disabled={publishing}
              size="sm"
              variant="primary"
              loading={publishing}
              icon={Globe}
              className="bg-teal-600 hover:bg-teal-500"
            >
              {post.webflowItemId ? 'Update' : 'Publish'}
            </Button>
            <Button
              onClick={() => handlePublish(true)}
              disabled={publishing}
              size="sm"
              variant="secondary"
              loading={publishing}
              icon={Sparkles}
              className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
            >
              {post.webflowItemId ? 'Update + New Image' : 'Publish + Generate Image'}
            </Button>
            <Button
              onClick={() => { setPublishConfirm(false); setPublishError(''); }}
              size="sm"
              variant="ghost"
              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* SEO Metadata */}
      {!showPreview && (
        // pr-check-disable-next-line -- SEO metadata summary row with reduced opacity; not a section card
        <div className="bg-[var(--surface-2)]/50 rounded-[var(--radius-xl)] border border-[var(--brand-border)]/50 px-4 py-3 space-y-3">
          {post.seoTitle && (
            <div>
              <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">SEO Title Tag <span className="normal-case text-[var(--brand-text-muted)]">({post.seoTitle.length} chars)</span></div>
              <div className="text-xs text-[var(--brand-text-bright)] font-medium">{post.seoTitle}</div>
            </div>
          )}
          <div>
            <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">Meta Description {post.seoMetaDescription && <span className="normal-case text-[var(--brand-text-muted)]">({post.seoMetaDescription.length} chars)</span>}</div>
            <div className="text-xs text-[var(--brand-text)]">{post.seoMetaDescription || post.metaDescription}</div>
          </div>
          <div className="pt-2 border-t border-[var(--brand-border)]/50 flex items-center gap-3">
            <Button
              onClick={() => openFeedbackFix('meta', 'SEO Title + Meta Description')}
              size="sm"
              variant="ghost"
              icon={Sparkles}
              className="h-auto px-0 py-0 t-caption-sm text-[var(--brand-text-muted)] hover:text-teal-300 hover:bg-transparent"
            >
              Generate SEO with feedback
            </Button>
          </div>
        </div>
      )}
      {!showPreview && (
        <div className="flex justify-end">
          <Button
            onClick={() => openFeedbackFix('post', 'Full post')}
            size="sm"
            variant="secondary"
            icon={Sparkles}
            className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
          >
            Generate full post with feedback
          </Button>
        </div>
      )}
      {feedbackFixModal.open && (
        <Modal open={feedbackFixModal.open} onClose={closeFeedbackFix} size="md">
          <Modal.Header
            title={`Generate With Feedback: ${feedbackFixModal.label}`}
            onClose={closeFeedbackFix}
          />
          <Modal.Body>
            <div className="space-y-3">
              <p className="t-caption text-[var(--brand-text-muted)]">
                Describe what you want changed. The AI suggestion will open in diff preview before anything is applied.
              </p>
              <FormTextarea
                value={feedbackText}
                onChange={setFeedbackText}
                placeholder="Examples: Make this more direct, tighten repetition, align with a premium brand voice, and improve transitions."
                rows={6}
                className="w-full"
              />
              {feedbackFixAuthorityConflict && (
                <p role="alert" className="t-caption text-red-400">
                  {STALE_FEEDBACK_FIX_MESSAGE}
                </p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              onClick={closeFeedbackFix}
              variant="ghost"
              size="sm"
              className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRequestFeedbackFix}
              disabled={!feedbackText.trim() || fixLoading || feedbackFixAuthorityConflict}
              size="sm"
              variant="secondary"
              icon={Sparkles}
              className="bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30 disabled:opacity-50"
            >
              Generate preview
            </Button>
          </Modal.Footer>
        </Modal>
      )}
      <FixDiffModal
        issueLabel={fixIssueLabel}
        result={fixResult}
        loading={fixLoading}
        applying={fixApplying}
        onApply={handleApplyFix}
        onDismiss={handleDismissFix}
      />
    </div>
  );
}
