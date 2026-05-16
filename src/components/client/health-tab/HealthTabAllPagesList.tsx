import { AlertTriangle, ChevronDown, FileEdit, Info, Layers, LayoutList } from 'lucide-react';
import { Button, ClickableRow, Icon, SectionCard } from '../../ui';
import { scoreColorClass } from '../../ui/constants';
import { hasContentIssues } from '../../../lib/health-tab-content-request';
import { toLiveUrl } from '../utils';
import { SEV } from '../types';
import type { AuditDetail } from '../types';
import {
  buildFixTypeGroups,
  type SeverityFilter,
} from './healthTabModel';

interface ContentImprovementPage {
  pageId: string;
  page: string;
  slug: string;
  issues: { check: string; message: string }[];
}

interface HealthTabAllPagesListProps {
  auditDetail: AuditDetail;
  liveDomain?: string;
  viewMode: 'by-page' | 'by-fix-type';
  setViewMode: (mode: 'by-page' | 'by-fix-type') => void;
  severityFilter: SeverityFilter;
  setSeverityFilter: (severity: SeverityFilter) => void;
  showInfoItems: boolean;
  setShowInfoItems: (show: boolean) => void;
  auditSearch: string;
  setAuditSearch: (search: string) => void;
  infoIssueCount: number;
  filteredPages: AuditDetail['audit']['pages'];
  expandedPages: Set<string>;
  togglePage: (id: string) => void;
  workspaceId?: string;
  requestedPages: Set<string>;
  requestingPage: string | null;
  requestError: string | null;
  onRequestContentImprovement: (page: ContentImprovementPage) => void;
  onResetRequestError: () => void;
  checkImpact: (check: string) => string | null;
}

export function HealthTabAllPagesList({
  auditDetail,
  liveDomain,
  viewMode,
  setViewMode,
  severityFilter,
  setSeverityFilter,
  showInfoItems,
  setShowInfoItems,
  auditSearch,
  setAuditSearch,
  infoIssueCount,
  filteredPages,
  expandedPages,
  togglePage,
  workspaceId,
  requestedPages,
  requestingPage,
  requestError,
  onRequestContentImprovement,
  onResetRequestError,
  checkImpact,
}: HealthTabAllPagesListProps) {
  const fixTypeGroups = buildFixTypeGroups(auditDetail, severityFilter, showInfoItems);

  return (
    <SectionCard noPadding>
      <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center gap-2 flex-wrap bg-[var(--surface-1)]/50">
        <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('by-page')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${viewMode === 'by-page' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
          >
            <Icon as={LayoutList} size="sm" /> By Page
          </button>
          <button
            type="button"
            onClick={() => setViewMode('by-fix-type')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${viewMode === 'by-fix-type' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
          >
            <Icon as={Layers} size="sm" /> By Fix Type
          </button>
        </div>

        <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
          {(['all', 'error', 'warning'] as const).map((severity) => (
            <button
              key={severity}
              type="button"
              onClick={() => setSeverityFilter(severity)}
              className={`px-3 py-2 min-h-[44px] rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${
                severityFilter === severity
                  ? severity === 'all'
                    ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)]'
                    : `${SEV[severity].bg} ${SEV[severity].text}`
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              }`}
            >
              {severity === 'all' ? 'Issues' : severity.charAt(0).toUpperCase() + severity.slice(1)}
            </button>
          ))}
        </div>

        {infoIssueCount > 0 && (
          <button
            type="button"
            onClick={() => setShowInfoItems(!showInfoItems)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-lg)] t-caption-sm transition-colors border ${
              showInfoItems
                ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] border-[var(--brand-border-strong)]'
                : 'bg-transparent text-[var(--brand-text-muted)] border-[var(--brand-border-strong)] hover:text-[var(--brand-text)]'
            }`}
          >
            <Icon as={Info} size="sm" />
            {showInfoItems ? 'Hide' : 'Show'} {infoIssueCount} informational
          </button>
        )}

        {viewMode === 'by-page' && (
          <input
            type="text"
            value={auditSearch}
            onChange={(event) => setAuditSearch(event.target.value)}
            placeholder="Search pages..."
            className="bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-[var(--brand-border-strong)] w-40"
          />
        )}
      </div>

      {viewMode === 'by-page' && (
        <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
          {filteredPages.map((page) => {
            const errors = page.issues.filter((issue) => issue.severity === 'error').length;
            const warnings = page.issues.filter((issue) => issue.severity === 'warning').length;
            const isExpanded = expandedPages.has(page.pageId);

            return (
              <div key={page.pageId} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                <ClickableRow onClick={() => togglePage(page.pageId)} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {errors > 0 && <span className="t-caption-sm text-accent-danger bg-red-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{errors} err</span>}
                    {warnings > 0 && <span className="t-caption-sm text-accent-warning bg-amber-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)]">{warnings} warn</span>}
                    <div className={`t-stat-sm ${scoreColorClass(page.score)}`}>{page.score}</div>
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  </div>
                </ClickableRow>

                {isExpanded && (
                  <div className="px-4 pb-3">
                    <div className="space-y-2">
                      {page.issues.filter((issue) => showInfoItems || issue.severity !== 'info').map((issue, index) => {
                        const severityStyle = SEV[issue.severity];
                        return (
                          <div key={index} className={`px-3 py-2 rounded-[var(--radius-lg)] ${severityStyle.bg} border ${severityStyle.border}`}>
                            <div className="flex items-start gap-2">
                              {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${severityStyle.text} flex-shrink-0 mt-0.5`} />}
                              {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${severityStyle.text} flex-shrink-0 mt-0.5`} />}
                              <div className="flex-1">
                                <div className="t-caption-sm text-[var(--brand-text)]">{issue.message}</div>
                                {issue.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {hasContentIssues(page.issues) && workspaceId && (
                      <>
                        <Button
                          icon={FileEdit}
                          onClick={() => {
                            onResetRequestError();
                            onRequestContentImprovement(page);
                          }}
                          disabled={requestedPages.has(page.pageId) || requestingPage === page.pageId}
                          className={`mt-3 ${requestedPages.has(page.pageId) ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20' : ''}`}
                        >
                          {requestedPages.has(page.pageId) ? 'Request created' : requestingPage === page.pageId ? 'Creating...' : 'Request Content Fix'}
                        </Button>
                        {requestError === page.pageId && <p className="t-caption-sm text-accent-danger mt-1">Failed to create request. Please try again.</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filteredPages.length === 0 && <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">No pages match your filters</div>}
        </div>
      )}

      {viewMode === 'by-fix-type' && (
        <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
          {fixTypeGroups.length === 0 && <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">No issues match your filters</div>}
          {fixTypeGroups.map((group) => {
            const severityStyle = SEV[group.severity];
            const expansionKey = `fix-type-${group.check}`;
            const isExpanded = expandedPages.has(expansionKey);

            return (
              <div key={group.check} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                <ClickableRow onClick={() => togglePage(expansionKey)} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption font-medium text-[var(--brand-text)]">{group.label}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">
                      {group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'} affected
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`t-caption-sm font-medium uppercase ${severityStyle.text}`}>{group.severity}</span>
                    <span className={`t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)] ${severityStyle.bg} border ${severityStyle.border} ${severityStyle.text}`}>
                      {group.pages.length}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  </div>
                </ClickableRow>

                {isExpanded && (
                  <div className="px-4 pb-3">
                    {checkImpact(group.check) && <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2 leading-relaxed px-1">{checkImpact(group.check)}</div>}
                    <div className="space-y-1.5">
                      {group.pages.map((page, index) => (
                        <div key={`${page.pageId}-${index}`} className={`px-3 py-2 rounded-[var(--radius-lg)] ${severityStyle.bg} border ${severityStyle.border}`}>
                          <div className="t-caption-sm font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                          {page.recommendation && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{page.recommendation}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
