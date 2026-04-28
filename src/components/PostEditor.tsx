import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Copy, Download, FileText, Check,
  Pencil, X, Eye, Hash, Clock, Sparkles, AlertTriangle, Trash2, Globe, ExternalLink,
  History,
} from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';
import { contentPosts } from '../api/content';
import { getText } from '../api/client';
import { useAdminPost, useAdminPostVersions, usePublishTarget } from '../hooks/admin';
import { SectionCard, Icon } from './ui';
import { SectionEditor } from './post-editor/SectionEditor';
import { PostPreview } from './post-editor/PostPreview';
import { VersionHistory } from './post-editor/VersionHistory';
import { ReviewChecklist } from './post-editor/ReviewChecklist';
import { queryKeys } from '../lib/queryKeys';

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
  status: 'generating' | 'draft' | 'review' | 'approved';
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
    draft: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Draft' },
    review: { color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', label: 'In Review' },
    approved: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Approved' },
  };
  const c = cfg[status] || cfg.draft;
  return <span className={`t-caption-sm px-2 py-0.5 rounded border font-medium ${c.color}`}>{c.label}</span>;
}

export function PostEditor({ workspaceId, postId, onClose, onDelete }: PostEditorProps) {
  const queryClient = useQueryClient();
  const postQ = useAdminPost(workspaceId, postId);
  const post = (postQ.data ?? null) as GeneratedPost | null;
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
  const [introBuffer, setIntroBuffer] = useState('');
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [conclusionBuffer, setConclusionBuffer] = useState('');
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

  // Auto-save for section editing via RichTextEditor (SectionEditor new interface)
  const sectionAutoSaveFn = async (html: string) => {
    if (editingSection === null || !post) return;
    const sections = [...post.sections];
    const idx = sections.findIndex(s => s.index === editingSection);
    if (idx === -1) return;
    sections[idx] = { ...sections[idx], content: html, wordCount: html.split(/\s+/).filter(w => w.length > 0).length };
    await saveField({ sections });
  };
  const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(sectionAutoSaveFn);

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

  const saveIntroEdit = () => {
    if (!post) return;
    saveField({ introduction: introBuffer });
    setEditingIntro(false);
  };

  const saveConclusionEdit = () => {
    if (!post) return;
    saveField({ conclusion: conclusionBuffer });
    setEditingConclusion(false);
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
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          {/* pr-check-disable-next-line -- modal dialog */}
          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Icon as={AlertTriangle} size="lg" className="text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--brand-text-bright)]">Delete Post?</div>
                <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">This action cannot be undone</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-xs font-medium bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--brand-border-hover)] transition-colors">Cancel</button>
              <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors flex items-center gap-1.5">
                <Icon as={Trash2} size="md" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input value={titleBuffer} onChange={e => setTitleBuffer(e.target.value)} className="flex-1 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none" />
              <button onClick={saveTitleEdit} className="p-1.5 rounded bg-teal-600/20 text-teal-300 hover:bg-teal-600/30"><Icon as={Check} size="md" /></button>
              <button onClick={() => setEditingTitle(false)} className="p-1.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]"><Icon as={X} size="md" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h2 className="text-lg font-semibold text-[var(--brand-text-bright)] truncate">{post.title}</h2>
              <button onClick={() => { setEditingTitle(true); setTitleBuffer(post.title); }} className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-all"><Icon as={Pencil} size="sm" /></button>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <PostStatusBadge status={post.status} />
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={Hash} size="sm" />{post.targetKeyword}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1"><Icon as={FileText} size="sm" />{post.totalWordCount.toLocaleString()}{post.targetWordCount ? `/${post.targetWordCount.toLocaleString()}` : ''} words</span>
            {post.unificationStatus && post.unificationStatus !== 'pending' && (
              <span title={post.unificationNote || ''} className={`t-caption-sm px-1.5 py-0.5 rounded border font-medium flex items-center gap-1 ${
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
              <button onClick={() => setShowPreview(!showPreview)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium border transition-colors ${showPreview ? 'bg-teal-600/20 border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)] border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}`}>
                <Icon as={Eye} size="sm" /> Preview
              </button>
              <button onClick={copyAllHTML} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={copied ? Check : Copy} size="sm" className={copied ? 'text-emerald-400' : ''} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={exportMarkdown} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={Download} size="sm" /> .md
              </button>
              <button onClick={exportHTML} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={Download} size="sm" /> .html
              </button>
              <button onClick={exportPDF} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                <Icon as={Download} size="sm" /> Export PDF
              </button>
              <button onClick={() => setShowVersions(!showVersions)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium border transition-colors ${showVersions ? 'bg-teal-600/20 border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)] border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'}`}>
                <Icon as={History} size="sm" /> History
              </button>
              {hasPublishTarget && (post.status === 'approved' || post.status === 'draft' || post.status === 'review') && (
                post.publishedAt ? (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Icon as={Check} size="sm" /> Published {post.publishedSlug && <Icon as={ExternalLink} size="sm" className="ml-0.5" />}
                  </span>
                ) : (
                  <button
                    onClick={() => setPublishConfirm(true)}
                    disabled={publishing}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                  >
                    <Icon as={publishing ? Loader2 : Globe} size="sm" className={publishing ? 'animate-spin' : ''} />
                    {publishing ? 'Publishing...' : 'Publish to Webflow'}
                  </button>
                )
              )}
            </>
          )}
          <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Icon as={Trash2} size="md" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
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
          <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
            <div className="h-full bg-amber-400/60 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </SectionCard>
      )}

      {/* Review Checklist + Status controls */}
      {!isGenerating && post.status !== 'approved' && (
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
            return res?.review ?? null;
          }}
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
                {post.introduction && <span className="t-caption-sm text-[var(--brand-text-muted)]">{post.introduction.split(/\s+/).filter(w => w).length}w</span>}
              </div>
              {post.introduction && !editingIntro && (
                <button onClick={() => { setEditingIntro(true); setIntroBuffer(post.introduction); }} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
                  <Icon as={Pencil} size="sm" /> Edit
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.introduction && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-[var(--brand-text-muted)]"><Icon as={Loader2} size="sm" className="animate-spin" /> Writing introduction...</div>
              ) : editingIntro ? (
                <div className="space-y-2">
                  <textarea value={introBuffer} onChange={e => setIntroBuffer(e.target.value)} className="w-full bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-xs text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none resize-y min-h-[100px]" rows={6} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveIntroEdit} className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Save</button>
                    <button onClick={() => setEditingIntro(false)} className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
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
              onStartEdit={(index) => setEditingSection(index)}
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
                {post.conclusion && <span className="t-caption-sm text-[var(--brand-text-muted)]">{post.conclusion.split(/\s+/).filter(w => w).length}w</span>}
              </div>
              {post.conclusion && !editingConclusion && (
                <button onClick={() => { setEditingConclusion(true); setConclusionBuffer(post.conclusion); }} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
                  <Icon as={Pencil} size="sm" /> Edit
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.conclusion && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-[var(--brand-text-muted)]"><Icon as={Loader2} size="sm" className="animate-spin" /> Writing conclusion...</div>
              ) : editingConclusion ? (
                <div className="space-y-2">
                  <textarea value={conclusionBuffer} onChange={e => setConclusionBuffer(e.target.value)} className="w-full bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-xs text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none resize-y min-h-[80px]" rows={4} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveConclusionEdit} className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Save</button>
                    <button onClick={() => setEditingConclusion(false)} className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
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
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {publishError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePublish(false)}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600 text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
            >
              <Icon as={publishing ? Loader2 : Globe} size="sm" className={publishing ? 'animate-spin' : ''} />
              {post.webflowItemId ? 'Update' : 'Publish'}
            </button>
            <button
              onClick={() => handlePublish(true)}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
            >
              <Icon as={publishing ? Loader2 : Sparkles} size="sm" className={publishing ? 'animate-spin' : ''} />
              {post.webflowItemId ? 'Update + New Image' : 'Publish + Generate Image'}
            </button>
            <button
              onClick={() => { setPublishConfirm(false); setPublishError(''); }}
              className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors"
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
    </div>
  );
}
