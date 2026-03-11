import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, Copy, Download, FileText, Check, ChevronDown, ChevronUp,
  Pencil, X, Eye, Hash, Clock, Sparkles, AlertTriangle, Trash2,
} from 'lucide-react';

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
  status: 'generating' | 'draft' | 'review' | 'approved';
  unificationStatus?: 'pending' | 'success' | 'failed' | 'skipped';
  unificationNote?: string;
  createdAt: string;
  updatedAt: string;
}

interface PostEditorProps {
  workspaceId: string;
  postId: string;
  onClose: () => void;
  onDelete?: () => void;
}

function WordBadge({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? actual / target : 1;
  const color = pct >= 0.85 && pct <= 1.15 ? 'text-green-400 bg-green-500/10 border-green-500/20' :
    pct >= 0.6 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
    'text-red-400 bg-red-500/10 border-red-500/20';
  return <span className={`text-[11px] px-1.5 py-0.5 rounded border ${color}`}>{actual}/{target}w</span>;
}

function StatusBadge({ status }: { status: GeneratedPost['status'] }) {
  const cfg: Record<string, { color: string; label: string }> = {
    generating: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Generating...' },
    draft: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Draft' },
    review: { color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', label: 'In Review' },
    approved: { color: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'Approved' },
  };
  const c = cfg[status] || cfg.draft;
  return <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${c.color}`}>{c.label}</span>;
}

export function PostEditor({ workspaceId, postId, onClose, onDelete }: PostEditorProps) {
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
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

  const fetchPost = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-posts/${workspaceId}/${postId}`);
      if (!res.ok) throw new Error('Failed to load post');
      const data = await res.json();
      setPost(data);
      // Auto-expand all done sections on first load
      if (loading) {
        const done = new Set<number>(data.sections.filter((s: PostSection) => s.status === 'done').map((s: PostSection) => s.index));
        setExpandedSections(done);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, postId, loading]);

  // Initial fetch + poll while generating
  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  useEffect(() => {
    if (!post || post.status !== 'generating') return;
    const interval = setInterval(fetchPost, 3000);
    return () => clearInterval(interval);
  }, [post?.status, fetchPost]);

  const saveField = async (updates: Record<string, unknown>) => {
    if (!post) return;
    try {
      const res = await fetch(`/api/content-posts/${workspaceId}/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setPost(updated);
      }
    } catch { /* skip */ }
  };

  const handleRegenerate = async (sectionIndex: number) => {
    setRegenerating(sectionIndex);
    try {
      const res = await fetch(`/api/content-posts/${workspaceId}/${postId}/regenerate-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionIndex }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPost(updated);
      }
    } catch { /* skip */ }
    setRegenerating(null);
  };

  const saveSectionEdit = () => {
    if (editingSection === null || !post) return;
    const sections = [...post.sections];
    sections[editingSection] = {
      ...sections[editingSection],
      content: editBuffer,
      wordCount: editBuffer.split(/\s+/).filter(w => w.length > 0).length,
    };
    saveField({ sections });
    setEditingSection(null);
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

  const copyAllMarkdown = () => {
    if (!post) return;
    const parts = [`# ${post.title}\n`, post.introduction, ...post.sections.map(s => s.content), post.conclusion];
    navigator.clipboard.writeText(parts.join('\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportMarkdown = () => {
    window.open(`/api/content-posts/${workspaceId}/${postId}/export/markdown`, '_blank');
  };

  const exportHTML = () => {
    window.open(`/api/content-posts/${workspaceId}/${postId}/export/html`, '_blank');
  };

  const handleDelete = async () => {
    await fetch(`/api/content-posts/${workspaceId}/${postId}`, { method: 'DELETE' });
    onDelete?.();
    onClose();
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
      <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
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
    <div className="space-y-4">
      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-200">Delete Post?</div>
                <div className="text-xs text-zinc-500 mt-0.5">This action cannot be undone</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Cancel</button>
              <button onClick={handleDelete} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Delete
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
              <input value={titleBuffer} onChange={e => setTitleBuffer(e.target.value)} className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-100 focus:border-teal-500/50 focus:outline-none" />
              <button onClick={saveTitleEdit} className="p-1.5 rounded bg-teal-600/20 text-teal-300 hover:bg-teal-600/30"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => setEditingTitle(false)} className="p-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h2 className="text-lg font-semibold text-zinc-100 truncate">{post.title}</h2>
              <button onClick={() => { setEditingTitle(true); setTitleBuffer(post.title); }} className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:text-zinc-300 transition-all"><Pencil className="w-3 h-3" /></button>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <StatusBadge status={post.status} />
            <span className="text-[11px] text-zinc-500 flex items-center gap-1"><Hash className="w-3 h-3" />{post.targetKeyword}</span>
            <span className="text-[11px] text-zinc-500 flex items-center gap-1"><FileText className="w-3 h-3" />{post.totalWordCount.toLocaleString()}{post.targetWordCount ? `/${post.targetWordCount.toLocaleString()}` : ''} words</span>
            {post.unificationStatus && post.unificationStatus !== 'pending' && (
              <span title={post.unificationNote || ''} className={`text-[11px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-1 ${
                post.unificationStatus === 'success' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                post.unificationStatus === 'failed' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'
              }`}>
                <Sparkles className="w-3 h-3" />
                {post.unificationStatus === 'success' ? 'Unified' : post.unificationStatus === 'failed' ? 'Unify Failed' : 'Unify Skipped'}
              </span>
            )}
            <span className="text-[11px] text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(post.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isGenerating && (
            <>
              <button onClick={() => setShowPreview(!showPreview)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${showPreview ? 'bg-teal-600/20 border-teal-500/30 text-teal-300' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>
                <Eye className="w-3 h-3" /> Preview
              </button>
              <button onClick={copyAllMarkdown} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={exportMarkdown} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                <Download className="w-3 h-3" /> .md
              </button>
              <button onClick={exportHTML} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                <Download className="w-3 h-3" /> .html
              </button>
            </>
          )}
          <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar during generation */}
      {isGenerating && (
        <div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span className="text-xs font-medium text-amber-300">Generating post... {completedSections}/{totalSections} sections</span>
            <span className="text-[11px] text-zinc-500 ml-auto">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400/60 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Status controls */}
      {!isGenerating && post.status !== 'approved' && (
        <div className="flex items-center gap-2">
          {post.status === 'draft' && (
            <button onClick={() => saveField({ status: 'review' })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 transition-colors">
              <Eye className="w-3 h-3" /> Send to Review
            </button>
          )}
          {post.status === 'review' && (
            <>
              <button onClick={() => saveField({ status: 'approved' })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-green-600/20 border border-green-500/30 text-green-300 hover:bg-green-600/30 transition-colors">
                <Check className="w-3 h-3" /> Approve
              </button>
              <button onClick={() => saveField({ status: 'draft' })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                Back to Draft
              </button>
            </>
          )}
        </div>
      )}

      {/* Full Preview Mode */}
      {showPreview ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 prose prose-invert prose-sm max-w-none">
          <h1 className="text-xl font-bold text-zinc-100 mb-4">{post.title}</h1>
          <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed mb-6">{post.introduction}</div>
          {post.sections.map(s => (
            <div key={s.index} className="mb-6">
              <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{s.content}</div>
            </div>
          ))}
          <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{post.conclusion}</div>
        </div>
      ) : (
        <>
          {/* Introduction */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs font-medium text-zinc-300">Introduction</span>
                {post.introduction && <span className="text-[11px] text-zinc-500">{post.introduction.split(/\s+/).filter(w => w).length}w</span>}
              </div>
              {post.introduction && !editingIntro && (
                <button onClick={() => { setEditingIntro(true); setIntroBuffer(post.introduction); }} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.introduction && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" /> Writing introduction...</div>
              ) : editingIntro ? (
                <div className="space-y-2">
                  <textarea value={introBuffer} onChange={e => setIntroBuffer(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y min-h-[100px]" rows={6} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveIntroEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Check className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingIntro(false)} className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{post.introduction}</div>
              )}
            </div>
          </div>

          {/* Body Sections */}
          {post.sections.map((section) => (
            <div key={section.index} className={`bg-zinc-900 rounded-xl border overflow-hidden ${section.status === 'error' ? 'border-red-500/30' : section.status === 'generating' ? 'border-amber-500/20' : 'border-zinc-800'}`}>
              <button onClick={() => toggleSection(section.index)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  {section.status === 'generating' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> :
                   section.status === 'error' ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> :
                   section.status === 'done' ? <Check className="w-3.5 h-3.5 text-green-400" /> :
                   <Clock className="w-3.5 h-3.5 text-zinc-500" />}
                  <span className="text-xs font-medium text-zinc-200">{section.heading}</span>
                  {section.status === 'done' && <WordBadge actual={section.wordCount} target={section.targetWordCount} />}
                </div>
                <div className="flex items-center gap-2">
                  {section.keywords.length > 0 && expandedSections.has(section.index) && (
                    <div className="hidden sm:flex items-center gap-1">
                      {section.keywords.slice(0, 3).map((kw, i) => (
                        <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/60">{kw}</span>
                      ))}
                    </div>
                  )}
                  {expandedSections.has(section.index) ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                </div>
              </button>
              {expandedSections.has(section.index) && (
                <div className="border-t border-zinc-800/50 px-4 py-3">
                  {section.status === 'pending' && isGenerating ? (
                    <div className="text-xs text-zinc-500 italic">Waiting to be generated...</div>
                  ) : section.status === 'generating' ? (
                    <div className="flex items-center gap-2 text-xs text-amber-400"><Loader2 className="w-3 h-3 animate-spin" /> Writing this section...</div>
                  ) : section.status === 'error' ? (
                    <div className="space-y-2">
                      <div className="text-xs text-red-400">{section.error || 'Generation failed'}</div>
                      <button onClick={() => handleRegenerate(section.index)} disabled={regenerating === section.index} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50">
                        {regenerating === section.index ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry
                      </button>
                    </div>
                  ) : editingSection === section.index ? (
                    <div className="space-y-2">
                      <textarea value={editBuffer} onChange={e => setEditBuffer(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono focus:border-teal-500/50 focus:outline-none resize-y min-h-[150px]" rows={12} />
                      <div className="flex items-center gap-2">
                        <button onClick={saveSectionEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Check className="w-3 h-3" /> Save</button>
                        <button onClick={() => setEditingSection(null)} className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                        <span className="text-[11px] text-zinc-500 ml-auto">{editBuffer.split(/\s+/).filter(w => w).length} words</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{section.content}</div>
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800/50">
                        <button onClick={() => { setEditingSection(section.index); setEditBuffer(section.content); }} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3 h-3" /> Edit</button>
                        <button onClick={() => handleRegenerate(section.index)} disabled={regenerating === section.index} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-300 transition-colors disabled:opacity-50">
                          {regenerating === section.index ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Conclusion */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs font-medium text-zinc-300">Conclusion</span>
                {post.conclusion && <span className="text-[11px] text-zinc-500">{post.conclusion.split(/\s+/).filter(w => w).length}w</span>}
              </div>
              {post.conclusion && !editingConclusion && (
                <button onClick={() => { setEditingConclusion(true); setConclusionBuffer(post.conclusion); }} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {!post.conclusion && isGenerating ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" /> Writing conclusion...</div>
              ) : editingConclusion ? (
                <div className="space-y-2">
                  <textarea value={conclusionBuffer} onChange={e => setConclusionBuffer(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y min-h-[80px]" rows={4} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveConclusionEdit} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Check className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingConclusion(false)} className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{post.conclusion}</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Meta Description */}
      {!showPreview && (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 px-4 py-3">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Meta Description</div>
          <div className="text-xs text-zinc-400">{post.metaDescription}</div>
        </div>
      )}
    </div>
  );
}
