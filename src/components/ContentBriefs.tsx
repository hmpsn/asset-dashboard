import { useState, useEffect, useRef, useDeferredValue } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post, patch, del, getSafe, getText } from '../api/client';
import {
  Trash2, AlertTriangle, PenLine, Clipboard, Search, X, ArrowUpDown,
} from 'lucide-react';
import { Badge, Icon, IconButton, ClickableRow, FormInput, FormSelect, Button, Modal, PageHeader, LoadingState, ErrorState, StatusBadge } from './ui';
import { formatDate } from '../utils/formatDates';
import type { FixContext } from '../App';
import type { ContentBrief, ContentGenerationStyle, ContentTopicRequest, PostSummary } from '../../shared/types/content';
import { DEFAULT_CONTENT_GENERATION_STYLE } from '../../shared/types/content';
import { PostEditor } from './PostEditor';
import { BriefGenerator } from './briefs/BriefGenerator';
import { RequestList } from './briefs/RequestList';
import { BriefList } from './briefs/BriefList';
import { useAdminBriefsList, useAdminRequestsList, useAdminPostsList, useAdminBriefTemplateCrossref } from '../hooks/admin';
import { queryKeys } from '../lib/queryKeys';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import { attachTrackedJob } from '../lib/background-job-helpers';
import { useToast } from './Toast';

/** targetRoute values that ContentBriefs recognises as legitimate brief-generation navigations.
 *  Any fixContext without one of these routes is treated as stale (e.g. from seo-editor). */
const BRIEF_ROUTES = ['seo-briefs', 'content-pipeline'] as const;
type BriefRoute = typeof BRIEF_ROUTES[number];

export function ContentBriefs({ workspaceId, fixContext, clearFixContext }: { workspaceId: string; fixContext?: FixContext | null; clearFixContext?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { trackJob, jobs } = useBackgroundTasks();
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword);
  const briefsQ = useAdminBriefsList(workspaceId);
  const requestsQ = useAdminRequestsList(workspaceId);
  const postsQ = useAdminPostsList(workspaceId);
  const templateCrossrefQ = useAdminBriefTemplateCrossref(workspaceId, deferredKeyword);
  const briefs = (briefsQ.data ?? []) as ContentBrief[];
  const clientRequests = (requestsQ.data ?? []) as ContentTopicRequest[];
  const posts = (postsQ.data ?? []) as PostSummary[];
  const templateCrossref = templateCrossrefQ.data ?? null;
  // Include postsQ — RequestList uses posts to decide between "Generate Post" and
  // "Open Post" buttons. If posts hasn't loaded yet we'd mistakenly show "Generate
  // Post" for briefs that already have one, causing duplicate post creation on click.
  const loading = briefsQ.isLoading || requestsQ.isLoading || postsQ.isLoading;
  const hasBlockingQueryError =
    (briefsQ.isError || requestsQ.isError || postsQ.isError) &&
    briefs.length === 0 &&
    clientRequests.length === 0 &&
    posts.length === 0;

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

  // ── fixContext lifecycle (3 refs, 3 effects) ──
  //
  // When the user navigates here from Page Intelligence or Content Gaps, fixContext
  // carries the page/keyword context. Three refs coordinate consumption:
  //
  //   fixContextRef   — snapshot of fixContext for handleGenerate to read after
  //                     clearFixContext() nulls the prop. Cleared after first generation
  //                     so subsequent manual briefs don't inherit stale page data.
  //
  //   fixConsumed     — ensures the keyword/pageType pre-fill runs exactly once per
  //                     navigation, even if fixContext re-renders before being cleared.
  //
  //   autoGenTriggered — gates the auto-generate effect so it fires once after keyword
  //                     is set, only when fixContext.autoGenerate was true.
  //
  // All three are guarded on BRIEF_ROUTES to ignore stale fixContext from other tabs.

  const fixContextRef = useRef<FixContext | null | undefined>(null);
  useEffect(() => {
    if (fixContext && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixContextRef.current = fixContext;
    }
  }, [fixContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext && !fixConsumed.current && BRIEF_ROUTES.includes(fixContext.targetRoute as BriefRoute)) {
      fixConsumed.current = true;
      const prefill = fixContext.primaryKeyword || fixContext.pageName || fixContext.pageSlug || '';
      if (prefill) setKeyword(prefill.replace(/-/g, ' '));
      if (fixContext.pageType) setPageType(fixContext.pageType);
      clearFixContext?.();
    }
  }, [fixContext]);

  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (fixContextRef.current?.autoGenerate && !autoGenTriggered.current && keyword.trim() && !generating) {
      autoGenTriggered.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  function extractGeneratedBriefResult(result: unknown): { brief?: ContentBrief; briefId?: string; requestId?: string } | null {
    if (!result || typeof result !== 'object') return null;
    const candidate = result as { brief?: unknown; briefId?: unknown; requestId?: unknown };
    return {
      brief: candidate.brief && typeof candidate.brief === 'object' ? candidate.brief as ContentBrief : undefined,
      briefId: typeof candidate.briefId === 'string' ? candidate.briefId : undefined,
      requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
    };
  }

  async function startBriefGenerationJob(params: Record<string, unknown>): Promise<string | null> {
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
  }

  // effect-layout-ok — reacts to async background job completion, not first-paint layout derivation.
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

  // effect-layout-ok — reacts to async background job completion, not first-paint layout derivation.
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

  // Job IDs for regen operations that switched to the async background-job contract (W6.2).
  // When set, we watch jobs[] for completion and clear the corresponding regenerating* state.
  const [regenBriefJobId, setRegenBriefJobId] = useState<{ jobId: string; briefId: string; requestId?: string } | null>(null);
  const [regenOutlineJobId, setRegenOutlineJobId] = useState<{ jobId: string; briefId: string } | null>(null);

  // Watch for brief-regen job completion (W6.2 async contract).
  // The BRIEF_UPDATED broadcast from the server invalidates the briefs query automatically
  // via wsInvalidation; here we just clear local spinner state and expand the new brief.
  // effect-layout-ok — reacts to async background job completion, not first-paint layout derivation.
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
          void handleUpdateRequestStatus(regenBriefJobId.requestId, undefined, { briefId: result.brief.id });
        }
      }
      setRegenBriefJobId(null);
      setRegeneratingBrief(null);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      toast(job.error || 'Failed to regenerate brief', 'error');
      setRegenBriefJobId(null);
      setRegeneratingBrief(null);
    }
  }, [jobs, regenBriefJobId, queryClient, toast, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps -- handleUpdateRequestStatus is stable; including it would require memo

  // Watch for outline-regen job completion (W6.2 async contract).
  // effect-layout-ok — reacts to async background job completion, not first-paint layout derivation.
  useEffect(() => {
    if (!regenOutlineJobId) return;
    const job = jobs.find(j => j.id === regenOutlineJobId.jobId);
    if (!job) return;
    if (job.status === 'done') {
      const result = extractGeneratedBriefResult(job.result);
      if (result?.brief) {
        queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => (old ?? []).map(b => b.id === regenOutlineJobId!.briefId ? result.brief! : b));
      }
      setRegenOutlineJobId(null);
      setRegeneratingOutline(null);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      toast(job.error || 'Failed to regenerate outline', 'error');
      setRegenOutlineJobId(null);
      setRegeneratingOutline(null);
    }
  }, [jobs, regenOutlineJobId, queryClient, toast, workspaceId]);

  const [briefSort, setBriefSort] = useState<'date' | 'keyword' | 'difficulty'>('date');
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'brief' | 'request'; id: string; label: string } | null>(null);
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

  useEffect(() => {
    if (!templateCrossref?.pageType) return;
    if (!pageType) {
      setPageType(templateCrossref.pageType);
    }
  }, [templateCrossref?.pageType, pageType]);

  // W6.2: POST .../regenerate-outline always returns 202 { jobId } — sync fallback removed.
  const handleRegenerateOutline = async (briefId: string, feedback?: string) => {
    setRegeneratingOutline(briefId);
    try {
      const res = await post<{ jobId: string }>(
        `/api/content-briefs/${workspaceId}/${briefId}/regenerate-outline`, { feedback }
      );
      // Job was enqueued; watcher effect will clear state on completion.
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, res.jobId, { workspaceId, briefId });
      setRegenOutlineJobId({ jobId: res.jobId, briefId });
      // Do NOT clear regeneratingOutline here — the watcher clears it.
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to regenerate outline', 'error');
      setRegeneratingOutline(null);
    }
  };

  // W6.2: POST .../regenerate always returns 202 { jobId } — sync fallback removed.
  const handleRegenerateBrief = async (briefId: string, feedback: string, requestId?: string) => {
    setRegeneratingBrief(briefId);
    try {
      const res = await post<{ jobId: string }>(
        `/api/content-briefs/${workspaceId}/${briefId}/regenerate`, { feedback }
      );
      // Job was enqueued; watcher effect handles result + state clear.
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
      // auto-save degradation — field reverts to server value on next refetch; no toast (background, user-unaware)
    }
  };

  const getBriefById = (briefId: string) => briefs.find(b => b.id === briefId);

  const toggleRequestBrief = async (reqId: string, briefId: string) => {
    if (expandedRequest === reqId) { setExpandedRequest(null); setBriefError(null); return; }
    setBriefError(null);
    // If brief already in local state, just expand
    if (getBriefById(briefId)) { setExpandedRequest(reqId); return; }
    // Not in local state — try fetching individually
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
        // Individual fetch failed — try refetching the full list as fallback
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
        } catch (err) { console.error('ContentBriefs operation failed:', err); }
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

  const handleDeleteRequest = async (reqId: string) => {
    try {
      await del(`/api/content-requests/${workspaceId}/${reqId}`);
      queryClient.setQueryData<ContentTopicRequest[]>(queryKeys.admin.requests(workspaceId), old => (old ?? []).filter(r => r.id !== reqId));
      if (expandedRequest === reqId) setExpandedRequest(null);
    } catch (err) {
      console.error('ContentBriefs operation failed:', err);
      toast(err instanceof Error ? err.message : 'Failed to delete request', 'error');
    }
  };

  const copyAsMarkdown = (b: ContentBrief) => {
    const lines: string[] = [
      `# Content Brief: ${b.targetKeyword}`,
      '',
      `**Write a ${b.wordCountTarget}-word ${b.contentFormat || 'article'} targeting "${b.targetKeyword}".**`,
      '',
    ];
    if (b.executiveSummary) lines.push(`## Strategic Context`, b.executiveSummary, '');
    lines.push(`## Title`, b.suggestedTitle, '', `## Meta Description`, b.suggestedMetaDesc, '');
    if (b.toneAndStyle) lines.push(`## Tone & Style`, b.toneAndStyle, '');
    lines.push(`## Target Audience`, b.audience, '');
    lines.push(`## Search Intent`, b.intent, '');
    if (b.secondaryKeywords.length) lines.push(`## Keywords to Include`, b.secondaryKeywords.map(k => `- ${k}`).join('\n'), '');
    if (b.topicalEntities?.length) lines.push(`## Topical Entities to Cover`, b.topicalEntities.map(e => `- ${e}`).join('\n'), '');
    if (b.peopleAlsoAsk?.length) lines.push(`## Questions to Answer`, b.peopleAlsoAsk.map((q, i) => `${i + 1}. ${q}`).join('\n'), '');
    if (b.outline.length) {
      lines.push(`## Content Outline`);
      b.outline.forEach(s => {
        lines.push(`### ${s.heading}${s.wordCount ? ` (~${s.wordCount} words)` : ''}`);
        lines.push(s.notes);
        if (s.keywords?.length) lines.push(`*Keywords: ${s.keywords.join(', ')}*`);
        lines.push('');
      });
    }
    if (b.ctaRecommendations?.length) lines.push(`## CTAs`, b.ctaRecommendations.map((c, i) => `- **${i === 0 ? 'Primary' : 'Secondary'}:** ${c}`).join('\n'), '');
    if (b.competitorInsights) lines.push(`## Competitor Insights`, b.competitorInsights, '');
    if (b.internalLinkSuggestions.length) lines.push(`## Internal Links to Include`, b.internalLinkSuggestions.map(l => `- /${l}`).join('\n'), '');
    if (b.serpAnalysis) {
      lines.push(`## SERP Analysis`);
      lines.push(`- Content type: ${b.serpAnalysis.contentType}`);
      lines.push(`- Avg word count: ${b.serpAnalysis.avgWordCount}`);
      if (b.serpAnalysis.gaps.length) lines.push(`- Gaps to exploit: ${b.serpAnalysis.gaps.join('; ')}`);
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n'));
  };

  const exportClientHTML = (b: ContentBrief) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<p style="font-family:sans-serif;padding:40px">Loading PDF preview…</p>');
    getText(`/api/content-briefs/${workspaceId}/${b.id}/export`)
      .then(html => { w.document.open(); w.document.write(html); w.document.close(); })
      .catch(() => { w.location.href = `/api/content-briefs/${workspaceId}/${b.id}/export`; });
  };

  const handleSendToClient = async (b: ContentBrief) => {
    setSendingToClient(b.id);
    try {
      const result = await post<{ ok: boolean; requestId: string }>(`/api/content-briefs/${workspaceId}/${b.id}/send-to-client`);
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


  const handleGenerateBriefForRequest = async (req: ContentTopicRequest, selectedGenerationStyle?: ContentGenerationStyle) => {
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

  const handleGeneratePost = async (briefId: string, selectedGenerationStyle?: ContentGenerationStyle): Promise<boolean> => {
    setGeneratingPostFor(briefId);
    try {
      const skeleton = await post<PostSummary & { jobId?: string }>(`/api/content-posts/${workspaceId}/generate`, {
        briefId,
        generationStyle: selectedGenerationStyle,
      });
      if (skeleton.jobId) {
        attachTrackedJob({ trackJob }, BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, skeleton.jobId, { workspaceId });
      }
      queryClient.setQueryData(queryKeys.admin.posts(workspaceId), (old: unknown) => [skeleton, ...(Array.isArray(old) ? old : [])]);
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

  const handleUpdateRequestStatus = async (reqId: string, status: ContentTopicRequest['status'] | undefined, extra?: { deliveryUrl?: string; deliveryNotes?: string; briefId?: string; clientFeedback?: string; serviceType?: 'brief_only' | 'full_post'; upgradedAt?: string }) => {
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

  const handleGenerate = async () => {
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
              // Brief pre-seed: 6 new fields from Content Gaps / strategy layer (Lane E)
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

  const handleDelete = async (briefId: string) => {
    await del(`/api/content-briefs/${workspaceId}/${briefId}`);
    queryClient.setQueryData<ContentBrief[]>(queryKeys.admin.briefs(workspaceId), old => (old ?? []).filter(b => b.id !== briefId));
    if (expanded === briefId) setExpanded(null);
    setDeleteConfirm(null);
  };

  const confirmDeleteBrief = (brief: ContentBrief) => {
    setDeleteConfirm({ type: 'brief', id: brief.id, label: brief.targetKeyword });
  };

  const confirmDeleteRequest = (req: ContentTopicRequest) => {
    setDeleteConfirm({ type: 'request', id: req.id, label: req.topic });
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'brief') {
      await handleDelete(deleteConfirm.id);
    } else {
      await handleDeleteRequest(deleteConfirm.id);
    }
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <LoadingState message="Loading briefs, client requests, and generated posts..." size="lg" className="py-16" />
    );
  }

  if (hasBlockingQueryError) {
    return (
      <ErrorState
        title="Couldn't load content pipeline data"
        message="Briefs, requests, or post data failed to load. Try reloading this workspace."
        actions={[
          {
            label: 'Retry',
            onClick: () => {
              void briefsQ.refetch();
              void requestsQ.refetch();
              void postsQ.refetch();
            },
          },
          {
            label: 'Refresh page',
            onClick: () => window.location.reload(),
            variant: 'secondary',
          },
        ]}
        type="data"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Delete Confirmation Modal */}
      <Modal open={Boolean(deleteConfirm)} onClose={() => setDeleteConfirm(null)} size="sm">
        <Modal.Header
          title={`Delete ${deleteConfirm?.type === 'brief' ? 'Brief' : 'Request'}?`}
          onClose={() => setDeleteConfirm(null)}
        />
        {deleteConfirm && (
          <>
            <Modal.Body>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-pill)] bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon as={AlertTriangle} size="lg" className="text-accent-danger" />
                </div>
                <div className="min-w-0">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">This action cannot be undone.</p>
                  <p className="t-caption-sm text-[var(--brand-text)]">
                    <span className="text-[var(--brand-text-bright)] font-medium">&ldquo;{deleteConfirm.label}&rdquo;</span> will be permanently removed.
                  </p>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={executeDelete}>Delete</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/* Active Post Editor */}
      {activePostId && (
        // pr-check-disable-next-line -- Post editor shell uses the brand signature radius outside SectionCard because PostEditor owns its inner chrome.
        <div className="bg-[var(--surface-2)] border border-blue-500/20 p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <PostEditor
            key={activePostId}
            workspaceId={workspaceId}
            postId={activePostId}
            onClose={() => setActivePostId(null)}
            onDelete={() => { queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) }); setActivePostId(null); }}
          />
        </div>
      )}

      <PageHeader
        title="Content Briefs"
        subtitle={`${briefs.length} total brief${briefs.length === 1 ? '' : 's'}`}
        icon={<Icon as={Clipboard} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon as={Search} size="md" className="text-[var(--brand-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <FormInput
                type="text"
                value={briefSearch}
                onChange={setBriefSearch}
                placeholder="Search briefs..."
                className="w-48 pl-8 pr-7 t-caption-sm"
              />
              {briefSearch && (
                <IconButton
                  onClick={() => setBriefSearch('')}
                  icon={X}
                  label="Clear search"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                />
              )}
            </div>
            <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <Icon as={ArrowUpDown} size="sm" />
              <FormSelect value={briefSort} onChange={value => setBriefSort(value as 'date' | 'keyword' | 'difficulty')} options={[
                { value: 'date', label: 'Newest' },
                { value: 'keyword', label: 'Keyword A-Z' },
                { value: 'difficulty', label: 'Difficulty' },
              ]} className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded px-1.5 py-1 t-caption-sm text-[var(--brand-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 cursor-pointer" />
            </div>
          </div>
        }
      />

      {/* Generator */}
      <BriefGenerator
        workspaceId={workspaceId}
        keyword={keyword}
        businessCtx={businessCtx}
        pageType={pageType}
        generationStyle={generationStyle}
        refUrls={refUrls}
        showAdvanced={showAdvanced}
        generating={generating}
        error={error}
        templateCrossref={templateCrossref}
        onKeywordChange={setKeyword}
        onBusinessCtxChange={setBusinessCtx}
        onPageTypeChange={setPageType}
        onGenerationStyleChange={setGenerationStyle}
        onRefUrlsChange={setRefUrls}
        onToggleAdvanced={() => setShowAdvanced(v => !v)}
        onGenerate={handleGenerate}
      />

      {/* Client Requests */}
      <RequestList
        clientRequests={clientRequests}
        expandedRequest={expandedRequest}
        generatingBriefFor={generatingBriefFor}
        loadingBrief={loadingBrief}
        briefError={briefError}
        deliveringReqId={deliveringReqId}
        deliveryUrl={deliveryUrl}
        deliveryNotes={deliveryNotes}
        getBriefById={getBriefById}
        onToggleRequestBrief={toggleRequestBrief}
        onGenerateBriefForRequest={handleGenerateBriefForRequest}
        generationStyle={generationStyle}
        onGenerationStyleChange={setGenerationStyle}
        onUpdateRequestStatus={handleUpdateRequestStatus}
        onConfirmDeleteRequest={confirmDeleteRequest}
        onSetDeliveringReqId={setDeliveringReqId}
        onSetDeliveryUrl={setDeliveryUrl}
        onSetDeliveryNotes={setDeliveryNotes}
        onSetBriefError={setBriefError}
        onSetExpandedRequest={setExpandedRequest}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        editingBrief={editingBrief}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        regeneratingBrief={regeneratingBrief}
        onRegenerateBrief={handleRegenerateBrief}
        regeneratingOutline={regeneratingOutline}
        onRegenerateOutline={handleRegenerateOutline}
        sendingToClient={sendingToClient}
        posts={posts}
        generatingPostFor={generatingPostFor}
        onGeneratePost={handleGeneratePost}
        onOpenPost={setActivePostId}
      />

      {/* Generated Posts list */}
      {posts.length > 0 && !activePostId && (
        // pr-check-disable-next-line -- Generated-post list is a compact non-SectionCard shell around selectable rows.
        <div className="bg-[var(--surface-2)] border border-blue-500/20 p-4 space-y-3" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Icon as={PenLine} size="md" className="text-accent-info" />
            <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">Generated Posts</span>
            <Badge label={`${posts.length}`} tone="blue" variant="outline" />
          </div>
          <div className="space-y-2">
            {posts.map(post => {
              return (
                <ClickableRow
                  key={post.id}
                  onClick={() => setActivePostId(post.id)}
                  className="w-full text-left rounded-[var(--radius-lg)] bg-[var(--surface-1)] border border-[var(--brand-border)] px-3 py-2.5 hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="t-caption-sm font-medium text-[var(--brand-text-bright)] truncate">{post.title}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">"{post.targetKeyword}" · {post.totalWordCount.toLocaleString()} words</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={post.status} domain="content" fallback="neutral" variant="outline" />
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">{formatDate(post.createdAt)}</span>
                    </div>
                  </div>
                </ClickableRow>
              );
            })}
          </div>
        </div>
      )}

      {/* Briefs list (standalone — not linked to a request) */}
      <BriefList
        briefs={briefs}
        clientRequests={clientRequests as any}
        expanded={expanded}
        briefSearch={briefSearch}
        briefSort={briefSort}
        editingBrief={editingBrief}
        generatingPostFor={generatingPostFor}
        regeneratingBrief={regeneratingBrief}
        sendingToClient={sendingToClient}
        onSetExpanded={setExpanded}
        onSetBriefSearch={setBriefSearch}
        onSetBriefSort={setBriefSort}
        onSetEditingBrief={setEditingBrief}
        onSaveBriefField={saveBriefField}
        onGeneratePost={handleGeneratePost}
        onRegenerateBrief={handleRegenerateBrief}
        onCopyAsMarkdown={copyAsMarkdown}
        onExportClientHTML={exportClientHTML}
        onSendToClient={handleSendToClient}
        onConfirmDeleteBrief={confirmDeleteBrief}
        onRegenerateOutline={handleRegenerateOutline}
        regeneratingOutline={regeneratingOutline}
      />
    </div>
  );
}
