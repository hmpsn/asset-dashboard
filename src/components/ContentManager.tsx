import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState, MetricRing, Icon, PageHeader } from './ui';
import {
  Loader2, FileText, PenLine, Clock, CheckCircle2, Eye, Send,
  Trash2, Download, Search, ArrowUpDown, Filter,
  Sparkles, X, Globe, Check,
} from 'lucide-react';
import { PostEditor } from './PostEditor';
import { contentPosts } from '../api/content';
import { useAdminPostsList, usePublishTarget } from '../hooks/admin';
import { queryKeys } from '../lib/queryKeys';

interface PostSummary {
  id: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  totalWordCount: number;
  status: 'generating' | 'draft' | 'review' | 'approved';
  publishedAt?: string;
  webflowItemId?: string;
  createdAt: string;
  updatedAt: string;
  sections: { heading: string; wordCount: number; status: string }[];
  voiceScore?: number;
  voiceFeedback?: string;
}

type SortField = 'date' | 'title' | 'status' | 'words';
type StatusFilter = 'all' | 'generating' | 'draft' | 'review' | 'approved';

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string; bg: string }> = {
  generating: { icon: Sparkles, color: 'text-accent-warning', label: 'Generating', bg: 'bg-amber-500/10 border-amber-500/20' },
  draft: { icon: PenLine, color: 'text-accent-info', label: 'Draft', bg: 'bg-blue-500/10 border-blue-500/20' },
  review: { icon: Eye, color: 'text-accent-cyan', label: 'In Review', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  approved: { icon: CheckCircle2, color: 'text-accent-success', label: 'Approved', bg: 'bg-emerald-500/10 border-emerald-500/20' },
};

export function ContentManager({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const postsQ = useAdminPostsList(workspaceId);
  const posts = (postsQ.data ?? []) as PostSummary[];
  const loading = postsQ.isLoading;
  const hasPublishTarget = usePublishTarget(workspaceId).data ?? false;

  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [publishingPost, setPublishingPost] = useState<string | null>(null);
  const [scoringVoice, setScoringVoice] = useState<string | null>(null);
  const [expandedVoice, setExpandedVoice] = useState<string | null>(null);

  const invalidatePosts = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });

  const publishPost = async (postId: string) => {
    setPublishingPost(postId);
    try {
      const result = await contentPosts.publishToWebflow(workspaceId, postId, {});
      if (result.success) invalidatePosts();
    } catch (err) { console.error('ContentManager operation failed:', err); }
    setPublishingPost(null);
  };

  const updateStatus = async (postId: string, status: string) => {
    setUpdatingStatus(postId);
    try {
      await contentPosts.update(workspaceId, postId, { status });
      invalidatePosts();
    } catch (err) { console.error('ContentManager operation failed:', err); }
    setUpdatingStatus(null);
  };

  const deletePost = async (postId: string) => {
    try {
      await contentPosts.remove(workspaceId, postId);
      invalidatePosts();
      setDeleteConfirm(null);
    } catch (err) { console.error('ContentManager operation failed:', err); }
  };

  const scoreVoice = async (postId: string) => {
    setScoringVoice(postId);
    try {
      const result = await contentPosts.scoreVoice(workspaceId, postId);
      if (result) invalidatePosts();
    } catch (err) { console.error('ContentManager operation failed:', err); }
    setScoringVoice(null);
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
      <div className="space-y-8">
        <button
          onClick={() => { setActivePostId(null); invalidatePosts(); }}
          className="flex items-center gap-1.5 text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
        >
          ← Back to Content
        </button>
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4" style={{ borderRadius: 'var(--radius-signature)' }}>
          <PostEditor
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => { setActivePostId(null); invalidatePosts(); }}
            onDelete={() => { setActivePostId(null); invalidatePosts(); }}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Icon as={Loader2} size="lg" className="animate-spin text-[var(--brand-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Posts"
        subtitle={`${posts.length} post${posts.length !== 1 ? 's' : ''}`}
        icon={<Icon as={FileText} size="lg" className="text-accent-info" />}
      />

      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['draft', 'review', 'approved', 'generating'] as const).map(status => {
          const cfg = STATUS_CONFIG[status];
          const StatusIcon = cfg.icon;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
              style={{ borderRadius: 'var(--radius-signature)' }}
              className={`border px-4 py-3 text-left transition-colors ${
                statusFilter === status ? `${cfg.bg} border-opacity-100` : 'bg-[var(--surface-2)] border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon as={StatusIcon} size="md" className={cfg.color} />
                <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium">{cfg.label}</span>
              </div>
              <span className="text-lg font-semibold text-[var(--brand-text-bright)]">{statusCounts[status]}</span>
            </button>
          );
        })}
      </div>

      {/* Search & sort bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or keyword..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <Icon as={X} size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(['date', 'title', 'status', 'words'] as const).map(f => (
            <button
              key={f}
              onClick={() => { if (sortField === f) setSortAsc(!sortAsc); else { setSortField(f); setSortAsc(false); } }}
              className={`px-2 py-1.5 t-caption-sm rounded-[var(--radius-md)] transition-colors ${
                sortField === f ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {sortField === f && <Icon as={ArrowUpDown} size="sm" className="ml-0.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {posts.length === 0 && (
        <EmptyState icon={FileText} title="No content generated yet" description="Generate content from a Content Brief — once created, all generated pieces will appear here for review and approval." />
      )}

      {/* Filtered empty state */}
      {posts.length > 0 && filtered.length === 0 && (
        <EmptyState icon={Filter} title="No content matches your filters" className="py-8" action={
          <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="t-caption-sm text-accent-brand hover:text-accent-brand">Clear filters</button>
        } />
      )}

      {/* Post list */}
      <div className="space-y-3">
        {filtered.map(post => {
          const cfg = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft;
          const PostStatusIcon = cfg.icon;
          const isGenerating = post.status === 'generating';
          const sectionsComplete = post.sections?.filter(s => s.status === 'done').length || 0;
          const totalSections = post.sections?.length || 0;

          return (
            <div
              key={post.id}
              className="bg-[var(--surface-2)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-colors"
              style={{ borderRadius: 'var(--radius-signature)' }}
            >
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: title + meta */}
                  <button
                    onClick={() => setActivePostId(post.id)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <div className="text-sm font-medium text-[var(--brand-text-bright)] group-hover:text-accent-brand transition-colors truncate">
                      {post.title}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        <span className="text-[var(--brand-text)]">"{post.targetKeyword}"</span>
                      </span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">·</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        {post.totalWordCount.toLocaleString()} words
                      </span>
                      {isGenerating && totalSections > 0 && (
                        <>
                          <span className="t-caption-sm text-[var(--brand-text-muted)]">·</span>
                          <span className="t-caption-sm text-accent-warning">
                            {sectionsComplete}/{totalSections} sections
                          </span>
                        </>
                      )}
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">·</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                      {/* Voice score inline */}
                      {post.voiceScore != null && (
                        <>
                          <span className="t-caption-sm text-[var(--brand-text-muted)]">·</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedVoice(expandedVoice === post.id ? null : post.id); }}
                            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                            title={`Voice match: ${post.voiceScore}/100 — click for details`}
                          >
                            <MetricRing score={post.voiceScore} size={20} strokeWidth={3} />
                            <span className="t-caption-sm text-accent-info font-medium">Voice {post.voiceScore}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </button>

                  {/* Right: status + actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] border font-medium ${cfg.bg} ${cfg.color}`}>
                      <Icon as={PostStatusIcon} size="sm" className={isGenerating ? 'animate-spin' : ''} />
                      {cfg.label}
                    </span>

                    {/* Status progression buttons */}
                    {!isGenerating && (
                      <div className="flex items-center gap-1">
                        {post.status === 'draft' && (
                          <button
                            onClick={() => updateStatus(post.id, 'review')}
                            disabled={updatingStatus === post.id}
                            className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-cyan-500/10 border border-cyan-500/20 text-accent-cyan hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                            title="Send for review"
                          >
                            <Icon as={Send} size="sm" />
                            Review
                          </button>
                        )}
                        {post.status === 'review' && (
                          <button
                            onClick={() => updateStatus(post.id, 'approved')}
                            disabled={updatingStatus === post.id}
                            className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-emerald-500/10 border border-emerald-500/20 text-accent-success hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title="Approve content"
                          >
                            <Icon as={CheckCircle2} size="sm" />
                            Approve
                          </button>
                        )}
                        {post.status === 'review' && (
                          <button
                            onClick={() => updateStatus(post.id, 'draft')}
                            disabled={updatingStatus === post.id}
                            className="t-caption-sm px-2 py-1 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
                            title="Move back to draft"
                          >
                            ↩ Draft
                          </button>
                        )}
                      </div>
                    )}

                    {/* Publish to Webflow */}
                    {hasPublishTarget && !isGenerating && (post.status === 'approved' || post.status === 'review') && (
                      post.publishedAt ? (
                        <span className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-emerald-500/10 border border-emerald-500/20 text-accent-success font-medium">
                          <Icon as={Check} size="sm" /> Published
                        </span>
                      ) : (
                        <button
                          onClick={() => publishPost(post.id)}
                          disabled={publishingPost === post.id}
                          className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-teal-500/10 border border-teal-500/20 text-accent-brand hover:bg-teal-500/20 transition-colors disabled:opacity-50 font-medium"
                          title="Publish to Webflow CMS"
                        >
                          <Icon as={publishingPost === post.id ? Loader2 : Globe} size="sm" className={publishingPost === post.id ? 'animate-spin' : ''} />
                          Publish
                        </button>
                      )
                    )}

                    {/* Score Voice */}
                    {!isGenerating && !post.voiceScore && (
                      <button
                        onClick={() => scoreVoice(post.id)}
                        disabled={scoringVoice === post.id}
                        className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-blue-500/10 border border-blue-500/20 text-accent-info hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                        title="Score brand voice match"
                      >
                        <Icon as={scoringVoice === post.id ? Loader2 : Sparkles} size="sm" className={scoringVoice === post.id ? 'animate-spin' : ''} />
                        Score Voice
                      </button>
                    )}

                    {/* Export */}
                    {!isGenerating && (
                      <a
                        href={`/api/content-posts/${workspaceId}/${post.id}/export/html`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors p-1"
                        title="Export HTML"
                      >
                        <Icon as={Download} size="md" />
                      </a>
                    )}

                    {/* Delete */}
                    {deleteConfirm === post.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => deletePost(post.id)} className="t-caption-sm px-2 py-1 rounded bg-red-500/20 text-accent-danger hover:bg-red-500/30">Delete</button>
                        <button onClick={() => setDeleteConfirm(null)} className="t-caption-sm px-2 py-1 rounded text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(post.id)}
                        className="text-[var(--brand-text-muted)] hover:text-accent-danger transition-colors p-1"
                        title="Delete"
                      >
                        <Icon as={Trash2} size="md" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable voice feedback */}
              {expandedVoice === post.id && post.voiceFeedback && (
                <div className="px-4 pb-3 border-t border-[var(--brand-border)]/50">
                  <div className="flex items-center gap-2 mt-2 mb-1.5">
                    <MetricRing score={post.voiceScore!} size={36} strokeWidth={4} />
                    <div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium">Brand Voice Match</div>
                      <div className="text-xs text-[var(--brand-text-bright)] font-semibold">{post.voiceScore}/100</div>
                    </div>
                    <button
                      onClick={() => scoreVoice(post.id)}
                      disabled={scoringVoice === post.id}
                      className="ml-auto t-caption-sm px-2 py-1 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-accent-info hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                    >
                      {scoringVoice === post.id ? <Icon as={Loader2} size="sm" className="animate-spin mr-1" /> : null}
                      Re-score
                    </button>
                  </div>
                  <div className="t-caption-sm text-[var(--brand-text)] leading-relaxed whitespace-pre-wrap bg-[var(--surface-1)]/50 rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]/50">
                    {post.voiceFeedback}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
