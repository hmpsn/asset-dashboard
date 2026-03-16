import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, put, del, getOptional, getSafe } from '../api/client';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import {
  Loader2, ChevronDown, ChevronRight,
  CheckCircle, Globe, FileText,
  X, Clock, Share2, Copy, ExternalLink,
  TrendingDown, Sparkles, EyeOff,
} from 'lucide-react';
import { StatCard, scoreColorClass, scoreBgBarClass } from './ui';
import { StatusBadge } from './ui/StatusBadge';
import { statusBorderClass } from './ui/statusConfig';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { AuditHistory } from './audit/AuditHistory';
import {
  type Severity, type CheckCategory, type SeoIssue, type PageSeoResult,
  type SeoAuditResult, type SnapshotSummary,
  SEVERITY_CONFIG, CRITICAL_CHECKS, MODERATE_CHECKS,
} from './audit/types';
import { ReportModal, ReportViewer } from './audit/AuditReportExport';
import { AuditIssueRow } from './audit/AuditIssueRow';
import { AuditBatchActions } from './audit/AuditBatchActions';
import { AuditToolbar, AuditCategoryFilter } from './audit/AuditFilters';

// ── Lazy-loaded sub-tool (only LinkChecker used internally for Dead Links sub-tab) ──
const LinkChecker = lazy(() => import('./LinkChecker').then(m => ({ default: m.LinkChecker })));
const AeoReview = lazy(() => import('./AeoReview'));
const ContentDecay = lazy(() => import('./ContentDecay'));


interface Props {
  siteId: string;
  workspaceId?: string;
  siteName?: string;
}

type AuditSubTab = 'audit' | 'links' | 'history' | 'aeo-review' | 'content-decay';

function SeoAudit({ siteId, workspaceId, siteName }: Props) {
  const navigate = useNavigate();
  const { startJob, jobs } = useBackgroundTasks();
  const auditJobId = useRef<string | null>(null);
  const [data, setData] = useState<SeoAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [auditSubTab, setAuditSubTab] = useState<AuditSubTab>('audit');
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

  const [auditError, setAuditError] = useState<string | null>(null);
  const [applyingFix, setApplyingFix] = useState<string | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [actionMenuKey, setActionMenuKey] = useState<string | null>(null);

  // Traffic intelligence (#12)
  const [trafficMap, setTrafficMap] = useState<Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>>({});
  const [sortMode, setSortMode] = useState<'issues' | 'traffic'>('issues');

  // Unified page edit states
  const { getState, summary } = usePageEditStates(workspaceId);

  useEffect(() => {
    if (siteId) {
      getOptional<Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>>(`/api/audit-traffic/${siteId}`).then(m => {
        if (m && typeof m === 'object') setTrafficMap(m);
      }).catch(() => {});
    }
  }, [siteId]);

  // Audit issue suppressions
  const [suppressions, setSuppressions] = useState<{ check: string; pageSlug: string; pagePattern?: string }[]>([]);

  useEffect(() => {
    if (workspaceId) {
      getSafe<{ check: string; pageSlug: string; pagePattern?: string }[]>(`/api/workspaces/${workspaceId}/audit-suppressions`, [])
        .then(s => { if (Array.isArray(s)) setSuppressions(s); })
        .catch(() => {});
    }
  }, [workspaceId]);

  const suppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await post<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pageSlug });
      setSuppressions(updated);
    } catch {}
    setActionMenuKey(null);
  };

  const unsuppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await del<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pageSlug });
      setSuppressions(updated);
    } catch {}
  };

  const suppressPattern = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    const prefix = pageSlug.includes('/') ? pageSlug.split('/')[0] : pageSlug;
    const pattern = `${prefix}/*`;
    try {
      const { suppressions: updated } = await post<{ suppressions: { check: string; pageSlug: string; pagePattern?: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pagePattern: pattern, reason: `Pattern: ${pattern}` });
      setSuppressions(updated);
    } catch {}
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
    } catch { /* skip */ }
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
    } catch { /* skip */ }
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
    } catch { /* skip */ }
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
    } catch { /* skip */ }
    finally { setBatchCreating(false); }
  };

  // Scheduled audit state
  const [schedule, setSchedule] = useState<{ enabled: boolean; intervalDays: number; scoreDropThreshold: number; lastRunAt?: string; lastScore?: number } | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(7);
  const [scheduleThreshold, setScheduleThreshold] = useState(5);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  useEffect(() => {
    if (workspaceId) {
      getOptional<{ enabled: boolean; intervalDays: number; scoreDropThreshold: number; lastRunAt?: string; lastScore?: number }>(`/api/audit-schedules/${workspaceId}`).then(s => {
        if (s) { setSchedule(s); setScheduleInterval(s.intervalDays); setScheduleThreshold(s.scoreDropThreshold); }
      }).catch(() => {});
    }
  }, [workspaceId]);

  const saveSchedule = async (enabled: boolean) => {
    if (!workspaceId) return;
    setScheduleSaving(true);
    try {
      const updated = await put<{ enabled: boolean; intervalDays: number; scoreDropThreshold: number; lastRunAt?: string; lastScore?: number }>(`/api/audit-schedules/${workspaceId}`, { enabled, intervalDays: scheduleInterval, scoreDropThreshold: scheduleThreshold });
      setSchedule(updated);
    } catch { /* skip */ }
    finally { setScheduleSaving(false); }
  };

  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const acceptAllSuggestions = async () => {
    if (!data) return;
    // Collect all fixable issues across all pages
    const fixes: { pageId: string; issue: SeoIssue }[] = [];
    for (const page of data.pages) {
      for (const issue of page.issues) {
        const fixKey = `${page.pageId}-${issue.check}`;
        if (issue.suggestedFix && !appliedFixes.has(fixKey)) {
          fixes.push({ pageId: page.pageId, issue });
        }
      }
    }
    if (fixes.length === 0) return;
    setBulkApplying(true);
    setBulkProgress({ done: 0, total: fixes.length });
    for (let i = 0; i < fixes.length; i++) {
      await acceptSuggestion(fixes[i].pageId, fixes[i].issue);
      setBulkProgress({ done: i + 1, total: fixes.length });
    }
    setBulkApplying(false);
    setBulkProgress(null);
  };

  const runAudit = async () => {
    setLoading(true);
    setHasRun(true);
    setAuditError(null);
    const jobId = await startJob('seo-audit', { siteId, workspaceId });
    if (jobId) {
      auditJobId.current = jobId;
    } else {
      setAuditError('Failed to start audit job');
      setLoading(false);
    }
  };

  // Watch for audit job completion via WebSocket-driven jobs array
  useEffect(() => {
    if (!auditJobId.current) return;
    const job = jobs.find(j => j.id === auditJobId.current);
    if (!job) return;
    if (job.status === 'done' && job.result) {
      const d = job.result as SeoAuditResult & { snapshotId?: string };
      if (d && Array.isArray(d.pages)) {
        setData(d);
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
  }, [jobs]);

  const loadHistory = useCallback(() => {
    getSafe<SnapshotSummary[]>(`/api/reports/${siteId}/history`, [])
      .then(h => setHistory(Array.isArray(h) ? h : []))
      .catch(() => {});
  }, [siteId]);

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
  }, [siteId, loadHistory]); // eslint-disable-line react-hooks/exhaustive-deps

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
        { id: 'links' as const, label: 'Dead Links', icon: ExternalLink },
        { id: 'history' as const, label: 'History', icon: Clock },
        { id: 'aeo-review' as const, label: 'AEO Review', icon: Sparkles },
        { id: 'content-decay' as const, label: 'Content Decay', icon: TrendingDown },
      ]).map(t => (
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
    </div>
  );

  if (auditSubTab === 'content-decay' && workspaceId) {
    return <div>{auditTabBar}<Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-amber-400" /></div>}><ContentDecay workspaceId={workspaceId} /></Suspense></div>;
  }
  if (auditSubTab === 'aeo-review' && workspaceId) {
    return <div>{auditTabBar}<Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-purple-400" /></div>}><AeoReview workspaceId={workspaceId} /></Suspense></div>;
  }
  if (auditSubTab === 'links') {
    return <div>{auditTabBar}<Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}><LinkChecker siteId={siteId} /></Suspense></div>;
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
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {auditTabBar}
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Scanning pages for SEO issues...</p>
          <p className="text-xs text-zinc-500">Fetching metadata and published HTML for each page</p>
        </div>
      </div>
    );
  }

  if (!data) return (
    <div>
      {auditTabBar}
      {auditError && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md text-center">
            <p className="text-red-400 text-sm font-medium mb-1">SEO Audit Failed</p>
            <p className="text-xs text-red-400/70">{auditError}</p>
          </div>
          <button onClick={runAudit} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-400 text-[#0f1219]">
            Try Again
          </button>
        </div>
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
    <div className="space-y-5">
      {auditTabBar}
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 col-span-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Site Score</span>
          </div>
          <div className={`text-3xl font-bold ${scoreColorClass(effectiveData!.siteScore)}`}>{effectiveData!.siteScore}</div>
          <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreBgBarClass(effectiveData!.siteScore)}`} style={{ width: `${effectiveData!.siteScore}%` }} />
          </div>
        </div>
        <StatCard label="Pages Scanned" value={effectiveData!.totalPages} />
        <StatCard label="Errors" value={effectiveData!.errors} valueColor="text-red-400" onClick={() => setSeverityFilter(severityFilter === 'error' ? 'all' : 'error')} className={severityFilter === 'error' ? 'border-red-500/50' : ''} />
        <StatCard label="Warnings" value={effectiveData!.warnings} valueColor="text-amber-400" onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')} className={severityFilter === 'warning' ? 'border-amber-500/50' : ''} />
        <StatCard label="Info" value={effectiveData!.infos} valueColor="text-blue-400" onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')} className={severityFilter === 'info' ? 'border-blue-500/50' : ''} />
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
            <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mr-1">Quick fixes →</span>
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
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
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

      {/* Site-wide issues */}
      {data.siteWideIssues.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-2">
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
        onRunAudit={runAudit}
      />

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
                setSuppressions(updated);
              } catch {}
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
            <div key={page.slug || page.page} className={`bg-zinc-900 rounded-xl border ${trackBorder || 'border-zinc-800'}`}>
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
  );
}

export { SeoAudit };

