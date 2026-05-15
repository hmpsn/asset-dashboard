import { useEffect, useMemo, useRef, useState } from 'react';
import { getSafe, post } from '../../../api/client';
import type { AuditDetail, PageAuditResult } from '../types';
import { toLiveUrl } from '../utils';
import { buildContentImprovementRequest } from '../../../lib/health-tab-content-request';

export type SeverityFilter = 'all' | 'error' | 'warning' | 'info';
export type ViewMode = 'by-page' | 'by-fix-type';

export interface ShareableReport {
  id: string;
  type: 'audit' | 'monthly';
  title: string;
  createdAt: string;
  score?: number;
  permalink: string;
}

interface RequestablePage {
  pageId: string;
  page: string;
  slug: string;
  issues: { check: string; message: string }[];
}

interface UseHealthTabShellOptions {
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: SeverityFilter;
  workspaceId?: string;
  onContentRequested?: () => void;
}

export function useHealthTabShell({
  auditDetail,
  liveDomain,
  initialSeverity,
  workspaceId,
  onContentRequested,
}: UseHealthTabShellOptions) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['site-wide-all']));
  const allPagesRef = useRef<HTMLDivElement>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(initialSeverity || 'warning');
  const [showInfoItems, setShowInfoItems] = useState(false);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('by-page');
  const [auditSearch, setAuditSearch] = useState('');
  const [requestedPages, setRequestedPages] = useState<Set<string>>(new Set());
  const [requestingPage, setRequestingPage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [reports, setReports] = useState<ShareableReport[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const togglePage = (id: string) =>
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const requestContentImprovement = async (page: RequestablePage) => {
    if (!workspaceId || requestedPages.has(page.pageId)) return;
    setRequestingPage(page.pageId);
    try {
      await post(
        `/api/public/content-request/${workspaceId}/from-audit`,
        buildContentImprovementRequest(page),
      );
      setRequestedPages((prev) => new Set(prev).add(page.pageId));
      onContentRequested?.();
    } catch {
      setRequestError(page.pageId);
    } finally {
      setRequestingPage(null);
    }
  };

  useEffect(() => {
    if (shareOpen && workspaceId && reports.length === 0) {
      getSafe<ShareableReport[]>(`/api/public/reports/${workspaceId}`, []).then(setReports);
    }
  }, [shareOpen, workspaceId, reports.length]);

  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shareOpen]);

  const copyReportLink = (permalink: string, id: string) => {
    const url = `${window.location.origin}${permalink}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const filteredPages = useMemo(
    () =>
      auditDetail?.audit.pages.filter((page) => {
        if (
          auditSearch &&
          !page.page.toLowerCase().includes(auditSearch.toLowerCase()) &&
          !toLiveUrl(page.url, liveDomain).toLowerCase().includes(auditSearch.toLowerCase())
        ) {
          return false;
        }
        if (severityFilter === 'all') {
          if (!showInfoItems) return page.issues.some((issue) => issue.severity !== 'info');
          return true;
        }
        if (severityFilter === 'info') return page.issues.some((issue) => issue.severity === 'info');
        return page.issues.some((issue) => issue.severity === severityFilter);
      }) ?? [],
    [auditDetail, auditSearch, liveDomain, severityFilter, showInfoItems],
  );

  const categoryStats = useMemo(() => {
    const cats: Record<string, { errors: number; warnings: number; infos: number }> = {};
    if (!auditDetail) return cats;
    auditDetail.audit.pages.forEach((page) =>
      page.issues.forEach((issue) => {
        const category = issue.category || 'other';
        if (!cats[category]) cats[category] = { errors: 0, warnings: 0, infos: 0 };
        if (issue.severity === 'error') cats[category].errors++;
        else if (issue.severity === 'warning') cats[category].warnings++;
        else cats[category].infos++;
      }),
    );
    return cats;
  }, [auditDetail]);

  const infoIssueCount = useMemo(
    () =>
      auditDetail
        ? auditDetail.audit.pages.reduce(
            (sum, page) => sum + page.issues.filter((issue) => issue.severity === 'info').length,
            0,
          )
        : 0,
    [auditDetail],
  );

  return {
    allPagesRef,
    shareRef,
    expandedSections,
    severityFilter,
    showInfoItems,
    expandedPages,
    viewMode,
    auditSearch,
    requestedPages,
    requestingPage,
    requestError,
    shareOpen,
    reports,
    copiedId,
    filteredPages,
    categoryStats,
    infoIssueCount,
    setSeverityFilter,
    setShowInfoItems,
    setViewMode,
    setAuditSearch,
    setRequestError,
    setShareOpen,
    toggleSection,
    togglePage,
    requestContentImprovement,
    copyReportLink,
  };
}

export type HealthTabShell = ReturnType<typeof useHealthTabShell>;
export type HealthTabPage = PageAuditResult;
