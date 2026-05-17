import { useEffect, useMemo, useRef, useState } from 'react';
import { getSafe, post } from '../../../api/client';
import type { AuditDetail, PageAuditResult } from '../types';
import { toLiveUrl } from '../utils';
import { buildContentImprovementRequest } from '../../../lib/health-tab-content-request';
import {
  buildCategoryStats,
  countInfoIssues,
  filterAuditPages,
} from './healthTabModel';

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
    () => {
      if (!auditDetail) return [];

      return filterAuditPages(
        auditDetail.audit.pages,
        auditSearch,
        severityFilter,
        showInfoItems,
        (url) => toLiveUrl(url, liveDomain),
      );
    },
    [auditDetail, auditSearch, liveDomain, severityFilter, showInfoItems],
  );

  const categoryStats = useMemo(() => {
    return buildCategoryStats(auditDetail);
  }, [auditDetail]);

  const infoIssueCount = useMemo(
    () => countInfoIssues(auditDetail),
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
