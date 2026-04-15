import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { adminPath, type Page } from '../routes';
import { redirects as redirectsApi } from '../api/misc';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { useQueryClient } from '@tanstack/react-query';
import { post, put, del, getSafe, getOptional } from '../api/client';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { useAuditTrafficMap, useAuditSuppressions, useAuditSchedule } from '../hooks/admin';
import type { AuditSchedule } from '../hooks/admin/useAdminSeo';
import { seoBulkJobs } from '../api/seo';
import { queryKeys } from '../lib/queryKeys';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../lib/wsEvents';
import {
  ChevronDown, ChevronRight,
  CheckCircle, Globe, FileText,
  X, Clock, Share2, Copy, ExternalLink,
  TrendingDown, Sparkles, EyeOff, AlertTriangle, Link2Off, Download,
  Wrench, ArrowRight, Plus, BookOpen,
} from 'lucide-react';
import { StatCard, scoreColorClass, scoreBgBarClass, ErrorState, LoadingState, NextStepsCard } from './ui';
import { StatusBadge } from './ui/StatusBadge';
import { ErrorBoundary } from './ErrorBoundary';
import { statusBorderClass } from './ui/statusConfig';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { AuditHistory } from './audit/AuditHistory';
import { SeoAuditGuide } from './audit/SeoAuditGuide';
import {
  type Severity, type CheckCategory, type SeoIssue, type PageSeoResult,
  type SeoAuditResult, type SnapshotSummary, type CwvStrategyResult,
  SEVERITY_CONFIG, CRITICAL_CHECKS, MODERATE_CHECKS,
} from './audit/types';
import { ReportModal, ReportViewer } from './audit/AuditReportExport';
import { AuditIssueRow } from './audit/AuditIssueRow';
import { AuditBatchActions } from './audit/AuditBatchActions';
import { AuditToolbar, AuditCategoryFilter } from './audit/AuditFilters';

// ── Lazy-loaded sub-tools ──
const AeoReview = lazyWithRetry(() => import('./AeoReview'));
const ContentDecay = lazyWithRetry(() => import('./ContentDecay'));


interface Props {
  siteId: string;
  workspaceId?: string;
  siteName?: string;
}

type AuditSubTab = 'audit' | 'history' | 'aeo-review' | 'content-decay' | 'guide';

function SeoAudit({ siteId, workspaceId, siteName }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { startJob, jobs, cancelJob } = useBackgroundTasks();
  const auditJobId = useRef<string | null>(null);
  const [data, setData] = useState<SeoAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [auditSubTab, setAuditSubTab] = useState<AuditSubTab>(() => {
    const sub = searchParams.get('sub');
    const valid: AuditSubTab[] = ['audit', 'history', 'aeo-review', 'content-decay', 'guide'];
    return valid.includes(sub as AuditSubTab) ? (sub as AuditSubTab) : 'audit';
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<CheckCategory | 'all'>('all');
  const [reportModal, setReportModal] = useState(false);
  const [reportView, setReportView] = useState<'html' | 'csv' | null>(null);
  const [history, setHistory] = useState<SnapshotSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [skipLinkCheck, setSkipLinkCheck] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);

  // Dead link details — inline redirect form
  const [redirectFormUrl, setRedirectFormUrl] = useState<string | null>(null);
  const [redirectFormTo, setRedirectFormTo] = useState('');
  const [pendingRedirects, setPendingRedirects] = useState<Map<string, string>>(new Map());
  const [savingRedirect, setSavingRedirect] = useState(false);
  const [applyingFix, setApplyingFix] = useState<string | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [actionMenuKey, setActionMenuKey] = useState<string | null>(null);

  // Traffic intelligence (#12) — React Query
  const { data: trafficMap = {} } = useAuditTrafficMap(siteId);
  const [sortMode, setSortMode] = useState<'issues' | 'traffic'>('issues');

  // Unified page edit states
  const { getState, summary } = usePageEditStates(workspaceId);

  // Audit issue suppressions — React Query
  const { data: suppressions = [] } = useAuditSuppressions(workspaceId);

  const suppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await post<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pageSlug });
      queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    } catch (err) { console.error('Failed to suppress issue:', err); }
    setActionMenuKey(null);
  };

  const unsuppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await del<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pageSlug });
      queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    } catch (err) { console.error('Failed to unsuppress issue:', err); }
  };

  const suppressPattern = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    const prefix = pageSlug.includes('/') ? pageSlug.split('/')[0] : pageSlug;
    const pattern = `${prefix}/*`;
    try {
      const { suppressions: updated } = await post<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pagePattern: pattern, reason: `Pattern: ${pattern}` });
      queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    } catch (err) { console.error('Failed to suppress pattern:', err); }
    setActionMenuKey(null);
  };

  const acceptSuggestion = async (pageId: string, issue: SeoIssue) => {
    if (!issue.suggestedFix) return;
    const fixKey = `${pageId}-${issue.check}`;
    const text = editedSuggestions[fixKey] || issue.suggestedFix;
    setApplyingFix(fixKey);
    try {
      const fields: Record<string, unknown> = {};
      if (issue.check === 'title') {
        fields.seo = { title: text };
      } else if (issue.check === 'meta-description') {
        fields.seo = { description: text };
      } else if (issue.check === 'og-tags' && issue.message.includes('title')) {
        fields.openGraph = { title: text };
      } else if (issue.check === 'og-tags' && issue.message.includes('description')) {
        fields.openGraph = { description: text };
      }
      const result = await put<{ success?: boolean }>(`/api/webflow/pages/${pageId}/seo`, { siteId, ...fields });
      if (result.success) {
        setAppliedFixes(prev => new Set(prev).add(fixKey));
      }
    } catch (err) {
      console.error('Failed to apply fix:', err);
    } finally {
      setApplyingFix(null);
    }
  };

  // Send issue for client review via approval batch
  const [sentForReview, setSentForReview] = useState<Set<string>>(new Set());
  const [sendingReview, setSendingReview] = useState<string | null>(null);

  const sendForReview = async (page: PageSeoResult, issue: SeoIssue) => {
    if (!workspaceId) return;
    const fixKey = `${page.pageId}-${issue.check}`;
    const text = editedSuggestions[fixKey] || issue.suggestedFix || '';
    const field = issue.check === 'title' ? 'seoTitle' : 'seoDescription';
    setSendingReview(fixKey);
    try {
      await post(`/api/approvals/${workspaceId}`, {
        siteId,
        name: `Audit Fix: ${issue.message.slice(0, 60)}`,
        items: [{
          pageId: page.pageId,
          pageTitle: page.page,
          pageSlug: page.slug,
          field,
          currentValue: issue.value || '',
          proposedValue: text,
          reason: issue.recommendation || issue.message,
        }],
      });
      setSentForReview(prev => new Set(prev).add(fixKey));
    } catch (err) { console.error('Failed to send for review:', err); }
    finally { setSendingReview(null); }
  };

  // Audit → Task pipeline
  const [createdTasks, setCreatedTasks] = useState<Set<string>>(new Set());
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [batchCreating, setBatchCreating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ count: number; timestamp: number } | null>(null);

  // Send-to-client state
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flaggedIssues, setFlaggedIssues] = useState<Set<string>>(new Set());
  const [flagSending, setFlagSending] = useState(false);

  const flagForClient = async (page: PageSeoResult, issue: SeoIssue, note: string) => {
    if (!workspaceId) return;
    const key = issueToTaskKey(page, issue);
    const fixKey = `${page.pageId}-${issue.check}`;
    const suggestion = editedSuggestions[fixKey] || issue.suggestedFix || '';
    const field = issue.check === 'title' ? 'seoTitle' : issue.check === 'meta-description' ? 'seoDescription' : 'seoDescription';
    setFlagSending(true);
    try {
      await post(`/api/approvals/${workspaceId}`, {
        siteId,
        name: `[Review] ${issue.message.slice(0, 60)}`,
        items: [{
          pageId: page.pageId,
          pageTitle: page.page,
          pageSlug: page.slug,
          field,
          currentValue: issue.value || '',
          proposedValue: suggestion || `${issue.recommendation}${note ? `\n\nNote: ${note}` : ''}`,
          reason: issue.recommendation || issue.message,
        }],
      });
      setFlaggedIssues(prev => new Set(prev).add(key));
      setFlaggingKey(null);
      setFlagNote('');
    } catch (err) { console.error('Failed to flag for client:', err); }
    finally { setFlagSending(false); }
  };

  const issueToTaskKey = (page: PageSeoResult, issue: SeoIssue) =>
    `${page.pageId}-${issue.check}-${issue.message.slice(0, 30)}`;

  const issueToTaskItem = (page: PageSeoResult, issue: SeoIssue) => {
    const fixKey = `${page.pageId}-${issue.check}`;
    const edited = editedSuggestions[fixKey];
    const suggestion = edited || issue.suggestedFix;
    return {
      title: `[Audit] ${issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'} ${issue.check}: ${issue.message.slice(0, 80)}`,
      description: `Page: ${page.page}\nSlug: ${page.slug}\n\nIssue: ${issue.message}\n\nRecommendation: ${issue.recommendation}${suggestion ? `\n\nAI Suggestion: ${suggestion}` : ''}${issue.value ? `\n\nCurrent value: ${issue.value}` : ''}`,
      category: 'seo',
      priority: issue.severity === 'error' ? 'high' : 'medium',
      pageUrl: page.slug,
    };
  };

  const createTaskFromIssue = async (page: PageSeoResult, issue: SeoIssue) => {
    if (!workspaceId) return;
    const taskKey = issueToTaskKey(page, issue);
    setCreatingTask(taskKey);
    try {
      const item = issueToTaskItem(page, issue);
      await post('/api/requests', { workspaceId, ...item });
      setCreatedTasks(prev => new Set(prev).add(taskKey));
    } catch (err) { console.error('Failed to create task:', err); }
    finally { setCreatingTask(null); }
  };

  const batchCreateTasks = async (mode: 'all' | 'errors' | 'filtered') => {
    if (!workspaceId || !data) return;
    setBatchCreating(true);
    try {
      const pages = mode === 'filtered' ? filteredPages : data.pages;
      const items: ReturnType<typeof issueToTaskItem>[] = [];
      const keys: string[] = [];
      for (const page of pages) {
        const issues = mode === 'errors'
          ? page.issues.filter(i => i.severity === 'error')
          : mode === 'filtered'
            ? page.issues
                .filter(i => severityFilter === 'all' || i.severity === severityFilter)
                .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
            : page.issues;
        for (const issue of issues) {
          const key = issueToTaskKey(page, issue);
          if (!createdTasks.has(key)) {
            items.push(issueToTaskItem(page, issue));
            keys.push(key);
          }
        }
      }
      if (items.length === 0) { setBatchCreating(false); return; }
      const result = await post<{ created: number }>('/api/requests/batch', { workspaceId, items });
      setCreatedTasks(prev => {
        const next = new Set(prev);
        keys.forEach(k => next.add(k));
        return next;
      });
      setBatchResult({ count: result.created, timestamp: Date.now() });
    } catch (err) { console.error('Failed to batch create tasks:', err); }
    finally { setBatchCreating(false); }
  };

  // Scheduled audit state — React Query
  const { data: schedule = null } = useAuditSchedule(workspaceId);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(7);
  const [scheduleThreshold, setScheduleThreshold] = useState(5);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Sync schedule form fields when query data arrives
  useEffect(() => {
    if (schedule) { setScheduleInterval(schedule.intervalDays); setScheduleThreshold(schedule.scoreDropThreshold); }
  }, [schedule]);

  const saveSchedule = async (enabled: boolean) => {
    if (!workspaceId) return;
    setScheduleSaving(true);
    try {
      const updated = await put<AuditSchedule>(`/api/audit-schedules/${workspaceId}`, { enabled, intervalDays: scheduleInterval, scoreDropThreshold: scheduleThreshold });
      queryClient.setQueryData(queryKeys.admin.auditSchedule(workspaceId), updated);
    } catch (err) { console.error('Failed to save schedule:', err); }
    finally { setScheduleSaving(false); }
  };

  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAcceptJobId, setBulkAcceptJobId] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // ── WebSocket handlers for background bulk accept ──
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.BULK_OPERATION_PROGRESS]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; done: number; total: number; failed?: number; appliedKey?: string | null };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        setBulkProgress({ done: d.done, total: d.total });
        // Mark fix as applied in real-time via WS (one key per progress event)
        if (d.appliedKey) {
          setAppliedFixes(prev => new Set([...prev, d.appliedKey!]));
        }
      }
    },
    [WS_EVENTS.BULK_OPERATION_COMPLETE]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; applied: number; failed: number; total: number; appliedKeys?: string[] };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        if (d.appliedKeys?.length) {
          setAppliedFixes(prev => {
            const next = new Set(prev);
            for (const key of d.appliedKeys!) next.add(key);
            return next;
          });
        }
        setBulkApplying(false);
        setBulkProgress(null);
        setBulkAcceptJobId(null);
      }
    },
    [WS_EVENTS.BULK_OPERATION_FAILED]: (rawData: unknown) => {
      const d = rawData as { jobId: string; operation: string; error: string };
      if (d.operation === 'bulk-accept-fixes' && d.jobId === bulkAcceptJobId) {
        setBulkApplying(false);
        setBulkProgress(null);
        setBulkAcceptJobId(null);
        setBulkError('Bulk fix application failed: ' + d.error);
        setTimeout(() => setBulkError(null), 8000);
      }
    },
  });

  const acceptAllSuggestions = async () => {
    if (!data || !workspaceId) return;
    // Collect all fixable issues across all pages
    const fixes: { pageId: string; check: string; suggestedFix: string; message?: string; pageSlug?: string; pageName?: string }[] = [];
    for (const page of data.pages) {
      for (const issue of page.issues) {
        const fixKey = `${page.pageId}-${issue.check}`;
        if (issue.suggestedFix && !appliedFixes.has(fixKey)) {
          const text = editedSuggestions[fixKey] || issue.suggestedFix;
          fixes.push({ pageId: page.pageId, check: issue.check, suggestedFix: text, message: issue.message, pageSlug: page.slug, pageName: page.page });
        }
      }
    }
    if (fixes.length === 0) return;
    setBulkApplying(true);
    setBulkProgress({ done: 0, total: fixes.length });
    try {
      const { jobId } = await seoBulkJobs.bulkAcceptFixes(workspaceId, {
        siteId,
        fixes,
      });
      setBulkAcceptJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk accept:', err);
      setBulkApplying(false);
      setBulkProgress(null);
    }
  };

  const cancelBulkApply = () => {
    if (bulkAcceptJobId) {
      cancelJob(bulkAcceptJobId);
    }
    setBulkApplying(false);
    setBulkProgress(null);
    setBulkAcceptJobId(null);
  };

  const runAudit = async () => {
    setLoading(true);
    setHasRun(true);
    setAuditError(null);
    setShowNextSteps(false);
    const jobId = await startJob('seo-audit', { siteId, workspaceId, skipLinkCheck });
    if (jobId) {
      auditJobId.current = jobId;
    } else {
      setAuditError('Failed to start audit job');
      setLoading(false);
    }
  };

  const loadHistory = useCallback(() => {
    getSafe<SnapshotSummary[]>(`/api/reports/${siteId}/history`, [])
      .then(h => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {});
  }, [siteId]);

  // Watch for audit job completion via WebSocket-driven jobs array
  useEffect(() => {
    if (!auditJobId.current) return;
    const job = jobs.find(j => j.id === auditJobId.current);
    if (!job) return;
    if (job.status === 'done' && job.result) {
      const d = job.result as SeoAuditResult & { snapshotId?: string };
      if (d && Array.isArray(d.pages)) {
        setData(d);
        setShowNextSteps(true);
        loadHistory(); // Refresh history — snapshot was auto-saved server-side
      } else {
        setAuditError('Invalid audit response');
      }
      setLoading(false);
      auditJobId.current = null;
    } else if (job.status === 'error') {
      setAuditError(job.error || 'Audit failed');
      setLoading(false);
      auditJobId.current = null;
    }
  }, [jobs, loadHistory]);

  useEffect(() => {
    // Check for existing completed or running seo-audit job for this site
    const existingJob = jobs
      .filter(j => j.type === 'seo-audit' && j.status === 'done' && j.result && j.workspaceId === workspaceId)
      .find(j => {
        const r = j.result as SeoAuditResult;
        return r && Array.isArray(r.pages);
      });
    const runningJob = jobs.find(j => j.type === 'seo-audit' && (j.status === 'running' || j.status === 'pending') && j.workspaceId === workspaceId);

    if (existingJob && !data) {
      setData(existingJob.result as SeoAuditResult);
      setHasRun(true);
    } else if (runningJob && !auditJobId.current) {
      auditJobId.current = runningJob.id;
      setLoading(true);
      setHasRun(true);
    } else if (!existingJob && !runningJob && !data) {
      // No in-memory job — try loading latest persisted snapshot from disk
      getOptional<{ id: string; audit: SeoAuditResult }>(`/api/reports/${siteId}/latest`)
        .then(snapshot => {
          if (snapshot && snapshot.audit && Array.isArray(snapshot.audit.pages)) {
            setData({ ...snapshot.audit, snapshotId: snapshot.id } as SeoAuditResult & { snapshotId: string });
            setHasRun(true);
          }
        })
        .catch(() => {});
    }
    setAuditError(null);
    loadHistory();
  }, [siteId, loadHistory, data, jobs, workspaceId]);

  const handleSaveAndShare = async () => {
    if (!data) return;
    setSaving(true);
    setShareUrl(null);
    try {
      // Use auto-saved snapshot ID if available (avoids creating duplicates)
      const autoId = (data as SeoAuditResult & { snapshotId?: string }).snapshotId;
      if (autoId) {
        const url = `${window.location.origin}/report/${autoId}`;
        setShareUrl(url);
        setSaving(false);
        return;
      }
      // Fallback: manual save for audits that weren't auto-saved
      const result = await post<{ id: string }>(`/api/reports/${siteId}/snapshot`, { siteName: siteName || siteId, audit: data });
      const url = `${window.location.origin}/report/${result.id}`;
      setShareUrl(url);
      loadHistory();
    } catch (err) {
      console.error('Save and share failed:', err);
      alert('Failed to save report. Check your connection.');
    }
    setSaving(false);
  };

  const copyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportDeadLinksCSV = () => {
    const links = effectiveData?.deadLinkDetails;
    if (!links || links.length === 0) return;
    const rows = links.map(l => {
      const redirectTo = pendingRedirects.get(l.url) || '';
      return [l.url, String(l.status), l.statusText, l.type, l.foundOn, l.anchorText, redirectTo]
        .map(v => `"${v.replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = 'Broken URL,Status,Status Text,Type,Found On,Anchor Text,Redirect To\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dead-links.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveRedirect = async (fromUrl: string) => {
    const toUrl = redirectFormTo.trim();
    if (!toUrl) return;
    setSavingRedirect(true);
    try {
      // Persist locally and attempt server save
      setPendingRedirects(prev => new Map(prev).set(fromUrl, toUrl));
      try {
        await redirectsApi.save(siteId, { rules: [{ from: fromUrl, to: toUrl }] });
      } catch { /* server save is best-effort */ }
      setRedirectFormUrl(null);
      setRedirectFormTo('');
    } finally {
      setSavingRedirect(false);
    }
  };

  const toggleExpand = (page: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page); else next.add(page);
      return next;
    });
  };


  const handleExportReport = () => {
    setReportModal(false);
    setReportView('html');
  };

  const handleExportCSV = () => {
    setReportModal(false);
    setReportView('csv');
  };

  // Effective audit data with suppressions applied (filters issues, recalculates scores)
  const effectiveData = useMemo(() => {
    if (!data) return null;
    const exactSupps = suppressions.filter(s => !s.pagePattern);
    const patternSupps = suppressions.filter(s => s.pagePattern);
    const suppSet = new Set(exactSupps.map(s => `${s.check}:${s.pageSlug}`));
    if (suppSet.size === 0 && patternSupps.length === 0) return data;

    // Simple glob matcher for client-side pattern filtering
    const patternMatchers = patternSupps.map(s => {
      const escaped = s.pagePattern!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
      return { check: s.check, regex: new RegExp(`^${regexStr}$`, 'i') };
    });

    const pages = data.pages.map(page => {
      const filtered = page.issues.filter(i => {
        if (suppSet.has(`${i.check}:${page.slug}`)) return false;
        for (const pm of patternMatchers) {
          if (pm.check === i.check && pm.regex.test(page.slug)) return false;
        }
        return true;
      });
      if (filtered.length === page.issues.length) return page;
      let score = 100;
      for (const issue of filtered) {
        const isCritical = CRITICAL_CHECKS.has(issue.check);
        const isModerate = MODERATE_CHECKS.has(issue.check);
        if (issue.severity === 'error') score -= isCritical ? 15 : 10;
        else if (issue.severity === 'warning') score -= isCritical ? 5 : isModerate ? 3 : 2;
        // info: no score impact (industry standard)
      }
      score = Math.max(0, Math.min(100, score));
      return { ...page, issues: filtered, score };
    });

    const errors = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'error').length, 0);
    const warnings = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'warning').length, 0);
    const infos = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'info').length, 0);
    // Exclude noindex pages from site score — they don't affect search rankings
    const indexedPages = pages.filter(p => !p.noindex);
    const siteScore = indexedPages.length > 0 ? Math.round(indexedPages.reduce((sum, p) => sum + p.score, 0) / indexedPages.length) : 0;

    return { ...data, pages, errors, warnings, infos, siteScore };
  }, [data, suppressions]);

  // ── Audit view — with sub-tabs ──
  const auditTabBar = (
    <div className="flex items-center gap-1 border-b border-zinc-800 pb-0 mb-4">
      {([
        { id: 'audit' as const, label: 'Site Audit', icon: Globe },
        { id: 'history' as const, label: 'History', icon: Clock },
      ] as const).map(t => (
        <button
          key={t.id}
          onClick={() => setAuditSubTab(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
            auditSubTab === t.id
              ? 'border-teal-500 text-teal-300'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <t.icon className="w-3.5 h-3.5" />
          {t.label}
        </button>
      ))}
      <div className="w-px h-4 bg-zinc-700 mx-1 self-center" />
      {([
        { id: 'content-decay' as const, label: 'Content Health', icon: TrendingDown },
        { id: 'aeo-review' as const, label: 'AI Search Ready', icon: Sparkles },
      ] as const).map(t => (
        <button
          key={t.id}
          onClick={() => setAuditSubTab(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
            auditSubTab === t.id
              ? 'border-teal-500 text-teal-300'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <t.icon className="w-3.5 h-3.5" />
          {t.label}
        </button>
      ))}
      <div className="w-px h-4 bg-zinc-700 mx-1 self-center" />
      <button
        onClick={() => setAuditSubTab('guide')}
        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
          auditSubTab === 'guide'
            ? 'border-teal-500 text-teal-300'
            : 'border-transparent text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <BookOpen className="w-3.5 h-3.5" />
        Guide
      </button>
    </div>
  );

  if (auditSubTab === 'guide') return <div>{auditTabBar}<SeoAuditGuide /></div>;

  if (auditSubTab === 'content-decay' && workspaceId) {
    return <div>{auditTabBar}<Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-amber-400" /></div>}><ContentDecay workspaceId={workspaceId} /></Suspense></div>;
  }
  if (auditSubTab === 'aeo-review' && workspaceId) {
    return <div>{auditTabBar}<Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-purple-400" /></div>}><AeoReview workspaceId={workspaceId} /></Suspense></div>;
  }
  if (auditSubTab === 'history') {
    return <div>{auditTabBar}<AuditHistory siteId={siteId} history={history} onRefresh={loadHistory} /></div>;
  }

  if (!hasRun) {
    return (
      <div>
        {auditTabBar}
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
            <Globe className="w-8 h-8 text-zinc-500" />
          </div>
          <p className="text-zinc-400 text-sm">Comprehensive SEO audit for your Webflow site</p>
          <p className="text-xs text-zinc-500 max-w-md text-center">
            Checks titles, meta descriptions, headings, Open Graph, canonical tags, structured data, content length, and more
          </p>
          <button
            onClick={runAudit}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition-colors"
          >
            Run SEO Audit
          </button>
          <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!skipLinkCheck}
              onChange={e => setSkipLinkCheck(!e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-zinc-900"
            />
            Include dead link scan
          </label>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {auditTabBar}
        <LoadingState message="Analyzing site health..." />
      </div>
    );
  }

  if (!data) return (
    <div>
      {auditTabBar}
      {auditError && (
        <ErrorState
          type="general"
          title="SEO Audit Failed"
          message={auditError}
          action={{ label: 'Run Again', onClick: runAudit }}
        />
      )}
    </div>
  );

  const filteredPages = effectiveData!.pages
    .filter(p => {
      if (severityFilter === 'all') return true;
      return p.issues.some(i => i.severity === severityFilter);
    })
    .filter(p => {
      if (categoryFilter === 'all') return true;
      return p.issues.some(i => i.category === categoryFilter);
    })
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.page.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) ||
        p.issues.some(i => i.message.toLowerCase().includes(q) || i.check.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortMode === 'traffic') {
        const aSlug = `/${a.slug}`;
        const bSlug = `/${b.slug}`;
        const aT = trafficMap[aSlug];
        const bT = trafficMap[bSlug];
        const aScore = (aT?.clicks || 0) + (aT?.pageviews || 0);
        const bScore = (bT?.clicks || 0) + (bT?.pageviews || 0);
        if (bScore !== aScore) return bScore - aScore;
      }
      const aErrors = a.issues.filter(i => i.severity === 'error').length;
      const bErrors = b.issues.filter(i => i.severity === 'error').length;
      if (bErrors !== aErrors) return bErrors - aErrors;
      const aWarnings = a.issues.filter(i => i.severity === 'warning').length;
      const bWarnings = b.issues.filter(i => i.severity === 'warning').length;
      if (bWarnings !== aWarnings) return bWarnings - aWarnings;
      return a.score - b.score;
    });

  return (
    <ErrorBoundary label="SEO Audit">
    <div className="space-y-8">
      {auditTabBar}
      {showNextSteps && data && (
        <NextStepsCard
          title={`Audit complete: ${(effectiveData?.errors ?? 0) + (effectiveData?.warnings ?? 0)} issues found`}
          variant="success"
          onDismiss={() => setShowNextSteps(false)}
          staggerIndex={0}
          steps={[
            {
              label: 'Review top issues',
              description: `${effectiveData?.errors ?? 0} errors to resolve`,
              onClick: () => { setShowNextSteps(false); setTimeout(() => document.getElementById('audit-issues-section')?.scrollIntoView({ behavior: 'smooth' }), 150); },
              estimatedTime: '5 min',
            },
          ]}
        />
      )}
      {/* Summary cards */}
      <div className={`grid gap-3 ${effectiveData!.deadLinkSummary ? 'grid-cols-6' : 'grid-cols-5'}`}>
        <div className="col-span-1 flex flex-col gap-1.5">
          <StatCard
            label="Site Score"
            value={effectiveData!.siteScore}
            valueColor={scoreColorClass(effectiveData!.siteScore)}
            delta={history.length >= 2 ? history[0].siteScore - history[1].siteScore : undefined}
            deltaLabel=" from last audit"
            size="hero"
            staggerIndex={0}
          />
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBgBarClass(effectiveData!.siteScore)}`} style={{ width: `${effectiveData!.siteScore}%` }} />
          </div>
        </div>
        <StatCard label="Pages Scanned" value={effectiveData!.totalPages} size="hero" staggerIndex={0} />
        <StatCard label="Errors" value={effectiveData!.errors} valueColor="text-red-400" onClick={() => setSeverityFilter(severityFilter === 'error' ? 'all' : 'error')} sub={severityFilter === 'error' ? '↑ Filtering' : 'Click to filter'} className={severityFilter === 'error' ? '!border-red-500/60 !bg-red-500/5' : ''} size="hero" staggerIndex={1} />
        <StatCard label="Warnings" value={effectiveData!.warnings} valueColor="text-amber-400" onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')} sub={severityFilter === 'warning' ? '↑ Filtering' : 'Click to filter'} className={severityFilter === 'warning' ? '!border-amber-500/60 !bg-amber-500/5' : ''} size="hero" staggerIndex={2} />
        <StatCard label="Info" value={effectiveData!.infos} valueColor="text-blue-400" onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')} sub={severityFilter === 'info' ? '↑ Filtering' : 'Click to filter'} className={severityFilter === 'info' ? '!border-blue-500/60 !bg-blue-500/5' : ''} size="hero" staggerIndex={3} />
        {effectiveData!.deadLinkSummary && (
          <StatCard
            label="Broken Links"
            value={effectiveData!.deadLinkSummary.total}
            icon={Link2Off}
            valueColor={effectiveData!.deadLinkSummary.internal > 0 ? 'text-red-400' : effectiveData!.deadLinkSummary.total > 0 ? 'text-amber-400' : 'text-emerald-400'}
            sub={effectiveData!.deadLinkSummary.total === 0 ? 'All links healthy' : `${effectiveData!.deadLinkSummary.internal} internal · ${effectiveData!.deadLinkSummary.external} external`}
            size="hero"
            staggerIndex={4}
            onClick={workspaceId ? () => navigate(adminPath(workspaceId, 'links') + '?tab=dead-links') : undefined}
          />
        )}
      </div>

      {/* Contextual tool tips based on audit findings */}
      {(() => {
        const allIssues = effectiveData!.pages.flatMap(p => p.issues);
        const hasMetaIssues = allIssues.some(i => ['missing_title', 'title_length', 'missing_meta', 'meta_length', 'missing_h1', 'duplicate_h1'].includes(i.check));
        const hasRedirectIssues = allIssues.some(i => ['redirect_chain', 'broken_link', 'missing_canonical'].includes(i.check));
        const hasPerformanceIssues = allIssues.some(i => i.category === 'performance');
        const hasSchemaIssues = allIssues.some(i => ['missing_schema', 'schema_errors'].includes(i.check));
        const tips: { icon: typeof Globe; label: string; tool: string }[] = [];
        if (hasMetaIssues) tips.push({ icon: FileText, label: 'Fix titles & meta descriptions in the SEO Editor', tool: 'SEO Editor' });
        if (hasRedirectIssues) tips.push({ icon: AlertTriangle, label: 'Review redirect chains in the Redirects tool', tool: 'Redirects' });
        if (hasSchemaIssues) tips.push({ icon: Globe, label: 'Generate structured data with the Schema tool', tool: 'Schema' });
        if (hasPerformanceIssues) tips.push({ icon: TrendingDown, label: 'Check page weight & speed in the Performance tab', tool: 'Performance' });
        if (tips.length === 0) return null;
        return (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800 flex-wrap">
            <span className="text-[11px] text-zinc-500 font-medium tracking-wider mr-1">Quick fixes →</span>
            {tips.map(tip => (
              <span key={tip.tool} className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
                <tip.icon className="w-3 h-3" /> {tip.label}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Scheduled Audit Settings */}
      {workspaceId && (
        <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-300">Scheduled Audits</span>
              {schedule?.enabled && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
              )}
              {schedule?.lastRunAt && (
                <span className="text-[11px] text-zinc-500">Last: {new Date(schedule.lastRunAt).toLocaleDateString()}</span>
              )}
            </div>
            <button onClick={() => setShowSchedule(!showSchedule)} className="text-[11px] text-teal-400 hover:text-teal-300">
              {showSchedule ? 'Hide' : 'Configure'}
            </button>
          </div>
          {showSchedule && (
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-zinc-500 block mb-1">Run Every</label>
                  <select value={scheduleInterval} onChange={e => setScheduleInterval(Number(e.target.value))}
                    className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-300">
                    <option value={1}>Daily</option>
                    <option value={7}>Weekly</option>
                    <option value={14}>Every 2 Weeks</option>
                    <option value={30}>Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 block mb-1">Alert on Score Drop &gt;</label>
                  <select value={scheduleThreshold} onChange={e => setScheduleThreshold(Number(e.target.value))}
                    className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-300">
                    <option value={3}>3 points</option>
                    <option value={5}>5 points</option>
                    <option value={10}>10 points</option>
                    <option value={15}>15 points</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!schedule?.enabled ? (
                  <button onClick={() => saveSchedule(true)} disabled={scheduleSaving}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors">
                    {scheduleSaving ? 'Saving...' : 'Enable Schedule'}
                  </button>
                ) : (
                  <>
                    <button onClick={() => saveSchedule(true)} disabled={scheduleSaving}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors">
                      {scheduleSaving ? 'Saving...' : 'Update'}
                    </button>
                    <button onClick={() => saveSchedule(false)} disabled={scheduleSaving}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50 transition-colors">
                      Disable
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Core Web Vitals Summary — the actual Google ranking signal */}
      {data.cwvSummary && (data.cwvSummary.mobile || data.cwvSummary.desktop) && (() => {
        const ratingColor = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
          r === 'good' ? 'text-emerald-400' : r === 'needs-improvement' ? 'text-amber-400' : r === 'poor' ? 'text-red-400' : 'text-zinc-500';
        const ratingBg = (r: CwvStrategyResult['metrics']['LCP']['rating']) =>
          r === 'good' ? 'bg-emerald-500/10 border-emerald-500/30' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/30' : r === 'poor' ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/50 border-zinc-700/30';
        const assessBadge = (a: CwvStrategyResult['assessment']) =>
          a === 'good' ? { text: 'Passed', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
          : a === 'needs-improvement' ? { text: 'Needs Work', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
          : a === 'poor' ? { text: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
          : { text: 'No Data', cls: 'bg-zinc-800/50 text-zinc-500 border-zinc-700/30' };

        const renderStrategy = (label: string, s: CwvStrategyResult) => {
          const badge = assessBadge(s.assessment);
          return (
            <div key={label} className="flex-1 min-w-[260px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-zinc-400 tracking-wider">{label}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>{badge.text}</span>
              </div>
              {/* CWV Metrics */}
              <div className="space-y-2">
                {[
                  { key: 'LCP' as const, label: 'LCP', fmt: (v: number) => `${(v / 1000).toFixed(1)}s`, desc: 'Largest Contentful Paint' },
                  { key: 'INP' as const, label: 'INP', fmt: (v: number) => `${Math.round(v)}ms`, desc: 'Interaction to Next Paint' },
                  { key: 'CLS' as const, label: 'CLS', fmt: (v: number) => v.toFixed(2), desc: 'Cumulative Layout Shift' },
                ].map(m => {
                  const metric = s.metrics[m.key];
                  return (
                    <div key={m.key} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${ratingBg(metric.rating)}`}>
                      <div>
                        <span className="text-xs font-medium text-zinc-300">{m.label}</span>
                        <span className="text-[11px] text-zinc-500 ml-1.5">{m.desc}</span>
                      </div>
                      <span className={`text-sm font-mono font-medium ${ratingColor(metric.rating)}`}>
                        {metric.value !== null ? m.fmt(metric.value) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Lighthouse lab score — secondary */}
              <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                <span className="text-[11px] text-zinc-500">Lighthouse Lab Score</span>
                <span className={`text-xs font-mono font-medium ${s.lighthouseScore >= 90 ? 'text-emerald-400' : s.lighthouseScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {s.lighthouseScore}/100
                </span>
              </div>
              {!s.fieldDataAvailable && (
                <div className="mt-1.5 text-[11px] text-zinc-500 italic px-1">
                  No real-user data (CrUX) — metrics are from lab simulation
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-300">Core Web Vitals</span>
              <span className="text-[11px] text-zinc-500">— Google ranking signal (real-user data)</span>
            </div>
            <div className="flex gap-4 flex-wrap">
              {data.cwvSummary!.mobile && renderStrategy('Mobile', data.cwvSummary!.mobile)}
              {data.cwvSummary!.desktop && renderStrategy('Desktop', data.cwvSummary!.desktop)}
            </div>
          </div>
        );
      })()}

      {/* Site-wide issues */}
      {data.siteWideIssues.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 p-5 space-y-2" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="text-sm font-medium text-zinc-300 mb-2">Site-Wide Issues</div>
          {data.siteWideIssues.map((issue, idx) => {
            const cfg = SEVERITY_CONFIG[issue.severity];
            const Icon = cfg.icon;
            return (
              <div key={idx} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-zinc-950/50">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300">{issue.message}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{issue.recommendation}</div>
                  {issue.value && <div className="text-xs text-zinc-500 mt-0.5 italic truncate">{issue.value}</div>}
                  {issue.suggestedFix && (
                    <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
                      <div className="text-[11px] text-emerald-500 font-semibold uppercase tracking-wider mb-0.5">AI Suggestion</div>
                      <div className="text-xs text-emerald-300">{issue.suggestedFix}</div>
                    </div>
                  )}
                </div>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Dead Link Details Panel */}
      {effectiveData!.deadLinkDetails && effectiveData!.deadLinkDetails.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Link2Off className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-zinc-300">Broken Links</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                {effectiveData!.deadLinkDetails.length}
              </span>
              {pendingRedirects.size > 0 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {pendingRedirects.size} redirect{pendingRedirects.size !== 1 ? 's' : ''} queued
                </span>
              )}
            </div>
            <button
              onClick={exportDeadLinksCSV}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors"
            >
              <Download className="w-3 h-3" /> Export CSV
            </button>
          </div>
          <div className="space-y-1.5">
            {effectiveData!.deadLinkDetails.map((link, idx) => {
              const isFormOpen = redirectFormUrl === link.url;
              const hasRedirect = pendingRedirects.has(link.url);
              return (
                <div key={idx} className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                  <div className="flex items-start gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[11px] px-1 py-px rounded border font-mono flex-shrink-0 ${link.status === 404 || link.status === '404' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                          {link.status}
                        </span>
                        <span className={`text-[10px] px-1 py-px rounded border flex-shrink-0 ${link.type === 'internal' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-zinc-700/50 text-zinc-400 border-zinc-600/50'}`}>
                          {link.type}
                        </span>
                        <span className="text-xs text-zinc-300 font-mono truncate">{link.url}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-zinc-500">Found on:</span>
                        <span className="text-[11px] text-zinc-400 truncate">{link.foundOn || link.foundOnSlug}</span>
                        {link.anchorText && (
                          <>
                            <span className="text-[11px] text-zinc-600">·</span>
                            <span className="text-[11px] text-zinc-500 italic truncate">"{link.anchorText}"</span>
                          </>
                        )}
                      </div>
                      {hasRedirect && !isFormOpen && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <ArrowRight className="w-3 h-3 text-teal-400" />
                          <span className="text-[11px] text-teal-400 font-mono">{pendingRedirects.get(link.url)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {workspaceId && link.type === 'internal' && (
                        <button
                          onClick={() => navigate(adminPath(workspaceId, 'seo-editor' as Page), {
                            state: { fixContext: { targetRoute: 'seo-editor', pageSlug: link.foundOnSlug, pageName: link.foundOn, issueCheck: 'broken_link', issueMessage: `Broken link: ${link.url}` } },
                          })}
                          className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors"
                          title="Open source page in SEO Editor"
                        >
                          <Wrench className="w-2.5 h-2.5" /> Fix
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (isFormOpen) { setRedirectFormUrl(null); setRedirectFormTo(''); }
                          else { setRedirectFormUrl(link.url); setRedirectFormTo(hasRedirect ? pendingRedirects.get(link.url)! : ''); }
                        }}
                        className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${hasRedirect ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'}`}
                        title="Create a redirect for this URL"
                      >
                        <Plus className="w-2.5 h-2.5" /> {hasRedirect ? 'Edit Redirect' : 'Add Redirect'}
                      </button>
                    </div>
                  </div>
                  {isFormOpen && (
                    <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
                      <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                      <input
                        type="text"
                        value={redirectFormTo}
                        onChange={e => setRedirectFormTo(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRedirect(link.url); if (e.key === 'Escape') { setRedirectFormUrl(null); setRedirectFormTo(''); } }}
                        placeholder="/new-path or https://example.com/new"
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-teal-500"
                        autoFocus
                      />
                      <button
                        onClick={() => saveRedirect(link.url)}
                        disabled={!redirectFormTo.trim() || savingRedirect}
                        className="px-2.5 py-1 rounded text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
                      >
                        {savingRedirect ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setRedirectFormUrl(null); setRedirectFormTo(''); }}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <AuditToolbar
        search={search}
        onSearchChange={setSearch}
        saving={saving}
        onSaveAndShare={handleSaveAndShare}
        onOpenExportModal={() => setReportModal(true)}
        effectiveData={effectiveData!}
        appliedFixes={appliedFixes}
        bulkApplying={bulkApplying}
        bulkProgress={bulkProgress}
        onAcceptAllSuggestions={acceptAllSuggestions}
        onCancelBulkApply={cancelBulkApply}
        onRunAudit={runAudit}
      />

      {/* Bulk operation error banner */}
      {bulkError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{bulkError}</span>
          <button onClick={() => setBulkError(null)} className="ml-auto p-0.5 rounded hover:bg-white/10">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Share URL banner */}
      {shareUrl && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: 'rgba(45,212,191,0.1)', border: '1px solid rgba(46,217,195,0.2)' }}>
          <Share2 className="w-4 h-4 flex-shrink-0 text-teal-400" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-teal-400">Report saved! Share this link with clients:</div>
            <div className="text-xs text-zinc-300 truncate mt-0.5 font-mono">{shareUrl}</div>
          </div>
          <button onClick={copyShareUrl} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors bg-teal-400 text-[#0f1219]">
            <Copy className="w-3 h-3" /> {copied ? 'Copied!' : 'Copy'}
          </button>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-white/10 text-teal-400">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button onClick={() => setShareUrl(null)} className="p-1 rounded hover:bg-white/10" aria-label="Dismiss share URL">
            <X className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      )}

      {/* Category filter pills */}
      <div id="audit-issues-section" />
      <AuditCategoryFilter categoryFilter={categoryFilter} onSetCategoryFilter={setCategoryFilter} />

      {/* Showing count + batch actions */}
      <AuditBatchActions
        effectiveData={effectiveData!}
        filteredPages={filteredPages}
        workspaceId={workspaceId}
        severityFilter={severityFilter}
        categoryFilter={categoryFilter}
        suppressions={suppressions}
        batchCreating={batchCreating}
        batchResult={batchResult}
        onBatchCreateTasks={batchCreateTasks}
        onUnsuppressAll={async () => {
          for (const s of suppressions) {
            if (s.pagePattern) {
              try {
                const { suppressions: updated } = await del<{ suppressions: typeof suppressions }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check: s.check, pagePattern: s.pagePattern });
                if (workspaceId) queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
              } catch (err) { console.error('Failed to unsuppress:', err); }
            } else {
              await unsuppressIssue(s.check, s.pageSlug);
            }
          }
        }}
        onClearFilters={() => { setSeverityFilter('all'); setCategoryFilter('all'); }}
        sortMode={sortMode}
        onSetSortMode={setSortMode}
        hasTraffic={Object.keys(trafficMap).length > 0}
      />

      {/* Edit status summary bar */}
      {summary.total > 0 && (
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mb-2">
          <span className="text-zinc-400 font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <><StatusBadge status="live" /><span className="text-teal-400">{summary.live}</span></>}
          {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-purple-400">{summary.inReview}</span></>}
          {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-green-400">{summary.approved}</span></>}
          {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-red-400">{summary.rejected}</span></>}
          {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-amber-400">{summary.issueDetected}</span></>}
          {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-blue-400">{summary.fixProposed}</span></>}
        </div>
      )}

      {/* Page list */}
      <div className="space-y-2">
        {filteredPages.map(page => {
          const isExpanded = expanded.has(page.page);
          const errorCount = page.issues.filter(i => i.severity === 'error').length;
          const warningCount = page.issues.filter(i => i.severity === 'warning').length;
          const pageTraffic = trafficMap[`/${page.slug}`];
          const pageState = getState(page.pageId);
          const trackBorder = statusBorderClass(pageState?.status);

          return (
            <div key={page.slug || page.page} className={`bg-zinc-900 border ${trackBorder || 'border-zinc-800'}`} style={{ borderRadius: '6px 12px 6px 12px' }}>
              <button
                onClick={() => toggleExpand(page.page)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-zinc-200 truncate">{page.page}</span>
                    {page.noindex && <span className="text-[10px] px-1 py-px rounded bg-zinc-700 text-zinc-400 border border-zinc-600 flex-shrink-0">noindex</span>}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">/{page.slug}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={pageState?.status} />
                  {pageTraffic && (pageTraffic.clicks > 0 || pageTraffic.pageviews > 0) && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-400 tabular-nums" title={`${pageTraffic.clicks} clicks, ${pageTraffic.impressions} impressions, ${pageTraffic.pageviews} pageviews (28d)`}>
                      {pageTraffic.clicks > 0 ? `${pageTraffic.clicks.toLocaleString()} clicks` : ''}{pageTraffic.clicks > 0 && pageTraffic.pageviews > 0 ? ' · ' : ''}{pageTraffic.pageviews > 0 ? `${pageTraffic.pageviews.toLocaleString()} views` : ''}
                    </span>
                  )}
                  {errorCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
                  {warningCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">{warningCount} warn</span>}
                  {page.issues.length === 0 && <CheckCircle className="w-4 h-4 text-green-500" />}
                  <span className={`text-sm font-bold tabular-nums ${scoreColorClass(page.score)}`}>{page.score}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="ml-8 mb-2 space-y-1">
                  {page.noindex && (
                    <div className="mx-4 mb-1 px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700 text-[11px] text-zinc-400 flex items-center gap-1.5">
                      <EyeOff className="w-3 h-3 flex-shrink-0" />
                      This page is marked <span className="font-medium text-zinc-300">noindex</span> — issues listed below won't affect crawlability or search rankings and are excluded from the site health score.
                    </div>
                  )}
                  {page.issues.length === 0 ? (
                    <div className="text-xs text-green-500 px-4 py-2">No issues found</div>
                  ) : (
                    page.issues
                      .filter(i => severityFilter === 'all' || i.severity === severityFilter)
                      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
                      .map((issue, idx) => (
                        <AuditIssueRow
                          key={idx}
                          page={page}
                          issue={issue}
                          idx={idx}
                          workspaceId={workspaceId}
                          siteId={siteId}
                          applyingFix={applyingFix}
                          appliedFixes={appliedFixes}
                          editedSuggestions={editedSuggestions}
                          editingKey={editingKey}
                          sentForReview={sentForReview}
                          sendingReview={sendingReview}
                          createdTasks={createdTasks}
                          creatingTask={creatingTask}
                          flaggedIssues={flaggedIssues}
                          flaggingKey={flaggingKey}
                          flagNote={flagNote}
                          flagSending={flagSending}
                          actionMenuKey={actionMenuKey}
                          onAcceptSuggestion={acceptSuggestion}
                          onSendForReview={sendForReview}
                          onSetEditingKey={setEditingKey}
                          onSetEditedSuggestion={(key, val) => setEditedSuggestions(prev => ({ ...prev, [key]: val }))}
                          onSetActionMenuKey={setActionMenuKey}
                          onCreateTask={createTaskFromIssue}
                          onFlagForClient={flagForClient}
                          onSetFlaggingKey={setFlaggingKey}
                          onSetFlagNote={setFlagNote}
                          onSuppressIssue={suppressIssue}
                          onSuppressPattern={suppressPattern}
                          issueToTaskKey={issueToTaskKey}
                        />
                      ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Report format chooser */}
      {reportModal && (
        <ReportModal
          onExportHtml={handleExportReport}
          onExportCsv={handleExportCSV}
          onClose={() => setReportModal(false)}
        />
      )}

      {/* Inline report viewer */}
      {reportView && effectiveData && (
        <ReportViewer
          reportView={reportView}
          data={effectiveData}
          onClose={() => setReportView(null)}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}

export { SeoAudit };

