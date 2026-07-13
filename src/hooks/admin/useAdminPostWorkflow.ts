import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { contentPosts } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../../components/Toast';
import { useBackgroundTasks, isTerminalJobStatus, type BackgroundJob } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type { GeneratedPost } from '../../../shared/types/content';
import { useAdminPostsList, usePublishTarget, useSendPostToClient } from './useAdminPosts';

export type ContentPostSortField = 'date' | 'title' | 'status' | 'words';
export type ContentPostStatusFilter = 'all' | 'generating' | 'needs_attention' | 'draft' | 'review' | 'approved' | 'error';

export interface ContentPostStatusCounts {
  all: number;
  generating: number;
  needs_attention: number;
  error: number;
  draft: number;
  review: number;
  approved: number;
}

export function filterAndSortPosts(
  posts: GeneratedPost[],
  options: {
    search: string;
    statusFilter: ContentPostStatusFilter;
    sortField: ContentPostSortField;
    sortAsc: boolean;
  },
): GeneratedPost[] {
  return [...posts]
    .filter(post => options.statusFilter === 'all' || post.status === options.statusFilter)
    .filter(post => {
      if (!options.search) return true;
      const q = options.search.toLowerCase();
      return post.title.toLowerCase().includes(q) || post.targetKeyword.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (options.sortField) {
        case 'date': cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); break;
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': {
          const order = { generating: 0, needs_attention: 1, error: 2, draft: 3, review: 4, approved: 5 };
          cmp = (order[a.status] || 0) - (order[b.status] || 0);
          break;
        }
        case 'words': cmp = a.totalWordCount - b.totalWordCount; break;
      }
      return options.sortAsc ? cmp : -cmp;
    });
}

export function countPostsByStatus(posts: GeneratedPost[]): ContentPostStatusCounts {
  return {
    all: posts.length,
    generating: posts.filter(post => post.status === 'generating').length,
    needs_attention: posts.filter(post => post.status === 'needs_attention').length,
    error: posts.filter(post => post.status === 'error').length,
    draft: posts.filter(post => post.status === 'draft').length,
    review: posts.filter(post => post.status === 'review').length,
    approved: posts.filter(post => post.status === 'approved').length,
  };
}

export function useAdminPostWorkflow(workspaceId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tasks = useBackgroundTasks();
  const tasksJobsRef = useRef<BackgroundJob[]>(tasks.jobs);
  useEffect(() => { tasksJobsRef.current = tasks.jobs; }, [tasks.jobs]);

  const postsQ = useAdminPostsList(workspaceId);
  const posts = postsQ.data ?? [];
  const loading = postsQ.isLoading;
  const hasPublishTarget = usePublishTarget(workspaceId).data ?? false;
  const sendPostToClient = useSendPostToClient(workspaceId);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePostId, setActivePostId] = useState<string | null>(() => searchParams.get('post'));
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<ContentPostSortField>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ContentPostStatusFilter>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sendToClientPost, setSendToClientPost] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [publishingPost, setPublishingPost] = useState<string | null>(null);
  const [scoringVoice, setScoringVoice] = useState<string | null>(null);
  const [expandedVoice, setExpandedVoice] = useState<string | null>(null);

  const invalidatePosts = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });

  const awaitVoiceJob = (jobId: string, timeoutMs = 150_000): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const job = tasksJobsRef.current.find(entry => entry.id === jobId);
        if (job && isTerminalJobStatus(job.status)) {
          if (job.status === 'done') return resolve();
          return reject(new Error(job.error || 'Voice scoring failed'));
        }
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for voice scoring'));
        window.setTimeout(tick, 400);
      };
      tick();
    });
  };

  const closePostEditor = () => {
    setActivePostId(null);
    invalidatePosts();
    if (searchParams.get('post')) {
      const next = new URLSearchParams(searchParams);
      next.delete('post');
      setSearchParams(next, { replace: true });
    }
  };

  const publishPost = async (postId: string) => {
    setPublishingPost(postId);
    try {
      const result = await contentPosts.publishToWebflow(workspaceId, postId, {});
      if (result.success) {
        invalidatePosts();
      } else {
        toast(result.error || 'Publish failed', 'error');
      }
    } catch (err) {
      console.error('ContentManager publish failed:', err);
      toast(err instanceof Error ? err.message : 'Publish failed', 'error');
    }
    setPublishingPost(null);
  };

  const updateStatus = async (postId: string, status: string) => {
    setUpdatingStatus(postId);
    try {
      await contentPosts.update(workspaceId, postId, { status });
      invalidatePosts();
    } catch (err) {
      console.error('ContentManager status update failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    }
    setUpdatingStatus(null);
  };

  const beginSendToClient = (postId: string) => {
    setSendToClientPost(postId);
    setSendNote('');
  };

  const cancelSendToClient = () => {
    setSendToClientPost(null);
    setSendNote('');
  };

  const confirmSendToClient = (postId: string) => {
    const note = sendNote.trim();
    sendPostToClient.mutate(
      { postId, note: note || undefined },
      { onSuccess: cancelSendToClient },
    );
  };

  const deletePost = async (postId: string) => {
    try {
      await contentPosts.remove(workspaceId, postId);
      invalidatePosts();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('ContentManager delete failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to delete post', 'error');
    }
  };

  const scoreVoice = async (postId: string) => {
    setScoringVoice(postId);
    try {
      const { jobId } = await contentPosts.scoreVoice(workspaceId, postId);
      tasks.trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE, jobId, { workspaceId });
      await awaitVoiceJob(jobId);
      invalidatePosts();
    } catch (err) {
      console.error('ContentManager voice score failed:', err);
      toast(err instanceof Error ? err.message : 'Voice scoring failed', 'error');
    }
    setScoringVoice(null);
  };

  const filtered = filterAndSortPosts(posts, { search, statusFilter, sortField, sortAsc });
  const statusCounts = countPostsByStatus(posts);

  return {
    postsQ,
    posts,
    loading,
    hasPublishTarget,
    activePostId,
    setActivePostId,
    closePostEditor,
    search,
    setSearch,
    sortField,
    setSortField,
    sortAsc,
    setSortAsc,
    statusFilter,
    setStatusFilter,
    deleteConfirm,
    setDeleteConfirm,
    sendToClientPost,
    sendNote,
    setSendNote,
    sendPostToClient,
    beginSendToClient,
    cancelSendToClient,
    confirmSendToClient,
    updatingStatus,
    publishingPost,
    scoringVoice,
    expandedVoice,
    setExpandedVoice,
    filtered,
    statusCounts,
    publishPost,
    updateStatus,
    deletePost,
    scoreVoice,
  };
}
