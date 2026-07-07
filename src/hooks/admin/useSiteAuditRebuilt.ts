import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { del, post, put } from '../../api/client';
import { usePageEditStates } from '../usePageEditStates';
import { useAuditSchedule, useAuditSuppressions, useAuditTrafficMap } from './useAdminSeo';
import { useSeoAuditWorkflow } from './useSeoAuditWorkflow';
import { useWorkspaces } from './useWorkspaces';
import { queryKeys } from '../../lib/queryKeys';
import { applyClientSuppressions, type ClientSuppression } from '../../lib/audit-suppression-client';
import { issueToTaskItem, issueToTaskKey } from '../../lib/audit-batch';
import { normalizePageUrl } from '../../lib/pathUtils';
import { adminPath } from '../../routes';
import { computePageScore } from '../../../shared/scoring';
import {
  AUDIT_CATEGORY_SCORE_VERSION,
  AUDIT_DISPLAY_CATEGORIES,
  AUDIT_DISPLAY_CATEGORY_LABELS,
  type AuditCategoryScore,
  type AuditDisplayCategory,
} from '../../../shared/types/seo-audit.js';
import type { AuditSchedule } from './useAdminSeo';
import type { PageSeoResult, SeoAuditResult, SeoIssue, Severity } from '../../components/audit/types';

export type SiteAuditSortMode = 'severity' | 'traffic';

export interface SiteAuditIssue extends SeoIssue {
  displayCategory?: AuditDisplayCategory;
  affectedPages?: string[];
}

export interface SiteAuditPage extends Omit<PageSeoResult, 'issues'> {
  issues: SiteAuditIssue[];
}

export interface SiteAuditResult extends Omit<SeoAuditResult, 'pages' | 'siteWideIssues'> {
  pages: SiteAuditPage[];
  siteWideIssues: SiteAuditIssue[];
  categoryScoreVersion?: typeof AUDIT_CATEGORY_SCORE_VERSION;
  categoryScores?: AuditCategoryScore[];
}

export interface AuditIssueInstance {
  id: string;
  page: SiteAuditPage | null;
  issue: SiteAuditIssue;
}

export interface AuditIssueGroup {
  id: string;
  check: string;
  message: string;
  recommendation: string;
  severity: Severity;
  displayCategory: AuditDisplayCategory;
  categoryLabel: string;
  suggestedFix?: string;
  instances: AuditIssueInstance[];
  affectedPages: number;
  traffic: {
    clicks: number;
    impressions: number;
    sessions: number;
    pageviews: number;
  };
}

interface SuppressionPayload {
  suppressions: ClientSuppression[];
}

const LEGACY_TO_DISPLAY_CATEGORY: Record<string, AuditDisplayCategory> = {
  content: 'onpage',
  technical: 'index',
  social: 'onpage',
  performance: 'perf',
  accessibility: 'mobile',
};

function displayCategoryFor(issue: SiteAuditIssue): AuditDisplayCategory {
  if (issue.displayCategory) return issue.displayCategory;
  const legacy = issue.category ? LEGACY_TO_DISPLAY_CATEGORY[issue.category] : undefined;
  return legacy ?? 'index';
}

function severityRank(severity: Severity): number {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function trafficForPage(
  trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>,
  page: SiteAuditPage,
): { clicks: number; impressions: number; sessions: number; pageviews: number } {
  const path = normalizePageUrl(page.publishedPath || page.url || page.slug || '/');
  return trafficMap[path] ?? { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
}

function deriveCategoryScores(data: SiteAuditResult | null): AuditCategoryScore[] {
  if (!data) return [];
  const indexedPages = data.pages.filter((page) => !page.noindex);
  return AUDIT_DISPLAY_CATEGORIES.map((category) => {
    const categorySiteWideIssues = data.siteWideIssues.filter((issue) => displayCategoryFor(issue) === category);
    const stats: AuditCategoryScore = {
      category,
      label: AUDIT_DISPLAY_CATEGORY_LABELS[category],
      score: 100,
      denominatorPages: indexedPages.length,
      affectedPages: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
    };

    if (indexedPages.length > 0) {
      const pageScores = indexedPages.map((page) => {
        const categoryIssues = page.issues.filter((issue) => displayCategoryFor(issue) === category);
        if (categoryIssues.length > 0) stats.affectedPages += 1;
        for (const issue of categoryIssues) {
          if (issue.severity === 'error') stats.errors += 1;
          else if (issue.severity === 'warning') stats.warnings += 1;
          else stats.infos += 1;
        }
        return computePageScore([...categoryIssues, ...categorySiteWideIssues]);
      });
      stats.score = Math.round(pageScores.reduce((sum, score) => sum + score, 0) / pageScores.length);
    } else if (categorySiteWideIssues.length > 0) {
      stats.score = computePageScore(categorySiteWideIssues);
    }

    for (const issue of categorySiteWideIssues) {
      if (issue.severity === 'error') stats.errors += 1;
      else if (issue.severity === 'warning') stats.warnings += 1;
      else stats.infos += 1;
    }

    return stats;
  });
}

function buildIssueGroups(
  data: SiteAuditResult | null,
  trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>,
): AuditIssueGroup[] {
  if (!data) return [];
  const groups = new Map<string, AuditIssueGroup>();

  const addIssue = (issue: SiteAuditIssue, page: SiteAuditPage | null) => {
    const displayCategory = displayCategoryFor(issue);
    const key = [
      issue.check,
      issue.severity,
      displayCategory,
      issue.message,
      issue.recommendation,
    ].join('::');
    const traffic = page ? trafficForPage(trafficMap, page) : { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
    const existing = groups.get(key);
    const instance: AuditIssueInstance = {
      id: page ? issueToTaskKey(page, issue) : `sitewide-${issue.check}-${issue.message.slice(0, 40)}`,
      page,
      issue,
    };

    if (!existing) {
      groups.set(key, {
        id: key,
        check: issue.check,
        message: issue.message,
        recommendation: issue.recommendation,
        severity: issue.severity,
        displayCategory,
        categoryLabel: AUDIT_DISPLAY_CATEGORY_LABELS[displayCategory],
        suggestedFix: issue.suggestedFix,
        instances: [instance],
        affectedPages: page ? 1 : (issue.affectedPages?.length ?? 0),
        traffic: { ...traffic },
      });
      return;
    }

    existing.instances.push(instance);
    existing.affectedPages = page
      ? existing.instances.filter((item) => item.page).length
      : Math.max(existing.affectedPages, issue.affectedPages?.length ?? 0);
    existing.traffic.clicks += traffic.clicks;
    existing.traffic.impressions += traffic.impressions;
    existing.traffic.sessions += traffic.sessions;
    existing.traffic.pageviews += traffic.pageviews;
    if (!existing.suggestedFix && issue.suggestedFix) existing.suggestedFix = issue.suggestedFix;
    if (severityRank(issue.severity) > severityRank(existing.severity)) existing.severity = issue.severity;
  };

  for (const page of data.pages) {
    for (const issue of page.issues) addIssue(issue, page);
  }
  for (const issue of data.siteWideIssues) addIssue(issue, null);

  return [...groups.values()].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    const trafficDiff = b.traffic.clicks - a.traffic.clicks;
    if (trafficDiff !== 0) return trafficDiff;
    return b.affectedPages - a.affectedPages;
  });
}

function filterIssueGroups(
  groups: AuditIssueGroup[],
  search: string,
  severities: ReadonlySet<string>,
  categories: ReadonlySet<string>,
  sortMode: SiteAuditSortMode,
): AuditIssueGroup[] {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = groups.filter((group) => {
    if (severities.size > 0 && !severities.has(group.severity)) return false;
    if (categories.size > 0 && !categories.has(group.displayCategory)) return false;
    if (!normalizedSearch) return true;
    return [
      group.check,
      group.message,
      group.recommendation,
      group.categoryLabel,
      ...group.instances.flatMap((instance) => [
        instance.page?.page,
        instance.page?.slug,
        instance.page?.url,
      ]),
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch));
  });

  return filtered.sort((a, b) => {
    if (sortMode === 'traffic') {
      const trafficDiff = b.traffic.clicks - a.traffic.clicks;
      if (trafficDiff !== 0) return trafficDiff;
      return b.traffic.sessions - a.traffic.sessions;
    }
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return b.affectedPages - a.affectedPages;
  });
}

export function useSiteAuditRebuilt(workspaceId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaces.data, workspaceId],
  );
  const siteId = workspace?.webflowSiteId ?? '';
  const siteName = workspace?.webflowSiteName || workspace?.name || siteId;

  const workflow = useSeoAuditWorkflow({ siteId, workspaceId });
  const traffic = useAuditTrafficMap(siteId, workspaceId);
  const suppressions = useAuditSuppressions(workspaceId);
  const schedule = useAuditSchedule(workspaceId);
  const pageStates = usePageEditStates(workspaceId);

  const [createdTasks, setCreatedTasks] = useState<Set<string>>(new Set());
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [batchCreating, setBatchCreating] = useState(false);
  const [batchResult, setBatchResult] = useState<{ count: number; timestamp: number } | null>(null);
  const [applyingFix, setApplyingFix] = useState<string | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [flaggedIssues, setFlaggedIssues] = useState<Set<string>>(new Set());
  const [flagSending, setFlagSending] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const rawData = workflow.data as SiteAuditResult | null;
  const suppressionList = suppressions.data ?? [];
  const effectiveData = useMemo(
    () => (rawData ? applyClientSuppressions(rawData, suppressionList) as SiteAuditResult : null),
    [rawData, suppressionList],
  );
  const categoryScores = useMemo(() => deriveCategoryScores(effectiveData), [effectiveData]);
  const issueGroups = useMemo(
    () => buildIssueGroups(effectiveData, traffic.data ?? {}),
    [effectiveData, traffic.data],
  );

  const suppressIssue = useCallback(async (check: string, pageSlug: string) => {
    const { suppressions: updated } = await post<SuppressionPayload>(
      `/api/workspaces/${workspaceId}/audit-suppressions`,
      { check, pageSlug },
    );
    queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    return updated;
  }, [queryClient, workspaceId]);

  const unsuppressIssue = useCallback(async (check: string, pageSlug: string, pagePattern?: string) => {
    const body = pagePattern ? { check, pagePattern } : { check, pageSlug };
    const { suppressions: updated } = await del<SuppressionPayload>(
      `/api/workspaces/${workspaceId}/audit-suppressions`,
      body,
    );
    queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    return updated;
  }, [queryClient, workspaceId]);

  const suppressPattern = useCallback(async (check: string, pageSlug: string) => {
    const prefix = pageSlug.includes('/') ? pageSlug.split('/')[0] : pageSlug;
    const pagePattern = `${prefix}/*`;
    const { suppressions: updated } = await post<SuppressionPayload>(
      `/api/workspaces/${workspaceId}/audit-suppressions`,
      { check, pagePattern, reason: `Pattern: ${pagePattern}` },
    );
    queryClient.setQueryData(queryKeys.admin.auditSuppressions(workspaceId), updated);
    return updated;
  }, [queryClient, workspaceId]);

  const unsuppressAll = useCallback(async () => {
    for (const suppression of suppressionList) {
      await unsuppressIssue(suppression.check, suppression.pageSlug, suppression.pagePattern);
    }
  }, [suppressionList, unsuppressIssue]);

  const acceptSuggestion = useCallback(async (page: SiteAuditPage, issue: SiteAuditIssue) => {
    if (!siteId || !issue.suggestedFix) return false;
    const fixKey = `${page.pageId}-${issue.check}`;
    const text = editedSuggestions[fixKey] || issue.suggestedFix;
    setApplyingFix(fixKey);
    try {
      const fields: Record<string, unknown> = {};
      if (issue.check === 'title' || issue.check === 'title_length' || issue.check === 'missing_title') {
        fields.seo = { title: text };
      } else if (issue.check === 'meta-description' || issue.check === 'meta_length' || issue.check === 'missing_meta') {
        fields.seo = { description: text };
      } else if (issue.check === 'og-tags' && issue.message.toLowerCase().includes('title')) {
        fields.openGraph = { title: text };
      } else if (issue.check === 'og-tags' && issue.message.toLowerCase().includes('description')) {
        fields.openGraph = { description: text };
      }
      const result = await put<{ success?: boolean }>(
        `/api/webflow/pages/${page.pageId}/seo`,
        { siteId, workspaceId, ...fields },
      );
      if (result.success) {
        setAppliedFixes((prev) => new Set(prev).add(fixKey));
        return true;
      }
      return false;
    } finally {
      setApplyingFix(null);
    }
  }, [editedSuggestions, siteId, workspaceId]);

  const openQuickFix = useCallback((page: SiteAuditPage, issue: SiteAuditIssue) => {
    const check = issue.check.toLowerCase();
    const context = {
      pageId: page.pageId,
      pageSlug: page.slug,
      pageName: page.page,
      issueCheck: issue.check,
      issueMessage: issue.message,
    };
    if (check.includes('schema')) {
      navigate(adminPath(workspaceId, 'seo-schema'), { state: { fixContext: { ...context, targetRoute: 'seo-schema' } } });
      return;
    }
    if (check.includes('link') || check.includes('redirect') || check.includes('canonical')) {
      navigate(`${adminPath(workspaceId, 'links')}?tab=dead-links`, { state: { fixContext: { ...context, targetRoute: 'links' } } });
      return;
    }
    if (check.includes('content') || check.includes('word') || check.includes('thin')) {
      navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`, { state: { fixContext: { ...context, targetRoute: 'content-pipeline' } } });
      return;
    }
    if (displayCategoryFor(issue) === 'perf') {
      navigate(adminPath(workspaceId, 'performance'), { state: { fixContext: { ...context, targetRoute: 'performance' } } });
      return;
    }
    navigate(`${adminPath(workspaceId, 'seo-editor')}?tab=research`, { state: { fixContext: { ...context, targetRoute: 'seo-editor' } } });
  }, [navigate, workspaceId]);

  const openDeadLinks = useCallback(() => {
    navigate(`${adminPath(workspaceId, 'links')}?tab=dead-links`);
  }, [navigate, workspaceId]);

  const createTaskFromIssue = useCallback(async (page: SiteAuditPage, issue: SiteAuditIssue) => {
    const taskKey = issueToTaskKey(page, issue);
    setCreatingTask(taskKey);
    try {
      const item = issueToTaskItem(page, issue, editedSuggestions);
      await post('/api/requests', { workspaceId, ...item });
      setCreatedTasks((prev) => new Set(prev).add(taskKey));
      return true;
    } finally {
      setCreatingTask(null);
    }
  }, [editedSuggestions, workspaceId]);

  const batchCreateTasks = useCallback(async (mode: 'all' | 'errors' | 'filtered', filteredGroups?: AuditIssueGroup[]) => {
    if (!effectiveData) return 0;
    setBatchCreating(true);
    try {
      const instances = mode === 'filtered'
        ? (filteredGroups ?? []).flatMap((group) => group.instances)
        : effectiveData.pages.flatMap((page) => page.issues
            .filter((issue) => mode !== 'errors' || issue.severity === 'error')
            .map((issue) => ({ id: issueToTaskKey(page, issue), page, issue })));
      const pageInstances = instances.filter((item): item is AuditIssueInstance & { page: SiteAuditPage } => !!item.page);
      const unique = new Map<string, AuditIssueInstance & { page: SiteAuditPage }>();
      for (const instance of pageInstances) {
        const key = issueToTaskKey(instance.page, instance.issue);
        if (!createdTasks.has(key)) unique.set(key, instance);
      }
      const items = [...unique.values()].map((instance) => issueToTaskItem(instance.page, instance.issue, editedSuggestions));
      if (items.length === 0) return 0;
      const result = await post<{ created: number }>('/api/requests/batch', { workspaceId, items });
      setCreatedTasks((prev) => {
        const next = new Set(prev);
        for (const key of unique.keys()) next.add(key);
        return next;
      });
      setBatchResult({ count: result.created, timestamp: Date.now() });
      return result.created;
    } finally {
      setBatchCreating(false);
    }
  }, [createdTasks, editedSuggestions, effectiveData, workspaceId]);

  const flagForClient = useCallback(async (page: SiteAuditPage, issue: SiteAuditIssue, note: string) => {
    const key = issueToTaskKey(page, issue);
    const fixKey = `${page.pageId}-${issue.check}`;
    const suggestion = editedSuggestions[fixKey] || issue.suggestedFix || '';
    const field = issue.check === 'title' ? 'seoTitle' : 'seoDescription';
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
      setFlaggedIssues((prev) => new Set(prev).add(key));
      return true;
    } finally {
      setFlagSending(false);
    }
  }, [editedSuggestions, siteId, workspaceId]);

  const saveAndShare = useCallback(async () => {
    if (!rawData || !siteId) return null;
    setSavingReport(true);
    setShareUrl(null);
    try {
      const autoId = (rawData as SiteAuditResult & { snapshotId?: string }).snapshotId;
      if (autoId) {
        const url = `${window.location.origin}/report/${autoId}`;
        setShareUrl(url);
        return url;
      }
      const result = await post<{ id: string }>(
        `/api/reports/${siteId}/snapshot`,
        { workspaceId, siteName, audit: rawData },
      );
      const url = `${window.location.origin}/report/${result.id}`;
      setShareUrl(url);
      workflow.refreshAuditHistory();
      return url;
    } finally {
      setSavingReport(false);
    }
  }, [rawData, siteId, siteName, workflow, workspaceId]);

  const saveSchedule = useCallback(async (enabled: boolean, intervalDays: number, scoreDropThreshold: number) => {
    setScheduleSaving(true);
    try {
      const updated = await put<AuditSchedule>(`/api/audit-schedules/${workspaceId}`, {
        enabled,
        intervalDays,
        scoreDropThreshold,
      });
      queryClient.setQueryData(queryKeys.admin.auditSchedule(workspaceId), updated);
      return updated;
    } finally {
      setScheduleSaving(false);
    }
  }, [queryClient, workspaceId]);

  return {
    workspace,
    workspaces,
    siteId,
    siteName,
    workflow,
    traffic,
    suppressions: suppressionList,
    schedule,
    pageStates,
    data: effectiveData,
    rawData,
    categoryScores,
    issueGroups,
    filterIssueGroups,
    createdTasks,
    creatingTask,
    batchCreating,
    batchResult,
    applyingFix,
    appliedFixes,
    setAppliedFixes,
    editedSuggestions,
    setEditedSuggestions,
    flaggedIssues,
    flagSending,
    savingReport,
    shareUrl,
    setShareUrl,
    scheduleSaving,
    suppressIssue,
    unsuppressIssue,
    suppressPattern,
    unsuppressAll,
    acceptSuggestion,
    openQuickFix,
    openDeadLinks,
    createTaskFromIssue,
    batchCreateTasks,
    flagForClient,
    saveAndShare,
    saveSchedule,
  };
}
