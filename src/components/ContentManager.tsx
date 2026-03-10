import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, FileText, PenLine, Clock, CheckCircle2, Eye, Send,
  Trash2, Download, Search, ArrowUpDown, Filter,
  Sparkles, X,
} from 'lucide-react';
import { PostEditor } from './PostEditor';

interface PostSummary {
  id: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  totalWordCount: number;
  status: 'generating' | 'draft' | 'review' | 'approved';
  createdAt: string;
  updatedAt: string;
  sections: { heading: string; wordCount: number; status: string }[];
}

type SortField = 'date' | 'title' | 'status' | 'words';
type StatusFilter = 'all' | 'generating' | 'draft' | 'review' | 'approved';

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string; bg: string }> = {
  generating: { icon: Sparkles, color: 'text-amber-400', label: 'Generating', bg: 'bg-amber-500/10 border-amber-500/20' },
  draft: { icon: PenLine, color: 'text-blue-400', label: 'Draft', bg: 'bg-blue-500/10 border-blue-500/20' },
  review: { icon: Eye, color: 'text-cyan-400', label: 'In Review', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  approved: { icon: CheckCircle2, color: 'text-green-400', label: 'Approved', bg: 'bg-green-500/10 border-green-500/20' },
};

export function ContentManager({ workspaceId }: { workspaceId: string }) {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-posts/${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void fetchPosts(); }, [fetchPosts]);

  // Auto-refresh generating posts
  useEffect(() => {
    const hasGenerating = posts.some(p => p.status === 'generating');
    if (!hasGenerating) return;
    const interval = setInterval(fetchPosts, 5000);
    return () => clearInterval(interval);
  }, [posts, fetchPosts]);

  const updateStatus = async (postId: string, status: string) => {
    setUpdatingStatus(postId);
    try {
      const res = await fetch(`/api/content-posts/${workspaceId}/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updated } : p));
      }
    } catch { /* ignore */ }
    setUpdatingStatus(null);
  };

  const deletePost = async (postId: string) => {
    try {
      await fetch(`/api/content-posts/${workspaceId}/${postId}`, { method: 'DELETE' });
      setPosts(prev => prev.filter(p => p.id !== postId));
      setDeleteConfirm(null);
    } catch { /* ignore */ }
  };

  // Filter & sort
  const filtered = posts
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.title.toLowerCase().includes(q) || p.targetKeyword.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); break;
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': {
          const order = { generating: 0, draft: 1, review: 2, approved: 3 };
          cmp = (order[a.status] || 0) - (order[b.status] || 0);
          break;
        }
        case 'words': cmp = a.totalWordCount - b.totalWordCount; break;
      }
      return sortAsc ? cmp : -cmp;
    });

  const statusCounts = {
    all: posts.length,
    generating: posts.filter(p => p.status === 'generating').length,
    draft: posts.filter(p => p.status === 'draft').length,
    review: posts.filter(p => p.status === 'review').length,
    approved: posts.filter(p => p.status === 'approved').length,
  };

  // If viewing a post, render the PostEditor
  if (activePostId) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setActivePostId(null); fetchPosts(); }}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ← Back to Content
        </button>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <PostEditor
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => { setActivePostId(null); fetchPosts(); }}
            onDelete={() => { setActivePostId(null); fetchPosts(); }}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['draft', 'review', 'approved', 'generating'] as const).map(status => {
          const cfg = STATUS_CONFIG[status];
          const Icon = cfg.icon;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                statusFilter === status ? `${cfg.bg} border-opacity-100` : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                <span className="text-[11px] text-zinc-500 font-medium">{cfg.label}</span>
              </div>
              <span className="text-lg font-semibold text-zinc-200">{statusCounts[status]}</span>
            </button>
          );
        })}
      </div>

      {/* Search & sort bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or keyword..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(['date', 'title', 'status', 'words'] as const).map(f => (
            <button
              key={f}
              onClick={() => { if (sortField === f) setSortAsc(!sortAsc); else { setSortField(f); setSortAsc(false); } }}
              className={`px-2 py-1.5 text-[11px] rounded-md transition-colors ${
                sortField === f ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {sortField === f && <ArrowUpDown className="w-2.5 h-2.5 inline ml-0.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
            <FileText className="w-8 h-8 text-zinc-600" />
          </div>
          <p className="text-sm text-zinc-400">No content generated yet</p>
          <p className="text-xs text-zinc-500 max-w-md text-center">
            Generate content from a Content Brief — once created, all generated pieces will appear here for review and approval.
          </p>
        </div>
      )}

      {/* Filtered empty state */}
      {posts.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center py-8 gap-2">
          <Filter className="w-5 h-5 text-zinc-600" />
          <p className="text-xs text-zinc-500">No content matches your filters</p>
          <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="text-[11px] text-teal-400 hover:text-teal-300">
            Clear filters
          </button>
        </div>
      )}

      {/* Post list */}
      <div className="space-y-2">
        {filtered.map(post => {
          const cfg = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft;
          const Icon = cfg.icon;
          const isGenerating = post.status === 'generating';
          const sectionsComplete = post.sections?.filter(s => s.status === 'done').length || 0;
          const totalSections = post.sections?.length || 0;

          return (
            <div
              key={post.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: title + meta */}
                  <button
                    onClick={() => setActivePostId(post.id)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <div className="text-sm font-medium text-zinc-200 group-hover:text-teal-300 transition-colors truncate">
                      {post.title}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-zinc-500">
                        <span className="text-zinc-400">"{post.targetKeyword}"</span>
                      </span>
                      <span className="text-[11px] text-zinc-600">·</span>
                      <span className="text-[11px] text-zinc-500">
                        {post.totalWordCount.toLocaleString()} words
                      </span>
                      {isGenerating && totalSections > 0 && (
                        <>
                          <span className="text-[11px] text-zinc-600">·</span>
                          <span className="text-[11px] text-amber-400">
                            {sectionsComplete}/{totalSections} sections
                          </span>
                        </>
                      )}
                      <span className="text-[11px] text-zinc-600">·</span>
                      <span className="text-[11px] text-zinc-600">
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>

                  {/* Right: status + actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border font-medium ${cfg.bg} ${cfg.color}`}>
                      <Icon className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
                      {cfg.label}
                    </span>

                    {/* Status progression buttons */}
                    {!isGenerating && (
                      <div className="flex items-center gap-1">
                        {post.status === 'draft' && (
                          <button
                            onClick={() => updateStatus(post.id, 'review')}
                            disabled={updatingStatus === post.id}
                            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                            title="Send for review"
                          >
                            <Send className="w-3 h-3" />
                            Review
                          </button>
                        )}
                        {post.status === 'review' && (
                          <button
                            onClick={() => updateStatus(post.id, 'approved')}
                            disabled={updatingStatus === post.id}
                            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                            title="Approve content"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Approve
                          </button>
                        )}
                        {(post.status === 'review' || post.status === 'approved') && (
                          <button
                            onClick={() => updateStatus(post.id, 'draft')}
                            disabled={updatingStatus === post.id}
                            className="text-[11px] px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            title="Move back to draft"
                          >
                            ↩ Draft
                          </button>
                        )}
                      </div>
                    )}

                    {/* Export */}
                    {!isGenerating && (
                      <a
                        href={`/api/content-posts/${workspaceId}/${post.id}/export/html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
                        title="Export HTML"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* Delete */}
                    {deleteConfirm === post.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => deletePost(post.id)} className="text-[11px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">Delete</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-[11px] px-2 py-1 rounded text-zinc-500 hover:text-zinc-300">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(post.id)}
                        className="text-zinc-700 hover:text-red-400 transition-colors p-1"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
