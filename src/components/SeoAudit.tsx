import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { get, post, put, del, patch, getOptional, getSafe } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { adminPath, type Page } from '../routes';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import {
  Loader2, Search as SearchIcon, ChevronDown, ChevronRight, Download,
  AlertTriangle, AlertCircle, Info, CheckCircle, Globe, FileText,
  RefreshCw, X, Clock, Share2, Copy, ExternalLink, Send, Wrench,
  TrendingUp, TrendingDown, Minus, Plus, ListChecks, Trash2, Circle, ClipboardList,
  MoreVertical, Pencil, EyeOff, Sparkles,
} from 'lucide-react';
import { StatCard, scoreColorClass, scoreBgBarClass } from './ui';
import { StatusBadge } from './ui/StatusBadge';
import { statusBorderClass } from './ui/statusConfig';
import { usePageEditStates } from '../hooks/usePageEditStates';
import type { FixContext } from '../App';
import { AuditHistory } from './audit/AuditHistory';
import {
  type Severity, type CheckCategory, type SeoIssue, type PageSeoResult,
  type SeoAuditResult, type SnapshotSummary,
  CATEGORY_CONFIG, ISSUE_FIX_MAP, FIX_TAB_LABELS, getFixTab,
  SEVERITY_CONFIG, CRITICAL_CHECKS, MODERATE_CHECKS,
} from './audit/types';

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
  const [suppressions, setSuppressions] = useState<{ check: string; pageSlug: string }[]>([]);

  useEffect(() => {
    if (workspaceId) {
      getSafe<{ check: string; pageSlug: string }[]>(`/api/workspaces/${workspaceId}/audit-suppressions`, [])
        .then(s => { if (Array.isArray(s)) setSuppressions(s); })
        .catch(() => {});
    }
  }, [workspaceId]);

  const suppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await post<{ suppressions: { check: string; pageSlug: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`, { check, pageSlug });
      setSuppressions(updated);
    } catch {}
    setActionMenuKey(null);
  };

  const unsuppressIssue = async (check: string, pageSlug: string) => {
    if (!workspaceId) return;
    try {
      const { suppressions: updated } = await del<{ suppressions: { check: string; pageSlug: string }[] }>(`/api/workspaces/${workspaceId}/audit-suppressions`);
      setSuppressions(updated);
    } catch {}
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
      .filter(j => j.type === 'seo-audit' && j.status === 'done' && j.result)
      .find(j => {
        const r = j.result as SeoAuditResult;
        return r && Array.isArray(r.pages);
      });
    const runningJob = jobs.find(j => j.type === 'seo-audit' && (j.status === 'running' || j.status === 'pending'));

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

  const getCSV = (): string => {
    if (!data) return '';
    const rows = [['Page', 'Slug', 'Score', 'Severity', 'Check', 'Message', 'Recommendation', 'Value', 'AI Suggestion']];
    for (const issue of data.siteWideIssues) {
      rows.push(['[Site-Wide]', '', '', issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
    }
    for (const page of data.pages) {
      for (const issue of page.issues) {
        rows.push([page.page, page.slug, String(page.score), issue.severity, issue.check, issue.message, issue.recommendation, issue.value || '', issue.suggestedFix || '']);
      }
    }
    return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  };

  const generateHtmlReport = (): string => {
    if (!data) return '';
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const errorPages = data.pages.filter(p => p.score < 60);
    const goodPages = data.pages.filter(p => p.score >= 80);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SEO Audit Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
  .score-card { display: flex; align-items: center; gap: 24px; padding: 24px; background: #f8f9fa; border-radius: 12px; margin-bottom: 32px; }
  .score-circle { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: white; }
  .score-green { background: #22c55e; } .score-amber { background: #f59e0b; } .score-orange { background: #f97316; } .score-red { background: #ef4444; }
  .stats { display: flex; gap: 24px; }
  .stat { text-align: center; } .stat-num { font-size: 24px; font-weight: 700; } .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  h2 { font-size: 20px; font-weight: 600; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
  .issue-row { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .badge-error { background: #fef2f2; color: #dc2626; } .badge-warning { background: #fffbeb; color: #d97706; } .badge-info { background: #eff6ff; color: #2563eb; }
  .issue-content { flex: 1; }
  .issue-msg { font-weight: 500; font-size: 14px; } .issue-rec { font-size: 13px; color: #666; margin-top: 2px; } .issue-val { font-size: 12px; color: #999; font-style: italic; margin-top: 2px; }
  .page-block { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .page-name { font-weight: 600; font-size: 15px; } .page-score { font-weight: 700; font-size: 14px; }
  .summary-box { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .summary-item { padding: 16px; background: #f8f9fa; border-radius: 8px; }
  .summary-item h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .summary-item p { font-size: 13px; color: #666; }
  @media print { body { font-size: 12px; } .container { padding: 20px; } }
</style>
</head>
<body>
<div class="container">
  <h1>SEO Audit Report</h1>
  <p class="subtitle">Generated ${now} &middot; ${data.totalPages} pages analyzed</p>

  <div class="score-card">
    <div class="score-circle ${data.siteScore >= 80 ? 'score-green' : data.siteScore >= 60 ? 'score-amber' : data.siteScore >= 40 ? 'score-orange' : 'score-red'}">${data.siteScore}</div>
    <div>
      <div style="font-size:18px;font-weight:600">Overall Site Score</div>
      <div class="stats" style="margin-top:8px">
        <div class="stat"><div class="stat-num" style="color:#dc2626">${data.errors}</div><div class="stat-label">Errors</div></div>
        <div class="stat"><div class="stat-num" style="color:#d97706">${data.warnings}</div><div class="stat-label">Warnings</div></div>
        <div class="stat"><div class="stat-num" style="color:#2563eb">${data.infos}</div><div class="stat-label">Info</div></div>
      </div>
    </div>
  </div>

  <div class="summary-box">
    <div class="summary-item">
      <h3>Executive Summary</h3>
      <p>${data.errors > 0 ? `Found <strong>${data.errors} critical error${data.errors > 1 ? 's' : ''}</strong> that need immediate attention. ` : 'No critical errors found. '}${data.warnings > 0 ? `There are <strong>${data.warnings} warning${data.warnings > 1 ? 's' : ''}</strong> that should be addressed for better rankings.` : 'All warnings have been addressed.'}</p>
    </div>
    <div class="summary-item">
      <h3>Key Metrics</h3>
      <p><strong>${goodPages.length}</strong> of ${data.totalPages} pages score 80+<br>
      <strong>${errorPages.length}</strong> pages need significant improvement<br>
      Average page score: <strong>${data.siteScore}</strong>/100</p>
    </div>
  </div>

  ${data.siteWideIssues.length > 0 ? `<h2>Site-Wide Issues</h2>${data.siteWideIssues.map(i => `
  <div class="issue-row">
    <span class="badge badge-${i.severity}">${i.severity}</span>
    <div class="issue-content">
      <div class="issue-msg">${i.message}</div>
      <div class="issue-rec">${i.recommendation}</div>
      ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
      ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
    </div>
  </div>`).join('')}` : ''}

  <h2>Page-by-Page Results</h2>
  ${data.pages.map(p => `
  <div class="page-block">
    <div class="page-header">
      <span class="page-name">${p.page} <span style="color:#999;font-weight:400">/${p.slug}</span></span>
      <span class="page-score" style="color:${p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#f59e0b' : '#ef4444'}">${p.score}/100</span>
    </div>
    ${p.issues.length === 0 ? '<div style="color:#22c55e;font-size:13px">No issues found</div>' : p.issues.map(i => `
    <div class="issue-row">
      <span class="badge badge-${i.severity}">${i.severity}</span>
      <div class="issue-content">
        <div class="issue-msg">${i.message}</div>
        <div class="issue-rec">${i.recommendation}</div>
        ${i.value ? `<div class="issue-val">${i.value}</div>` : ''}
        ${i.suggestedFix ? `<div style="margin-top:6px;padding:6px 10px;background:#064e3b20;border:1px solid #06533830;border-radius:6px"><div style="font-size:9px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">AI Suggestion</div><div style="font-size:12px;color:#34d399">${i.suggestedFix}</div></div>` : ''}
      </div>
    </div>`).join('')}
  </div>`).join('')}

  <div style="margin-top:40px;padding-top:16px;border-top:2px solid #eee;text-align:center;color:#999;font-size:12px">
    Generated by Asset Dashboard SEO Auditor &middot; ${now}
  </div>
</div>
</body>
</html>`;
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
    const suppSet = new Set(suppressions.map(s => `${s.check}:${s.pageSlug}`));
    if (suppSet.size === 0) return data;

    const pages = data.pages.map(page => {
      const filtered = page.issues.filter(i => !suppSet.has(`${i.check}:${page.slug}`));
      if (filtered.length === page.issues.length) return page;
      let score = 100;
      for (const issue of filtered) {
        const isCritical = CRITICAL_CHECKS.has(issue.check);
        const isModerate = MODERATE_CHECKS.has(issue.check);
        if (issue.severity === 'error') score -= isCritical ? 20 : 12;
        else if (issue.severity === 'warning') score -= isCritical ? 10 : isModerate ? 6 : 4;
        else score -= 1;
      }
      score = Math.max(0, Math.min(100, score));
      return { ...page, issues: filtered, score };
    });

    const errors = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'error').length, 0);
    const warnings = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'warning').length, 0);
    const infos = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'info').length, 0);
    const siteScore = pages.length > 0 ? Math.round(pages.reduce((sum, p) => sum + p.score, 0) / pages.length) : 0;

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
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm py-2 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pages or issues..."
              className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
            />
          </div>
          <button
            onClick={handleSaveAndShare}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-teal-400 text-[#0f1219]"
          >
            <Share2 className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save & Share'}
          </button>
          <button
            onClick={() => setReportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Export
          </button>
          {(() => {
            const pendingFixes = effectiveData!.pages.reduce((count, page) =>
              count + page.issues.filter(i => i.suggestedFix && !appliedFixes.has(`${page.pageId}-${i.check}`)).length, 0);
            if (pendingFixes === 0) return null;
            return (
              <button
                onClick={acceptAllSuggestions}
                disabled={bulkApplying}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {bulkApplying && bulkProgress
                  ? `Applying ${bulkProgress.done}/${bulkProgress.total}...`
                  : `Accept All (${pendingFixes})`}
              </button>
            );
          })()}
          <button
            onClick={runAudit}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-scan
          </button>
        </div>
      </div>

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
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider mr-1">Category:</span>
        {(['all', ...Object.keys(CATEGORY_CONFIG)] as (CheckCategory | 'all')[]).map(cat => {
          const active = categoryFilter === cat;
          const cfg = cat !== 'all' ? CATEGORY_CONFIG[cat] : null;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(active ? 'all' : cat)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                active
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
              }`}
            >
              {cat === 'all' ? 'All' : cfg?.label}
            </button>
          );
        })}
      </div>

      {/* Showing count + batch actions */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>Showing {filteredPages.length} of {effectiveData!.pages.length} pages</span>
          {suppressions.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">
              <EyeOff className="w-3 h-3" /> {suppressions.length} suppressed
              <button onClick={async () => { for (const s of suppressions) await unsuppressIssue(s.check, s.pageSlug); }} className="text-zinc-500 hover:text-zinc-300 underline ml-0.5" title="Remove all suppressions">clear</button>
            </span>
          )}
          {(severityFilter !== 'all' || categoryFilter !== 'all') && (
            <button onClick={() => { setSeverityFilter('all'); setCategoryFilter('all'); }} className="text-zinc-500 hover:text-zinc-300 underline">
              Clear filters
            </button>
          )}
          {Object.keys(trafficMap).length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-[11px] text-zinc-600">Sort:</span>
              <button
                onClick={() => setSortMode('issues')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${sortMode === 'issues' ? 'border-zinc-500 bg-zinc-800 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
              >
                Issues
              </button>
              <button
                onClick={() => setSortMode('traffic')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${sortMode === 'traffic' ? 'border-teal-500/50 bg-teal-500/10 text-teal-400' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
              >
                Traffic Impact
              </button>
            </div>
          )}
        </div>
        {workspaceId && (
          <div className="flex items-center gap-2">
            {batchResult && Date.now() - batchResult.timestamp < 8000 && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {batchResult.count} added to tasks
              </span>
            )}
            {batchCreating ? (
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Adding to tasks...
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => batchCreateTasks('errors')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                  title="Add all errors to tasks"
                >
                  <ClipboardList className="w-3 h-3" /> Add Errors to Tasks ({effectiveData!.errors})
                </button>
                {(severityFilter !== 'all' || categoryFilter !== 'all') && (
                  <button
                    onClick={() => batchCreateTasks('filtered')}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/20 transition-colors"
                    title="Add currently filtered issues to tasks"
                  >
                    <ClipboardList className="w-3 h-3" /> Add Filtered to Tasks
                  </button>
                )}
                <button
                  onClick={() => batchCreateTasks('all')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                  title="Add ALL findings to tasks"
                >
                  <ClipboardList className="w-3 h-3" /> Add All to Tasks ({effectiveData!.errors + effectiveData!.warnings + effectiveData!.infos})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                  <div className="text-sm font-medium text-zinc-200 truncate">{page.page}</div>
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
                  {page.issues.length === 0 ? (
                    <div className="text-xs text-green-500 px-4 py-2">No issues found</div>
                  ) : (
                    page.issues
                      .filter(i => severityFilter === 'all' || i.severity === severityFilter)
                      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
                      .map((issue, idx) => {
                        const cfg = SEVERITY_CONFIG[issue.severity];
                        const catCfg = issue.category ? CATEGORY_CONFIG[issue.category] : null;
                        const Icon = cfg.icon;
                        const fixKey = `${page.pageId}-${issue.check}`;
                        const taskKey = issueToTaskKey(page, issue);
                        const isApplying = applyingFix === fixKey;
                        const isApplied = appliedFixes.has(fixKey);
                        const isEditing = editingKey === fixKey;
                        const editedText = editedSuggestions[fixKey];
                        const isFlagged = flaggedIssues.has(taskKey);
                        const isCreated = createdTasks.has(taskKey);
                        const isCreating = creatingTask === taskKey;
                        const menuOpen = actionMenuKey === taskKey;
                        return (
                          <div key={idx} className="flex items-start gap-3 px-4 py-2 rounded-lg hover:bg-zinc-800/30 transition-colors group/issue">
                            <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                            <div className="flex-1 min-w-0">
                              {/* Issue title + inline badges */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs text-zinc-300">{issue.message}</span>
                                {catCfg && (
                                  <span className={`text-[10px] px-1 py-px rounded border border-zinc-800 ${catCfg.color} leading-tight`}>
                                    {catCfg.label}
                                  </span>
                                )}
                                <span className={`text-[10px] px-1 py-px rounded border leading-tight ${cfg.bg} ${cfg.color}`}>
                                  {issue.check}
                                </span>
                              </div>
                              <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
                              {issue.value && <div className="text-[11px] text-zinc-500 mt-0.5 italic truncate">{issue.value}</div>}
                              {/* Editable AI suggestion */}
                              {issue.suggestedFix && (
                                <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">AI Suggestion</span>
                                      {!isApplied && !isEditing && (
                                        <button
                                          onClick={() => { setEditingKey(fixKey); if (!editedText) setEditedSuggestions(prev => ({ ...prev, [fixKey]: issue.suggestedFix! })); }}
                                          className="text-[10px] text-emerald-500/60 hover:text-emerald-400 flex items-center gap-0.5 transition-colors"
                                          title="Edit before sending"
                                        >
                                          <Pencil className="w-2.5 h-2.5" /> Edit
                                        </button>
                                      )}
                                    </div>
                                    {isApplied ? (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium flex items-center gap-1">
                                        <CheckCircle className="w-2.5 h-2.5" /> Applied
                                      </span>
                                    ) : sentForReview.has(fixKey) ? (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium flex items-center gap-1">
                                        <Send className="w-2.5 h-2.5" /> Sent for Review
                                      </span>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => acceptSuggestion(page.pageId, issue)}
                                          disabled={isApplying || sendingReview === fixKey}
                                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                                        >
                                          {isApplying ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle className="w-2.5 h-2.5" />}
                                          {isApplying ? 'Pushing...' : 'Apply Now'}
                                        </button>
                                        {workspaceId && (issue.check === 'title' || issue.check === 'meta-description') && (
                                          <button
                                            onClick={() => sendForReview(page, issue)}
                                            disabled={isApplying || sendingReview === fixKey}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                                          >
                                            {sendingReview === fixKey ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                                            Send for Review
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {isEditing ? (
                                    <textarea
                                      value={editedText || issue.suggestedFix}
                                      onChange={e => setEditedSuggestions(prev => ({ ...prev, [fixKey]: e.target.value }))}
                                      onBlur={() => setEditingKey(null)}
                                      onKeyDown={e => { if (e.key === 'Escape') setEditingKey(null); }}
                                      className="w-full text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-700/40 rounded px-1.5 py-1 focus:outline-none focus:border-emerald-500/50 resize-none"
                                      rows={2}
                                      autoFocus
                                    />
                                  ) : (
                                    <div
                                      className="text-[11px] text-emerald-300 cursor-text"
                                      onClick={() => { setEditingKey(fixKey); if (!editedText) setEditedSuggestions(prev => ({ ...prev, [fixKey]: issue.suggestedFix! })); }}
                                      title="Click to edit"
                                    >
                                      {editedText || issue.suggestedFix}
                                      {editedText && editedText !== issue.suggestedFix && (
                                        <span className="ml-1 text-[9px] text-emerald-500/50 italic">(edited)</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Inline flag-for-client form */}
                              {workspaceId && flaggingKey === taskKey && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={flagNote}
                                    onChange={e => setFlagNote(e.target.value)}
                                    placeholder="Note for client (optional)..."
                                    className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
                                    onKeyDown={e => e.key === 'Enter' && flagForClient(page, issue, flagNote)}
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => flagForClient(page, issue, flagNote)}
                                    disabled={flagSending}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded bg-purple-600/80 hover:bg-purple-600 text-xs font-medium text-white transition-colors disabled:opacity-50"
                                  >
                                    {flagSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                    Send
                                  </button>
                                  <button onClick={() => { setFlaggingKey(null); setFlagNote(''); }} className="p-1 rounded hover:bg-zinc-800 text-zinc-500">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* Compact action bar: Fix + overflow menu */}
                            <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                              {/* Fix → (primary) */}
                              {workspaceId && (() => {
                                const fixTab = getFixTab(issue);
                                if (!fixTab) return null;
                                return (
                                  <button
                                    onClick={() => navigate(adminPath(workspaceId, fixTab as Page), { state: { fixContext: { pageId: page.pageId, pageSlug: page.slug, pageName: page.page, issueCheck: issue.check, issueMessage: issue.message } } })}
                                    className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 flex items-center gap-0.5 transition-colors"
                                    title={`Open ${FIX_TAB_LABELS[fixTab] || fixTab}`}
                                  >
                                    <Wrench className="w-2.5 h-2.5" /> Fix
                                  </button>
                                );
                              })()}
                              {/* Status badges (show instead of actions when done) */}
                              {isFlagged && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-0.5">
                                  <Send className="w-2.5 h-2.5" /> Sent
                                </span>
                              )}
                              {isCreated && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-0.5">
                                  <CheckCircle className="w-2.5 h-2.5" /> Added
                                </span>
                              )}
                              {/* Overflow menu for Flag + Task */}
                              {workspaceId && !isFlagged && !isCreated && (
                                <div className="relative">
                                  <button
                                    onClick={() => setActionMenuKey(menuOpen ? null : taskKey)}
                                    className={`p-1 rounded transition-colors ${menuOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 opacity-0 group-hover/issue:opacity-100'}`}
                                    title="More actions"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </button>
                                  {menuOpen && (
                                    <div className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">
                                      <button
                                        onClick={() => { setFlaggingKey(taskKey); setFlagNote(''); setActionMenuKey(null); }}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors"
                                      >
                                        <Send className="w-3 h-3" /> Send to Client
                                      </button>
                                      <button
                                        onClick={() => { createTaskFromIssue(page, issue); setActionMenuKey(null); }}
                                        disabled={isCreating}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                      >
                                        {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />} Add to Tasks
                                      </button>
                                      <button
                                        onClick={() => suppressIssue(issue.check, page.slug)}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 transition-colors"
                                      >
                                        <EyeOff className="w-3 h-3" /> Suppress Issue
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Show individual done states when only one is done */}
                              {workspaceId && isFlagged && !isCreated && (
                                <div className="relative">
                                  <button
                                    onClick={() => setActionMenuKey(menuOpen ? null : taskKey)}
                                    className={`p-1 rounded transition-colors ${menuOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 opacity-0 group-hover/issue:opacity-100'}`}
                                    title="More actions"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </button>
                                  {menuOpen && (
                                    <div className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">
                                      <button
                                        onClick={() => { createTaskFromIssue(page, issue); setActionMenuKey(null); }}
                                        disabled={isCreating}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                      >
                                        {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />} Add to Tasks
                                      </button>
                                      <button
                                        onClick={() => suppressIssue(issue.check, page.slug)}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 transition-colors"
                                      >
                                        <EyeOff className="w-3 h-3" /> Suppress Issue
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {workspaceId && !isFlagged && isCreated && (
                                <div className="relative">
                                  <button
                                    onClick={() => setActionMenuKey(menuOpen ? null : taskKey)}
                                    className={`p-1 rounded transition-colors ${menuOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 opacity-0 group-hover/issue:opacity-100'}`}
                                    title="More actions"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </button>
                                  {menuOpen && (
                                    <div className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">
                                      <button
                                        onClick={() => { setFlaggingKey(taskKey); setFlagNote(''); setActionMenuKey(null); }}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors"
                                      >
                                        <Send className="w-3 h-3" /> Send to Client
                                      </button>
                                      <button
                                        onClick={() => suppressIssue(issue.check, page.slug)}
                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 transition-colors"
                                      >
                                        <EyeOff className="w-3 h-3" /> Suppress Issue
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Report format chooser */}
      {reportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setReportModal(false)}>
          <div className="relative max-w-md w-full mx-4 bg-zinc-900 rounded-xl border border-zinc-700 p-6" onClick={e => e.stopPropagation()}>
            <button onClick={() => setReportModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
            <h3 className="text-lg font-semibold mb-1">Export SEO Report</h3>
            <p className="text-xs text-zinc-500 mb-5">Choose a format to view the audit results</p>
            <div className="space-y-3">
              <button
                onClick={handleExportReport}
                className="w-full flex items-center gap-3 px-4 py-3 bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors text-left"
              >
                <FileText className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">HTML Report</div>
                  <div className="text-xs text-teal-200">Beautifully formatted, client-ready report. Print to PDF.</div>
                </div>
              </button>
              <button
                onClick={handleExportCSV}
                className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-left"
              >
                <Download className="w-5 h-5" />
                <div>
                  <div className="text-sm font-medium">CSV Spreadsheet</div>
                  <div className="text-xs text-zinc-400">Raw data for analysis in Excel or Google Sheets.</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline report viewer */}
      {reportView && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
            <div className="text-sm font-medium text-zinc-200">
              {reportView === 'html' ? 'SEO Audit Report' : 'CSV Export'}
            </div>
            <div className="flex items-center gap-2">
              {reportView === 'csv' && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getCSV());
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
                >
                  Copy to Clipboard
                </button>
              )}
              {reportView === 'html' && (
                <button
                  onClick={() => {
                    const iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
                    if (iframe?.contentWindow) iframe.contentWindow.print();
                  }}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
                >
                  Print / Save as PDF
                </button>
              )}
              <button
                onClick={() => setReportView(null)}
                className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {reportView === 'html' ? (
              <iframe
                id="report-iframe"
                srcDoc={generateHtmlReport()}
                className="w-full h-full border-0 bg-white"
                title="SEO Report"
              />
            ) : (
              <textarea
                readOnly
                value={getCSV()}
                className="w-full h-full p-4 bg-zinc-950 text-zinc-300 text-xs font-mono resize-none focus:outline-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { SeoAudit };

