import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, del, get, getSafe, getText, patch, post } from '../../api/client';
import { attachTrackedJob } from '../../lib/background-job-helpers';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { useToast } from '../../components/Toast';
import type { ContentBrief, ContentGenerationStyle, ContentTopicRequest, PostSummary } from '../../../shared/types/content';
import { DEFAULT_CONTENT_GENERATION_STYLE } from '../../../shared/types/content';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import { useAdminBriefsList, useAdminBriefTemplateCrossref, useAdminRequestsList } from './useAdminBriefs';
import { useAdminPostsList } from './useAdminPosts';

const BRIEF_ROUTES = ['seo-briefs', 'content-pipeline'] as const;
type BriefRoute = typeof BRIEF_ROUTES[number];

export type BriefSortField = 'date' | 'keyword' | 'difficulty';
export type BriefDeleteTarget =
  | { type: 'brief'; id: string; label: string; item: ContentBrief; originalIndex: number }
  | { type: 'request'; id: string; label: string; item: ContentTopicRequest; originalIndex: number };
export type PendingBriefDelete = Pick<BriefDeleteTarget, 'type' | 'id' | 'label'>;
export interface BriefWorkflowFixContext {
  targetRoute: string;
  pageId?: string;
  pageSlug?: string;
  pageName?: string;
  primaryKeyword?: string;
  searchIntent?: string;
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  autoGenerate?: boolean;
  pageType?: string;
  rationale?: string;
  competitorProof?: string;
  volume?: number;
  intent?: string;
  questionKeywords?: string[];
  serpFeatures?: string[];
}
export type RequestStatusUpdateExtra = {
  deliveryUrl?: string;
  deliveryNotes?: string;
  briefId?: string;
  clientFeedback?: string;
  serviceType?: 'brief_only' | 'full_post';
  upgradedAt?: string;
  internalNote?: string;
};

export function extractGeneratedBriefResult(result: unknown): { brief?: ContentBrief; briefId?: string; requestId?: string } | null {
  if (!result || typeof result !== 'object') return null;
  const candidate = result as { brief?: unknown; briefId?: unknown; requestId?: unknown };
  return {
    brief: candidate.brief && typeof candidate.brief === 'object' ? candidate.brief as ContentBrief : undefined,
    briefId: typeof candidate.briefId === 'string' ? candidate.briefId : undefined,
    requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
  };
}

export function renderBriefMarkdown(b: ContentBrief): string {
  const lines: string[] = [
    `# Content Brief: ${b.targetKeyword}`,
    '',
    `**Write a ${b.wordCountTarget}-word ${b.contentFormat || 'article'} targeting "${b.targetKeyword}".**`,
    '',
  ];
  if (b.executiveSummary) lines.push('## Strategic Context', b.executiveSummary, '');
  lines.push('## Title', b.suggestedTitle, '', '## Meta Description', b.suggestedMetaDesc, '');
  if (b.toneAndStyle) lines.push('## Tone & Style', b.toneAndStyle, '');
  lines.push('## Target Audience', b.audience, '');
  lines.push('## Search Intent', b.intent, '');
  if (b.secondaryKeywords.length) lines.push('## Keywords to Include', b.secondaryKeywords.map(k => `- ${k}`).join('\n'), '');
  if (b.topicalEntities?.length) lines.push('## Topical Entities to Cover', b.topicalEntities.map(e => `- ${e}`).join('\n'), '');
  if (b.peopleAlsoAsk?.length) lines.push('## Questions to Answer', b.peopleAlsoAsk.map((q, i) => `${i + 1}. ${q}`).join('\n'), '');
  if (b.outline.length) {
    lines.push('## Content Outline');
    b.outline.forEach(s => {
      lines.push(`### ${s.heading}${s.wordCount ? ` (~${s.wordCount} words)` : ''}`);
      lines.push(s.notes);
      if (s.keywords?.length) lines.push(`*Keywords: ${s.keywords.join(', ')}*`);
      lines.push('');
    });
  }
  if (b.ctaRecommendations?.length) lines.push('## CTAs', b.ctaRecommendations.map((c, i) => `- **${i === 0 ? 'Primary' : 'Secondary'}:** ${c}`).join('\n'), '');
  if (b.competitorInsights) lines.push('## Competitor Insights', b.competitorInsights, '');
  if (b.internalLinkSuggestions.length) lines.push('## Internal Links to Include', b.internalLinkSuggestions.map(l => `- /${l}`).join('\n'), '');
  if (b.serpAnalysis) {
    lines.push('## SERP Analysis');
    lines.push(`- Content type: ${b.serpAnalysis.contentType}`);
    lines.push(`- Avg word count: ${b.serpAnalysis.avgWordCount}`);
    if (b.serpAnalysis.gaps.length) lines.push(`- Gaps to exploit: ${b.serpAnalysis.gaps.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function useAdminBriefWorkflow({
  workspaceId,
  fixContext,
  clearFixContext,
}: {
  workspaceId: string;
  fixContext?: BriefWorkflowFixContext | null;
  clearFixContext?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { trackJob, jobs } = useBackgroundTasks();

  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword);
  const [generating, setGenerating] = useState(false);
  const [generatingBriefFor, setGeneratingBriefFor] = useState<string | null>(null);
  const [pendingStandaloneBriefJobId, setPendingStandaloneBriefJobId] = useState<string | null>(null);
  const [pendingRequestBriefJob, setPendingRequestBriefJob] = useState<{ jobId: string; requestId: string } | null>(null);
  const [businessCtx, setBusinessCtx] = useState('');
  const [generationStyle, setGenerationStyle] = useState<ContentGenerationStyle>(DEFAULT_CONTENT_GENERATION_STYLE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [loadingBrief, setLoadingBrief] = useState<string | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [briefSearch, setBriefSearch] = useState('');
  const [regenBriefJobId, setRegenBriefJobId] = useState<{ jobId: string; briefId: string; requestId?: string } | null>(null);
  const [regenOutlineJobId, setRegenOutlineJobId] = useState<{ jobId: string; briefId: string } | null>(null);
  const [briefSort, setBriefSort] = useState<BriefSortField>('date');
  const [deleteConfirm, setDeleteConfirm] = useState<BriefDeleteTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingBriefDelete | null>(null);
  const [editingBrief, setEditingBrief] = useState<string | null>(null);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [generatingPostFor, setGeneratingPostFor] = useState<string | null>(null);
  const [regeneratingBrief, setRegeneratingBrief] = useState<string | null>(null);
  const [regeneratingOutline, setRegeneratingOutline] = useState<string | null>(null);
  const [sendingToClient, setSendingToClient] = useState<string | null>(null);
  const [deliveringReqId, setDeliveringReqId] = useState<string | null>(null);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [pageType, setPageType] = useState('');
  const [refUrls, setRefUrls] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const briefsQ = useAdminBriefsList(workspaceId);
  const requestsQ = useAdminRequestsList(workspaceId);
  const postsQ = useAdminPostsList(workspaceId);
  const templateCrossrefQ = useAdminBriefTemplateCrossref(workspaceId, deferredKeyword);
  const rawBriefs = (briefsQ.data ?? []) as ContentBrief[];
  const rawClientRequests = (requestsQ.data ?? []) as ContentTopicRequest[];
  const briefs = pendingDelete?.type === 'brief'
    ? rawBriefs.filter(brief => brief.id !== pendingDelete.id)
    : rawBriefs;
  const clientRequests = pendingDelete?.type === 'request'
    ? rawClientRequests.filter(request => request.id !== pendingDelete.id)
    : rawClientRequests;
  const posts = (postsQ.data ?? []) as PostSummary[];
  const templateCrossref = templateCrossrefQ.data ?? null;
  const loading = briefsQ.isLoading || requestsQ.isLoading || postsQ.isLoading;
  const hasBlockingQueryError =
    (briefsQ.isError || requestsQ.isError || postsQ.isError) &&
    briefs.length === 0 &&
    clientRequests.length === 0 &&
    posts.length === 0;

  const fixContextRef = useRef<BriefWorkflowFixContext | null | undefined>(null);
  const fixConsumed = useRef(false);
  const autoGenTriggered = useRef(false);
  const pendingDeleteRef = useRef<(BriefDeleteTarget & { timerId: number }) | null>(null);

  const startBriefGenerationJob = async (params: Record<string, unknown>): Promise<string | null> => {
    try {
      const data = await post<{ jobId?: string }>('/api/jobs', {
        type: BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION,
        params,
      });
      if (!data.jobId) return null;
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, data.jobId, params);
      return data.jobId;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast('A content brief is already being generated for this workspace.', 'error');
        return null;
      }
      throw err;
    }
  };

  const updateRequestStatus = async (
    reqId: string,
    status: ContentTopicRequest['status'] | undefined,
    extra?: RequestStatusUpdateExtra,
  ) => {
    try {
      const body: Record<string, unknown> = { ...extra };
      if (status !== undefined) body.status = status;
      const updated = await patch<ContentTopicRequest>(`/api/content-requests/${workspaceId}/${reqId}`, body);
      queryClient.setQueryData<ContentTopicRequest[]>(queryKeys.admin.requests(workspaceId), old => (old ?? []).map(r => r.id === reqId ? updated : r));
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to update request status', 'error');
    }
  };

  const generateBrief = async () => {
    if (!keyword.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const jobId = await startBriefGenerationJob({
        workspaceId,
        targetKeyword: keyword.trim(),
        businessContext: businessCtx.trim() || undefined,
        targetPageId: fixContextRef.current?.pageId,
        targetPageSlug: fixContextRef.current?.pageSlug,
        pageType: pageType || undefined,
        generationStyle,
        referenceUrls: refUrls.trim() ? refUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http')) : undefined,
        pageAnalysisContext: fixContextRef.current?.optimizationIssues || fixContextRef.current?.recommendations || fixContextRef.current?.contentGaps || fixContextRef.current?.rationale
          ? {
              optimizationScore: fixContextRef.current.optimizationScore,
              optimizationIssues: fixContextRef.current.optimizationIssues,
              recommendations: fixContextRef.current.recommendations,
              contentGaps: fixContextRef.current.contentGaps,
              searchIntent: fixContextRef.current.searchIntent,
              rationale: fixContextRef.current.rationale,
              competitorProof: fixContextRef.current.competitorProof,
              volume: fixContextRef.current.volume,
              intent: fixContextRef.current.intent,
              questionKeywords: fixContextRef.current.questionKeywords,
              serpFeatures: fixContextRef.current.serpFeatures,
            }
          : undefined,
      });
      if (jobId) {
        setPendingStandaloneBriefJobId(jobId);
      } else {
        setGenerating(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief');
      setGenerating(false);
    }
  };

  const regenerateOutline = async (briefId: string, feedback?: string) => {
    setRegeneratingOutline(briefId);
    try {
      const res = await post<{ jobId: string }>(
        `/api/content-briefs/${workspaceId}/${briefId}/regenerate-outline`, { feedback }
      );
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, res.jobId, { workspaceId, briefId });
      setRegenOutlineJobId({ jobId: res.jobId, briefId });
      // Do NOT clear regeneratingOutline here — the watcher clears it.
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to regenerate outline', 'error');
      setRegeneratingOutline(null);
    }
  };

  const regenerateBrief = async (briefId: string, feedback: string, requestId?: string) => {
    setRegeneratingBrief(briefId);
    try {
      const res = await post<{ jobId: string }>(
        `/api/content-briefs/${workspaceId}/${briefId}/regenerate`, { feedback }
      );
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, res.jobId, { workspaceId, briefId });
      setRegenBriefJobId({ jobId: res.jobId, briefId, requestId });
      // Do NOT clear regeneratingBrief here — the watcher clears it.
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to regenerate brief', 'error');
      setRegeneratingBrief(null);
    }
  };

  const saveBriefField = async (briefId: string, updates: Partial<ContentBrief>) => {
    try {
      const updated = await patch<ContentBrief>(`/api/content-briefs/${workspaceId}/${briefId}`, updates);
      queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => (old ?? []).map(b => b.id === briefId ? updated : b));
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
    }
  };

  const getBriefById = (briefId: string) => briefs.find(b => b.id === briefId);

  const toggleRequestBrief = async (reqId: string, briefId: string) => {
    if (expandedRequest === reqId) { setExpandedRequest(null); setBriefError(null); return; }
    setBriefError(null);
    if (getBriefById(briefId)) { setExpandedRequest(reqId); return; }
    setLoadingBrief(reqId);
    try {
      const url = `/api/content-briefs/${workspaceId}/${briefId}`;
      try {
        const brief = await get<ContentBrief>(url);
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => [brief, ...(old ?? []).filter(b => b.id !== brief.id)]);
        setLoadingBrief(null);
        setExpandedRequest(reqId);
        return;
      } catch (err) {
        console.error('ContentBriefs operation failed:', err);
        try {
          const allBriefs = await getSafe<ContentBrief[]>(`/api/content-briefs/${workspaceId}`, []);
          if (Array.isArray(allBriefs)) {
            queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), allBriefs);
            const found = allBriefs.find((b: ContentBrief) => b.id === briefId);
            if (found) {
              setLoadingBrief(null);
              setExpandedRequest(reqId);
              return;
            }
          }
        } catch (fallbackErr) { console.error('ContentBriefs operation failed:', fallbackErr); }
      }
      setBriefError(`Brief "${briefId}" not found. The brief may have been lost after a server restart. Try regenerating.`);
      setExpandedRequest(reqId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBriefError(`Network error loading brief: ${msg}`);
      setExpandedRequest(reqId);
    }
    setLoadingBrief(null);
  };

  const deleteRequest = async (reqId: string) => {
    await del(`/api/content-requests/${workspaceId}/${reqId}`);
  };

  const copyAsMarkdown = (b: ContentBrief) => {
    navigator.clipboard.writeText(renderBriefMarkdown(b));
  };

  const exportClientHTML = (b: ContentBrief) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<p style="font-family:sans-serif;padding:40px">Loading PDF preview…</p>');
    getText(`/api/content-briefs/${workspaceId}/${b.id}/export`)
      .then(html => { w.document.open(); w.document.write(html); w.document.close(); })
      .catch(() => { w.location.href = `/api/content-briefs/${workspaceId}/${b.id}/export`; });
  };

  const sendToClient = async (b: ContentBrief, note?: string) => {
    setSendingToClient(b.id);
    try {
      const result = await post<{ ok: boolean; requestId: string }>(`/api/content-briefs/${workspaceId}/${b.id}/send-to-client`, note ? { note } : {});
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.requests(workspaceId) });
        toast('Brief sent to client');
      }
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast('Failed to send brief to client', 'error');
    }
    setSendingToClient(null);
  };

  const generateBriefForRequest = async (req: ContentTopicRequest, selectedGenerationStyle?: ContentGenerationStyle) => {
    setGeneratingBriefFor(req.id);
    try {
      const jobId = await startBriefGenerationJob({
        workspaceId,
        requestId: req.id,
        generationStyle: selectedGenerationStyle ?? generationStyle,
      });
      if (jobId) {
        setPendingRequestBriefJob({ jobId, requestId: req.id });
      } else {
        setGeneratingBriefFor(null);
      }
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to start brief generation', 'error');
      setGeneratingBriefFor(null);
    }
  };

  const generatePost = async (briefId: string, selectedGenerationStyle?: ContentGenerationStyle): Promise<boolean> => {
    setGeneratingPostFor(briefId);
    try {
      const skeleton = await post<PostSummary & { jobId?: string }>(`/api/content-posts/${workspaceId}/generate`, {
        briefId,
        generationStyle: selectedGenerationStyle,
      });
      if (skeleton.jobId) {
        attachTrackedJob({ trackJob }, BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, skeleton.jobId, { workspaceId });
      }
      queryClient.setQueryData<PostSummary[]>(queryKeys.admin.posts(workspaceId), old => [skeleton, ...(Array.isArray(old) ? old : [])]);
      setActivePostId(skeleton.id);
      return true;
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to generate post', 'error');
      return false;
    } finally {
      setGeneratingPostFor(null);
    }
  };

  const deleteBrief = async (briefId: string) => {
    await del(`/api/content-briefs/${workspaceId}/${briefId}`);
  };

  const confirmDeleteBrief = (brief: ContentBrief) => {
    if (pendingDeleteRef.current) {
      toast('Finish or undo the current delete before deleting another item.', 'info');
      return;
    }
    const originalIndex = rawBriefs.findIndex(item => item.id === brief.id);
    setDeleteConfirm({ type: 'brief', id: brief.id, label: brief.targetKeyword, item: brief, originalIndex: Math.max(originalIndex, 0) });
  };

  const confirmDeleteRequest = (req: ContentTopicRequest) => {
    if (pendingDeleteRef.current) {
      toast('Finish or undo the current delete before deleting another item.', 'info');
      return;
    }
    const originalIndex = rawClientRequests.findIndex(item => item.id === req.id);
    setDeleteConfirm({ type: 'request', id: req.id, label: req.topic, item: req, originalIndex: Math.max(originalIndex, 0) });
  };

  const removeDeletedFromCache = (target: BriefDeleteTarget) => {
    if (target.type === 'brief') {
      queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => (old ?? []).filter(b => b.id !== target.id));
      if (expanded === target.id) setExpanded(null);
      return;
    }
    queryClient.setQueryData<ContentTopicRequest[]>(queryKeys.admin.requests(workspaceId), old => (old ?? []).filter(r => r.id !== target.id));
    if (expandedRequest === target.id) setExpandedRequest(null);
  };

  const restoreDeletedToCache = (target: BriefDeleteTarget) => {
    if (target.type === 'brief') {
      queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => {
        const list = old ?? [];
        if (list.some(b => b.id === target.id)) return list;
        const next = [...list];
        next.splice(Math.min(target.originalIndex, next.length), 0, target.item);
        return next;
      });
      return;
    }
    queryClient.setQueryData<ContentTopicRequest[]>(queryKeys.admin.requests(workspaceId), old => {
      const list = old ?? [];
      if (list.some(r => r.id === target.id)) return list;
      const next = [...list];
      next.splice(Math.min(target.originalIndex, next.length), 0, target.item);
      return next;
    });
  };

  const clearPendingDeleteIfCurrent = (target: BriefDeleteTarget) => {
    if (pendingDeleteRef.current?.type === target.type && pendingDeleteRef.current.id === target.id) {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
    }
  };

  const commitDelete = async (target: BriefDeleteTarget) => {
    try {
      if (target.type === 'brief') {
        await deleteBrief(target.id);
      } else {
        await deleteRequest(target.id);
      }
      removeDeletedFromCache(target);
      clearPendingDeleteIfCurrent(target);
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      restoreDeletedToCache(target);
      clearPendingDeleteIfCurrent(target);
      toast(
        err instanceof Error
          ? err.message
          : `Failed to delete ${target.type === 'brief' ? 'brief' : 'request'}`,
        'error',
      );
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    if (pendingDeleteRef.current) {
      toast('Finish or undo the current delete before deleting another item.', 'info');
      setDeleteConfirm(null);
      return;
    }
    const target = deleteConfirm;
    await queryClient.cancelQueries({
      queryKey: target.type === 'brief'
        ? queryKeys.admin.briefs(workspaceId)
        : queryKeys.admin.requests(workspaceId),
    });
    removeDeletedFromCache(target);
    setDeleteConfirm(null);
    const timerId = window.setTimeout(() => {
      void commitDelete(target);
    }, 6000);
    pendingDeleteRef.current = { ...target, timerId };
    setPendingDelete({ type: target.type, id: target.id, label: target.label });
    toast(`${target.type === 'brief' ? 'Brief' : 'Request'} deleted. Undo is available for a few seconds.`, 'info');
  };

  const undoDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    restoreDeletedToCache(pending);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    toast(`${pending.type === 'brief' ? 'Brief' : 'Request'} restored.`);
  };

  const closePostEditor = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
    setActivePostId(null);
  };

  useEffect(() => {
    if (fixContext && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixContextRef.current = fixContext;
    }
  }, [fixContext]);

  useEffect(() => {
    if (fixContext && !fixConsumed.current && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixConsumed.current = true;
      const prefill = fixContext.primaryKeyword || fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
      if (fixContext.pageType) setPageType(fixContext.pageType);
      clearFixContext?.();
    }
  }, [fixContext, clearFixContext]);

  useEffect(() => {
    if (fixContextRef.current?.autoGenerate && !autoGenTriggered.current && keyword.trim() && !generating) {
      autoGenTriggered.current = true;
      void generateBrief();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors existing one-shot fixContext auto-generation behavior.
  }, [keyword]);

  useEffect(() => {
    if (!pendingStandaloneBriefJobId) return;
    const job = jobs.find(j => j.id === pendingStandaloneBriefJobId);
    if (!job) return;
    if (job.status === 'done') {
      const result = extractGeneratedBriefResult(job.result);
      if (result?.brief) {
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => [result.brief!, ...(old ?? [])]);
        setKeyword('');
        setExpanded(result.brief.id);
        fixContextRef.current = null;
      }
      setPendingStandaloneBriefJobId(null);
      setGenerating(false);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      setError(job.error || 'Failed to generate brief');
      setPendingStandaloneBriefJobId(null);
      setGenerating(false);
    }
  }, [jobs, pendingStandaloneBriefJobId, queryClient, workspaceId]);

  useEffect(() => {
    if (!pendingRequestBriefJob) return;
    const job = jobs.find(j => j.id === pendingRequestBriefJob.jobId);
    if (!job) return;
    if (job.status === 'done') {
      const result = extractGeneratedBriefResult(job.result);
      if (result?.brief) {
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => [result.brief!, ...(old ?? [])]);
        queryClient.setQueryData<ContentTopicRequest[]>(queryKeys.admin.requests(workspaceId), old => (old ?? []).map(r => r.id === pendingRequestBriefJob.requestId ? { ...r, status: 'brief_generated' as const, briefId: result.brief!.id } : r));
        setExpandedRequest(pendingRequestBriefJob.requestId);
      }
      setGeneratingBriefFor(null);
      setPendingRequestBriefJob(null);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      toast(job.error || 'Failed to generate brief', 'error');
      setGeneratingBriefFor(null);
      setPendingRequestBriefJob(null);
    }
  }, [jobs, pendingRequestBriefJob, queryClient, toast, workspaceId]);

  useEffect(() => {
    if (!regenBriefJobId) return;
    const job = jobs.find(j => j.id === regenBriefJobId.jobId);
    if (!job) return;
    if (job.status === 'done') {
      const result = extractGeneratedBriefResult(job.result);
      if (result?.brief) {
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => [result.brief!, ...(old ?? [])]);
        setExpanded(result.brief.id);
        if (regenBriefJobId.requestId) {
          void updateRequestStatus(regenBriefJobId.requestId, undefined, { briefId: result.brief.id });
        }
      }
      setRegenBriefJobId(null);
      setRegeneratingBrief(null);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      toast(job.error || 'Failed to regenerate brief', 'error');
      setRegenBriefJobId(null);
      setRegeneratingBrief(null);
    }
  }, [jobs, regenBriefJobId, queryClient, toast, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps -- updateRequestStatus is stable enough for the existing async watcher contract.

  useEffect(() => {
    if (!regenOutlineJobId) return;
    const job = jobs.find(j => j.id === regenOutlineJobId.jobId);
    if (!job) return;
    if (job.status === 'done') {
      const result = extractGeneratedBriefResult(job.result);
      if (result?.brief) {
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => (old ?? []).map(b => b.id === regenOutlineJobId.briefId ? result.brief! : b));
      }
      setRegenOutlineJobId(null);
      setRegeneratingOutline(null);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      toast(job.error || 'Failed to regenerate outline', 'error');
      setRegenOutlineJobId(null);
      setRegeneratingOutline(null);
    }
  }, [jobs, regenOutlineJobId, queryClient, toast, workspaceId]);

  useEffect(() => {
    if (!templateCrossref?.pageType) return;
    if (!pageType) {
      setPageType(templateCrossref.pageType);
    }
  }, [templateCrossref?.pageType, pageType]);

  return {
    activePostId,
    briefError,
    briefSearch,
    briefSort,
    briefs,
    briefsQ,
    businessCtx,
    clientRequests,
    deleteConfirm,
    pendingDelete,
    deliveringReqId,
    deliveryNotes,
    deliveryUrl,
    editingBrief,
    error,
    expanded,
    expandedRequest,
    generationStyle,
    generating,
    generatingBriefFor,
    generatingPostFor,
    hasBlockingQueryError,
    keyword,
    loading,
    loadingBrief,
    pageType,
    posts,
    postsQ,
    refUrls,
    regeneratingBrief,
    regeneratingOutline,
    requestsQ,
    sendingToClient,
    showAdvanced,
    templateCrossref,
    closePostEditor,
    confirmDeleteBrief,
    confirmDeleteRequest,
    copyAsMarkdown,
    executeDelete,
    exportClientHTML,
    generateBrief,
    generateBriefForRequest,
    generatePost,
    getBriefById,
    regenerateBrief,
    regenerateOutline,
    saveBriefField,
    sendToClient,
    setActivePostId,
    setBriefError,
    setBriefSearch,
    setBriefSort,
    setBusinessCtx,
    setDeleteConfirm,
    setDeliveringReqId,
    setDeliveryNotes,
    setDeliveryUrl,
    setEditingBrief,
    setExpanded,
    setExpandedRequest,
    setGenerationStyle,
    setKeyword,
    setPageType,
    setRefUrls,
    setShowAdvanced,
    toggleRequestBrief,
    undoDelete,
    updateRequestStatus,
  };
}
