import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Copy, Download, FileText, Check,
  Pencil, X, Eye, Hash, Clock, Sparkles, AlertTriangle, Trash2, Globe, ExternalLink,
  History,
} from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';
import { contentBriefs, contentPosts } from '../api/content';
import { getText } from '../api/client';
import { useAdminPost, useAdminPostVersions, usePublishTarget } from '../hooks/admin';
import { SectionCard, Icon, Modal, Button } from './ui';
import { SectionEditor } from './post-editor/SectionEditor';
import { RichTextEditor } from './post-editor/RichTextEditor';
import { PostPreview } from './post-editor/PostPreview';
import { VersionHistory } from './post-editor/VersionHistory';
import { ReviewChecklist, CHECKLIST_ITEMS } from './post-editor/ReviewChecklist';
import { FixDiffModal } from './post-editor/FixDiffModal';
import type { AiFixResult, ContentBrief, ContentReviewEvidence, IssueKey } from '../../shared/types/content';
import { queryKeys } from '../lib/queryKeys';
import { countWordsFromHtml } from '../lib/utils';

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
  status: 'generating' | 'draft' | 'review' | 'approved' | 'error';
  unificationStatus?: 'pending' | 'success' | 'failed' | 'skipped';
  unificationNote?: string;
  reviewChecklist?: ReviewChecklist;
  webflowItemId?: string;
  webflowCollectionId?: string;
  publishedAt?: string;
  publishedSlug?: string;
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
}

function PostStatusBadge({ status }: { status: GeneratedPost['status'] }) {
  const cfg: Record<string, { color: string; label: string }> = {
    generating: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Generating...' },
    error: { color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Failed' },
    draft: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Draft' },
    review: { color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', label: 'In Review' },
    approved: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Approved' },
  };
  const c = cfg[status] || cfg.draft;
  return <span className={`t-caption-sm px-2 py-0.5 rounded-[var(--radius-sm)] border font-medium ${c.color}`}>{c.label}</span>;
}

export function PostEditor({ workspaceId, postId, onClose, onDelete }: PostEditorProps) {
  const queryClient = useQueryClient();
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
    const peopleAlsoAsk = brief?.realPeopleAlsoAsk?.filter(Boolean).slice(0, 8) ?? [];
    const topResults = brief?.realTopResults?.filter(result => result.title && result.url).slice(0, 8) ?? [];
    if (!peopleAlsoAsk.length && !topResults.length) return undefined;
    return {
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

  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editingIntro, setEditingIntro] = useState(false);
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleBuffer, setTitleBuffer] = useState('');
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
  const [fixIssueLabel, setFixIssueLabel] = useState('');

  // Auto-save for section editing via RichTextEditor (SectionEditor new interface)
  const sectionAutoSaveFn = async (html: string) => {
    if (editingSection === null || !post) return;
    const sections = [...post.sections];
    const idx = sections.findIndex(s => s.index === editingSection);
    if (idx === -1) return;
    sections[idx] = { ...sections[idx], content: html, wordCount: countWordsFromHtml(html) };
    await saveField({ sections });
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(sectionAutoSaveFn);

  const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
    async (html: string) => { await saveField({ introduction: html }); },
  );

  const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
    async (html: string) => { await saveField({ conclusion: html }); },
  );

  const invalidatePost = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.post(workspaceId, postId) });
  const invalidateVersions = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.postVersions(workspaceId, postId) });

  // Auto-expand all done sections on first load
  const postLoaded = !!post;
  useEffect(() => {
    if (!postLoaded) return;
    const sections = post!.sections;
    if (sections.some(s => s.status === 'done')) {
      setExpandedSections(new Set(sections.filter(s => s.status === 'done').map(s => s.index)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postLoaded]);

  const handlePublish = async (generateImage = false) => {
    if (!post) return;
    setPublishing(true);
    setPublishError('');
    try {
      const data = await contentPosts.publishToWebflow(workspaceId, postId, { generateImage });
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

  const saveField = async (updates: Record<string, unknown>) => {
    if (!post) return;
    try {
      const updated = await contentPosts.update(workspaceId, postId, updates) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), updated);
    } catch (err) { console.error('PostEditor operation failed:', err); }
  };

  const handleRegenerate = async (sectionIndex: number) => {
    setRegenerating(sectionIndex);
    try {
      const updated = await contentPosts.regenerateSection(workspaceId, postId, { sectionIndex }) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), updated);
    } catch (err) { console.error('PostEditor operation failed:', err); }
    setRegenerating(null);
  };

  const saveTitleEdit = () => {
    if (!post) return;
    saveField({ title: titleBuffer });
    setEditingTitle(false);
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
    await contentPosts.remove(workspaceId, postId);
    onDelete?.();
    onClose();
  };

  const handleRevert = async (versionId: string) => {
    setReverting(versionId);
    try {
      const reverted = await contentPosts.revertVersion(workspaceId, postId, versionId) as GeneratedPost;
      queryClient.setQueryData(queryKeys.admin.post(workspaceId, postId), reverted);
      invalidateVersions();
    } catch (err) { console.error('PostEditor operation failed:', err); }
    setReverting(null);
  };

  // Generation counter prevents a stale AI response (from a request whose modal
  // the user already dismissed) from re-opening the modal when it eventually resolves.
  const fixGenRef = useRef(0);

  const handleRequestFix = async (issueKey: string, reason: string) => {
    if (fixLoading) return;
    const gen = ++fixGenRef.current;
    setFixLoading(true);
    setFixIssueLabel(CHECKLIST_ITEMS.find(i => i.key === issueKey)?.label ?? issueKey);
    try {
      const result = await contentPosts.aifix(workspaceId, postId, { issueKey: issueKey as IssueKey, reason });
      if (gen === fixGenRef.current) setFixResult(result);
    } catch (err) {
      console.error('PostEditor operation failed:', err);
    } finally {
      if (gen === fixGenRef.current) setFixLoading(false);
    }
  };

  const handleDismissFix = () => {
    fixGenRef.current++;
    setFixResult(null);
    setFixLoading(false);
  };

  const handleApplyFix = async (result: AiFixResult) => {
    if (!post) return;
    setFixApplying(true);
    try {
      if (result.field === 'introduction') {
        await saveField({ introduction: result.suggestedText });
      } else if (result.field === 'section' && result.sectionIndex !== undefined) {
        const idx = post.sections.findIndex(s => s.index === result.sectionIndex);
        if (idx === -1) {
          console.warn('PostEditor: AI fix section index no longer present', result.sectionIndex);
        } else {
          const sections = [...post.sections];
          sections[idx] = {
            ...sections[idx],
            content: result.suggestedText,
            wordCount: countWordsFromHtml(result.suggestedText),
          };
          await saveField({ sections });
        }
      } else if (result.field === 'conclusion') {
        await saveField({ conclusion: result.suggestedText });
      } else if (result.field === 'meta') {
        let parsed: { seoTitle: string; seoMetaDescription: string };
        try {
          parsed = JSON.parse(result.suggestedText);
        } catch (err) {
          console.error('PostEditor: meta fix returned malformed JSON', err);
          handleDismissFix();
          setFixApplying(false);
          return;
        }
        await saveField({ seoTitle: parsed.seoTitle, seoMetaDescription: parsed.seoMetaDescription });
      }
      handleDismissFix();
      invalidatePost();
    } catch (err) {
      console.error('PostEditor operation failed:', err);
    } finally {
      setFixApplying(false);
    }
  };

  const toggleSection = (i: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
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
  const completedSections = post.sections.filter(s => s.status === 'done').length;
  const totalSections = post.sections.length;
  const progress = isGenerating ? Math.round(((completedSections + (post.introduction ? 1 : 0)) / (totalSections + 2)) * 100) : 100;

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
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input value={titleBuffer} onChange={e => setTitleBuffer(e.target.value)} className="flex-1 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none" />
              <button onClick={saveTitleEdit} className="p-1.5 rounded-[var(--radius-sm)] bg-teal-600/20 text-teal-300 hover:bg-teal-600/30"><Icon as={Check} size="md" /></button>
              <button onClick={() => setEditingTitle(false)} className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]"><Icon as={X} size="md" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h2 className="text-lg font-semibold text-[var(--brand-text-bright)] truncate">{post.title}</h2>
              <button onClick={() => { setEditingTitle(true); setTitleBuffer(post.title); }} className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-all"><Icon as={Pencil} size="sm" /></button>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <PostStatusBadge status={post.status} />
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={Hash} size="sm" />{post.targetKeyword}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={FileText} size="sm" />{post.totalWordCount.toLocaleString()}{post.targetWordCount ? `/${post.targetWordCount.toLocaleString()}` : ''} words</span>
            {post.unificationStatus && post.unificationStatus !== 'pending' && (
              <span title={post.unificationNote || ''} className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border font-medium flex items-center gap-1 ${
                post.unificationStatus === 'success' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                post.unificationStatus === 'failed' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                'text-[var(--brand-text)] bg-[var(--surface-3)]/10 border-[var(--brand-border)]'
              }`}>
                <Icon as={Sparkles} size="sm" />
                {post.unificationStatus === 'success' ? 'Unified' : post.unificationStatus === 'failed' ? 'Unify Failed' : 'Unify Skipped'}
              </span>
            )}
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={Clock} size="sm" />{new Date(post.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isGenerating && (
            <>
              <button onClick={() => setShowPreview(!showPreview)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium border transition-colors ${showPreview ? 'bg-teal-600/20 border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)] border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}`}>
                <Icon as={Eye} size="sm" /> Preview
              </button>
              <button onClick={copyAllHTML} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={copied ? Check : Copy} size="sm" className={copied ? 'text-emerald-400' : ''} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={exportMarkdown} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={Download} size="sm" /> .md
              </button>
              <button onClick={exportHTML} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={Download} size="sm" /> .html
              </button>
              <button onClick={exportPDF} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                <Icon as={Download} size="sm" /> Export PDF
              </button>
              <button onClick={() => setShowVersions(!showVersions)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium border transition-colors ${showVersions ? 'bg-teal-600/20 border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)] border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}`}>
                <Icon as={History} size="sm" /> History
              </button>
              {hasPublishTarget && (post.status === 'approved' || post.status === 'draft' || post.status === 'review') && (
                post.publishedAt ? (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Icon as={Check} size="sm" /> Published {post.publishedSlug && <Icon as={ExternalLink} size="sm" className="ml-0.5" />}
                  </span>
                ) : (
                  <button
                    onClick={() => setPublishConfirm(true)}
                    disabled={publishing}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                  >
                    <Icon as={publishing ? Loader2 : Globe} size="sm" className={publishing ? 'animate-spin' : ''} />
                    {publishing ? 'Publishing...' : 'Publish to Webflow'}
                  </button>
                )
              )}
            </>
          )}
          <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Icon as={Trash2} size="md" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
            <Icon as={X} size="md" />
          </button>
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

      {!isGenerating && post.status !== 'approved' && post.status !== 'error' && (
        <ReviewChecklist
          postStatus={post.status}
          reviewChecklist={post.reviewChecklist}
          showChecklist={showChecklist}
          onToggleShowChecklist={() => setShowChecklist(!showChecklist)}
          onToggleItem={(key) => {
            const checklist = post.reviewChecklist ?? { factual_accuracy: false, brand_voice: false, internal_links: false, no_hallucinations: false, meta_optimized: false, word_count_target: false };
            saveField({ reviewChecklist: { ...checklist, [key]: !checklist[key] } });
          }}
          onChangeStatus={(status) => saveField({ status })}
          onRunAIReview={async () => {
            const res = await contentPosts.aiReview(workspaceId, postId);
            return res ?? null;
          }}
          onRequestFix={handleRequestFix}
          evidence={reviewEvidence}
        />
      )}

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
              {post.introduction && !editingIntro && (
                <button onClick={() => setEditingIntro(true)} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
                  <Icon as={Pencil} size="sm" /> Edit
                </button>
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
                    <button
                      onClick={async () => { await flushIntro(); setEditingIntro(false); }}
                      className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                    >
                      <Icon as={Check} size="sm" /> Done
                    </button>
                    {introSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {introSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--brand-text-bright)] leading-relaxed [&_p]:mb-2 [&_strong]:text-[var(--brand-text-bright)] [&_a]:text-teal-400" dangerouslySetInnerHTML={{ __html: post.introduction }} />
              )}
            </div>
          </SectionCard>

          {/* Body Sections */}
          {post.sections.map((section) => (
            <SectionEditor
              key={section.index} section={section}
              expanded={expandedSections.has(section.index)}
              editing={editingSection === section.index}
              regenerating={regenerating === section.index}
              isGenerating={isGenerating}
              saveStatus={sectionSaveStatus}
              onToggleExpand={toggleSection}
              onStartEdit={async (index) => { await flushSection(); setEditingSection(index); }}
              onChange={scheduleSectionSave}
              onDone={async () => { await flushSection(); setEditingSection(null); }}
              onRegenerate={handleRegenerate}
            />
          ))}

          {/* Conclusion */}
          <SectionCard noPadding variant="subtle">
            <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon as={Sparkles} size="md" className="text-teal-400" />
                <span className="text-xs font-medium text-[var(--brand-text-bright)]">Conclusion</span>
                {post.conclusion && <span className="t-caption-sm text-[var(--brand-text-muted)]">{countWordsFromHtml(post.conclusion)}w</span>}
              </div>
              {post.conclusion && !editingConclusion && (
                <button onClick={() => setEditingConclusion(true)} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
                  <Icon as={Pencil} size="sm" /> Edit
                </button>
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
                    <button
                      onClick={async () => { await flushConclusion(); setEditingConclusion(false); }}
                      className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                    >
                      <Icon as={Check} size="sm" /> Done
                    </button>
                    {conclusionSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {conclusionSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--brand-text-bright)] leading-relaxed [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-[var(--brand-text-bright)] [&_p]:mb-2 [&_ul]:pl-4 [&_ul]:mb-2 [&_ol]:pl-4 [&_ol]:mb-2 [&_li]:mb-1 [&_strong]:text-[var(--brand-text-bright)] [&_a]:text-teal-400" dangerouslySetInnerHTML={{ __html: post.conclusion }} />
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
            <button
              onClick={() => handlePublish(false)}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600 text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
            >
              <Icon as={publishing ? Loader2 : Globe} size="sm" className={publishing ? 'animate-spin' : ''} />
              {post.webflowItemId ? 'Update' : 'Publish'}
            </button>
            <button
              onClick={() => handlePublish(true)}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
            >
              <Icon as={publishing ? Loader2 : Sparkles} size="sm" className={publishing ? 'animate-spin' : ''} />
              {post.webflowItemId ? 'Update + New Image' : 'Publish + Generate Image'}
            </button>
            <button
              onClick={() => { setPublishConfirm(false); setPublishError(''); }}
              className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
            >
              Cancel
            </button>
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
        </div>
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
