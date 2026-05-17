import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileEdit,
  FileText,
  Globe,
  Info,
  LayoutList,
  Layers,
  Link2,
  Minus,
  Share2,
} from 'lucide-react';
import { Badge, Button, ClickableRow, FormInput, Icon, IconButton, SectionCard } from '../../ui';
import { scoreColorClass, themeColor } from '../../ui/constants';
import { ScoreHistoryChart } from '../helpers';
import { toLiveUrl } from '../utils';
import { CAT_LABELS, SEV, type AuditDetail, type CwvStrategyResult } from '../types';
import { hasContentIssues } from '../../../lib/health-tab-content-request';
import { buildFixTypeGroups, checkImpact } from './healthTabModel';
import type { HealthTabShell } from './useHealthTabShell';

interface HeaderSectionProps {
  auditDetail: AuditDetail;
  shell: Pick<
    HealthTabShell,
    'shareOpen' | 'setShareOpen' | 'shareRef' | 'reports' | 'copiedId' | 'copyReportLink'
  >;
}

export function HealthHeaderSection({ auditDetail, shell }: HeaderSectionProps) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h2 className="t-h2 text-[var(--brand-text-bright)]">Site Health</h2>
        <p className="t-body text-[var(--brand-text-muted)] mt-1">
          {auditDetail.audit.totalPages} pages · Last scanned{' '}
          {new Date(auditDetail.createdAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>
      <div className="relative" ref={shell.shareRef}>
        <Button
          variant="secondary"
          size="sm"
          icon={Share2}
          onClick={() => shell.setShareOpen(!shell.shareOpen)}
        >
          Share Report
        </Button>
        {shell.shareOpen && (
          // pr-check-disable-next-line -- Shareable Reports popover dropdown; positioned absolute, not a content card
          <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--surface-2)] border border-[var(--brand-border-strong)] rounded-[var(--radius-xl)] shadow-xl z-[var(--z-modal)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--brand-border)]">
              <div className="t-caption font-medium text-[var(--brand-text)]">Shareable Reports</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                Copy a link to share with your team
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-[var(--brand-border)]/50">
              {shell.reports.length === 0 && (
                <div className="px-4 py-6 text-center t-caption text-[var(--brand-text-muted)]">
                  Loading reports...
                </div>
              )}
              {shell.reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-3)]/50 transition-colors"
                >
                  <div
                    className={`w-7 h-7 rounded-[var(--radius-lg)] flex items-center justify-center flex-shrink-0 ${report.type === 'audit' ? 'bg-emerald-500/10' : 'bg-blue-500/10'}`}
                  >
                    {report.type === 'audit' ? (
                      <Icon as={BarChart3} size="md" className="text-accent-success" />
                    ) : (
                      <Icon as={FileText} size="md" className="text-accent-info" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">
                      {report.title}
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">
                      {new Date(report.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <IconButton
                      icon={shell.copiedId === report.id ? Check : Link2}
                      label="Copy report link"
                      size="sm"
                      variant={shell.copiedId === report.id ? 'accent' : 'ghost'}
                      onClick={() => shell.copyReportLink(report.permalink, report.id)}
                    />
                    <a
                      href={report.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
                      title="Open report"
                    >
                      <Icon as={ExternalLink} size="md" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ScoreSummaryProps {
  auditDetail: AuditDetail;
  shell: Pick<HealthTabShell, 'severityFilter' | 'setSeverityFilter' | 'allPagesRef'>;
}

export function HealthScoreSummarySection({ auditDetail, shell }: ScoreSummaryProps) {
  const score = auditDetail.audit.siteScore;
  const summary =
    score >= 90
      ? 'Your site is in excellent shape with only minor improvements needed.'
      : score >= 70
        ? 'Good foundation with some actionable fixes to boost your rankings.'
        : score >= 50
          ? 'Several issues are holding back your search performance — prioritize the fixes below.'
          : 'Critical issues need immediate attention to establish search visibility.';

  return (
    <SectionCard>
      <div className="flex items-center gap-4">
        <div className={`t-stat-lg ${scoreColorClass(score)}`}>{score}</div>
        <div className="flex-1">
          <div className="t-ui font-medium text-[var(--brand-text-bright)]">Your site's health</div>
          <div className="t-body text-[var(--brand-text-muted)] mt-0.5">{summary}</div>
        </div>
        {auditDetail.previousScore != null && (
          <div
            className={`t-caption ${auditDetail.audit.siteScore > auditDetail.previousScore ? 'text-accent-success' : auditDetail.audit.siteScore < auditDetail.previousScore ? 'text-accent-danger' : 'text-[var(--brand-text-muted)]'}`}
          >
            {auditDetail.audit.siteScore > auditDetail.previousScore ? '↑' : '↓'}{' '}
            {Math.abs(auditDetail.audit.siteScore - auditDetail.previousScore)} from previous
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--brand-border)]/50 t-caption">
        <span className="text-[var(--brand-text-muted)]">{auditDetail.audit.totalPages} pages scanned</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            shell.setSeverityFilter(shell.severityFilter === 'error' ? 'all' : 'error');
            setTimeout(() => shell.allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
          }}
          className={`!px-0 !py-0 !min-h-0 rounded-none bg-transparent hover:bg-transparent transition-colors ${shell.severityFilter === 'error' ? 'text-accent-danger font-medium' : 'text-accent-danger hover:text-accent-danger'}`}
        >
          {auditDetail.audit.errors} errors
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            shell.setSeverityFilter(shell.severityFilter === 'warning' ? 'all' : 'warning');
            setTimeout(() => shell.allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
          }}
          className={`!px-0 !py-0 !min-h-0 rounded-none bg-transparent hover:bg-transparent transition-colors ${shell.severityFilter === 'warning' ? 'text-accent-warning font-medium' : 'text-accent-warning hover:text-accent-warning'}`}
        >
          {auditDetail.audit.warnings} warnings
        </Button>
      </div>
    </SectionCard>
  );
}

export function HealthAuditDiffSection({ auditDetail }: { auditDetail: AuditDetail }) {
  if (
    !auditDetail.auditDiff ||
    auditDetail.previousScore == null ||
    (auditDetail.auditDiff.resolved === 0 && auditDetail.auditDiff.newIssues === 0)
  ) {
    return null;
  }

  const { resolved, newIssues } = auditDetail.auditDiff;
  const scoreDelta = auditDetail.audit.siteScore - auditDetail.previousScore;
  const deltaColor =
    scoreDelta > 0
      ? 'text-accent-success'
      : scoreDelta < 0
        ? 'text-accent-danger'
        : 'text-[var(--brand-text-muted)]';
  const DeltaIcon = scoreDelta > 0 ? ArrowUp : scoreDelta < 0 ? AlertTriangle : Minus;

  return (
    // pr-check-disable-next-line -- Compact audit-delta status bar; inline row element, not a content card
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-xl)] bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption">
      <DeltaIcon className={`w-4 h-4 flex-shrink-0 ${deltaColor}`} />
      <span className="text-[var(--brand-text-muted)]">Since last audit:</span>
      {resolved > 0 && <span className="text-accent-success font-medium">{resolved} resolved</span>}
      {resolved > 0 && newIssues > 0 && <span className="text-[var(--brand-text-faint)]">·</span>}
      {newIssues > 0 && <span className="text-accent-danger font-medium">{newIssues} new</span>}
      <span className="text-[var(--brand-text-faint)]">·</span>
      <span className={`font-medium ${deltaColor}`}>
        score {auditDetail.previousScore} → {auditDetail.audit.siteScore}
        {scoreDelta !== 0 && (
          <span className="ml-1">
            ({scoreDelta > 0 ? '+' : ''}
            {scoreDelta})
          </span>
        )}
      </span>
    </div>
  );
}

export function HealthPageSpeedSection({ auditDetail }: { auditDetail: AuditDetail }) {
  if (!auditDetail.audit.cwvSummary || (!auditDetail.audit.cwvSummary.mobile && !auditDetail.audit.cwvSummary.desktop)) {
    return null;
  }

  const ratingColor = (rating: CwvStrategyResult['metrics']['LCP']['rating']) =>
    rating === 'good'
      ? 'text-accent-success'
      : rating === 'needs-improvement'
        ? 'text-accent-warning'
        : rating === 'poor'
          ? 'text-accent-danger'
          : 'text-[var(--brand-text-muted)]';
  const ratingBg = (rating: CwvStrategyResult['metrics']['LCP']['rating']) =>
    rating === 'good'
      ? 'bg-emerald-500/10 border-emerald-500/20'
      : rating === 'needs-improvement'
        ? 'bg-amber-500/10 border-amber-500/20'
        : rating === 'poor'
          ? 'bg-red-500/10 border-red-500/20'
          : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)]/30';
  const assessBadge = (assessment: CwvStrategyResult['assessment']) =>
    assessment === 'good'
      ? { text: 'Passed', tone: 'emerald' as const }
      : assessment === 'needs-improvement'
        ? { text: 'Needs Work', tone: 'amber' as const }
        : assessment === 'poor'
          ? { text: 'Failed', tone: 'red' as const }
          : { text: 'No Data', tone: 'zinc' as const };

  const renderStrategy = (label: string, strategy: CwvStrategyResult) => {
    const badge = assessBadge(strategy.assessment);
    return (
      <div key={label} className="flex-1 min-w-[200px]">
        <div className="flex items-center justify-between mb-2">
          <span className="t-caption font-medium text-[var(--brand-text-muted)] tracking-wider">{label}</span>
          <Badge label={badge.text} tone={badge.tone} variant="outline" />
        </div>
        <div className="space-y-1.5">
          {[
            { key: 'LCP' as const, label: 'Loading Speed', fmt: (value: number) => `${(value / 1000).toFixed(1)}s`, desc: 'Content appears' },
            { key: 'INP' as const, label: 'Responsiveness', fmt: (value: number) => `${Math.round(value)}ms`, desc: 'Page reacts' },
            { key: 'CLS' as const, label: 'Visual Stability', fmt: (value: number) => value.toFixed(2), desc: 'Layout shifts' },
          ].map((metricDef) => {
            const metric = strategy.metrics[metricDef.key];
            return (
              <div key={metricDef.key} className={`flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] border ${ratingBg(metric.rating)}`}>
                <div>
                  <span className="t-caption font-medium text-[var(--brand-text)]">{metricDef.label}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">{metricDef.desc}</span>
                </div>
                <span className={`t-body font-mono font-medium ${ratingColor(metric.rating)}`}>
                  {metric.value !== null ? metricDef.fmt(metric.value) : '—'}
                </span>
              </div>
            );
          })}
        </div>
        {!strategy.fieldDataAvailable && (
          <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-amber-500/10 border border-amber-500/20">
            <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
            <p className="t-caption-sm text-accent-warning">
              These are simulated scores, not real user data. Real metrics appear once Chrome has enough traffic data for your site.
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <SectionCard
      title="Page Speed & Core Web Vitals"
      titleIcon={<Icon as={Globe} size="md" className="text-accent-brand" />}
      titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">Google uses these to rank your site</span>}
    >
      <div className="flex gap-4 flex-wrap">
        {auditDetail.audit.cwvSummary.mobile && renderStrategy('Mobile', auditDetail.audit.cwvSummary.mobile)}
        {auditDetail.audit.cwvSummary.desktop && renderStrategy('Desktop', auditDetail.audit.cwvSummary.desktop)}
      </div>
    </SectionCard>
  );
}

interface TopFixesProps {
  auditDetail: AuditDetail;
  liveDomain?: string;
  workspaceId?: string;
  shell: Pick<
    HealthTabShell,
    | 'requestedPages'
    | 'requestingPage'
    | 'requestError'
    | 'setRequestError'
    | 'expandedPages'
    | 'togglePage'
    | 'requestContentImprovement'
    | 'allPagesRef'
  >;
}

export function HealthTopFixesSection({ auditDetail, liveDomain, workspaceId, shell }: TopFixesProps) {
  const { prioritized, sortedPages } = useMemo(() => {
    const allIssues: Array<{
      pageId: string;
      page: string;
      slug: string;
      url: string;
      issue: {
        check: string;
        message: string;
        severity: 'error' | 'warning' | 'info';
        recommendation?: string;
        category?: string;
      };
    }> = [];

    auditDetail.audit.pages.forEach((page) => {
      page.issues.forEach((issue) => {
        allIssues.push({ pageId: page.pageId, page: page.page, slug: page.slug, url: page.url, issue });
      });
    });

    const prioritizedIssues = allIssues
      .sort((a, b) => {
        const sevScore = (severity: string) => (severity === 'error' ? 3 : severity === 'warning' ? 2 : 1);
        const sevDiff = sevScore(b.issue.severity) - sevScore(a.issue.severity);
        if (sevDiff !== 0) return sevDiff;
        const aContent = hasContentIssues([a.issue]) ? 1 : 0;
        const bContent = hasContentIssues([b.issue]) ? 1 : 0;
        return bContent - aContent;
      })
      .slice(0, 5);

    const pages = [...auditDetail.audit.pages]
      .filter((page) => !page.noindex)
      .sort((a, b) => {
        const aErrors = a.issues.filter((issue) => issue.severity === 'error').length;
        const bErrors = b.issues.filter((issue) => issue.severity === 'error').length;
        if (aErrors !== bErrors) return bErrors - aErrors;
        return b.issues.length - a.issues.length;
      })
      .slice(0, 3);

    return { prioritized: prioritizedIssues, sortedPages: pages };
  }, [auditDetail]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SectionCard
        title="Fix these first"
        titleIcon={<Icon as={AlertTriangle} size="md" className="text-accent-danger" />}
        noPadding
      >
        <div className="divide-y divide-[var(--brand-border)]/50">
          {prioritized.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Icon as={CheckCircle2} size="2xl" className="text-accent-success mx-auto mb-2" />
              <p className="t-caption text-[var(--brand-text-muted)]">No critical issues found!</p>
            </div>
          ) : (
            prioritized.map((item, i) => {
              const sc = SEV[item.issue.severity];
              return (
                <div key={`${item.pageId}-${i}`} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] flex items-center justify-center flex-shrink-0 t-caption-sm text-[var(--brand-text-muted)] font-medium">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`t-caption-sm font-medium uppercase ${sc.text}`}>
                          {item.issue.severity}
                        </span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">{item.page}</span>
                      </div>
                      <div className="t-caption-sm text-[var(--brand-text)] mt-0.5">{item.issue.message}</div>
                      {checkImpact(item.issue.check) && (
                        <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 leading-relaxed">
                          {checkImpact(item.issue.check)}
                        </div>
                      )}
                    </div>
                    {hasContentIssues([item.issue]) && workspaceId && !shell.requestedPages.has(item.pageId) && (
                      <Button
                        size="sm"
                        onClick={() =>
                          shell.requestContentImprovement({
                            pageId: item.pageId,
                            page: item.page,
                            slug: item.slug,
                            issues: [item.issue],
                          })
                        }
                        disabled={shell.requestingPage === item.pageId}
                        className="flex-shrink-0"
                      >
                        {shell.requestingPage === item.pageId ? '...' : 'Fix'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Pages needing attention"
        titleIcon={<Icon as={FileText} size="md" className="text-[var(--brand-text-muted)]" />}
        action={<span className="t-caption-sm text-[var(--brand-text-muted)]">Top {sortedPages.length}</span>}
      >
        <div className="grid grid-cols-1 gap-3">
          {sortedPages.map((page) => {
            const errors = page.issues.filter((issue) => issue.severity === 'error').length;
            const warnings = page.issues.filter((issue) => issue.severity === 'warning').length;
            const isExpanded = shell.expandedPages.has(page.pageId);
            return (
              <div
                key={page.pageId}
                className={`rounded-[var(--radius-lg)] border transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50 border-[var(--brand-border-strong)]' : 'bg-[var(--surface-1)]/50 border-[var(--brand-border)]/50 hover:border-[var(--brand-border-strong)]'}`}
              >
                <ClickableRow onClick={() => shell.togglePage(page.pageId)} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                      {toLiveUrl(page.url, liveDomain)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {errors > 0 && <Badge label={`${errors}E`} tone="red" />}
                    {warnings > 0 && <Badge label={`${warnings}W`} tone="amber" />}
                    <div className={`t-stat-sm ${scoreColorClass(page.score)}`}>{page.score}</div>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                    />
                  </div>
                </ClickableRow>

                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-[var(--brand-border)]/50">
                    <div className="pt-3 space-y-2">
                      {page.issues.map((issue, i) => {
                        const sc = SEV[issue.severity];
                        return (
                          <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                            <div className="flex items-start gap-2">
                              {issue.severity === 'error' && (
                                <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />
                              )}
                              {issue.severity === 'warning' && (
                                <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />
                              )}
                              <div className="flex-1">
                                <div className="t-caption-sm text-[var(--brand-text)]">{issue.message}</div>
                                {checkImpact(issue.check) && (
                                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 leading-relaxed">
                                    {checkImpact(issue.check)}
                                  </div>
                                )}
                                {issue.recommendation && (
                                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                                    {issue.recommendation}
                                  </div>
                                )}
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
                            shell.setRequestError(null);
                            shell.requestContentImprovement(page);
                          }}
                          disabled={shell.requestedPages.has(page.pageId) || shell.requestingPage === page.pageId}
                          className={`mt-3 ${shell.requestedPages.has(page.pageId) ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20' : ''}`}
                        >
                          {shell.requestedPages.has(page.pageId)
                            ? 'Request created'
                            : shell.requestingPage === page.pageId
                              ? 'Creating...'
                              : 'Request Content Fix'}
                        </Button>
                        {shell.requestError === page.pageId && (
                          <p className="t-caption-sm text-accent-danger mt-1">Failed to create request. Please try again.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setTimeout(
              () => shell.allPagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              50,
            );
          }}
          className="w-full mt-3 border-dashed"
        >
          View all {auditDetail.audit.totalPages} pages
        </Button>
      </SectionCard>
    </div>
  );
}

interface SiteWideProps {
  auditDetail: AuditDetail;
  shell: Pick<HealthTabShell, 'expandedSections' | 'toggleSection'>;
}

export function HealthSiteWideIssuesSection({ auditDetail, shell }: SiteWideProps) {
  if (auditDetail.audit.siteWideIssues.length === 0) return null;

  return (
    <SectionCard
      title="Site-Wide Issues"
      titleIcon={
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-[var(--surface-3)] flex items-center justify-center">
          <Icon as={Info} size="md" className="text-accent-warning" />
        </div>
      }
      titleExtra={
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          {auditDetail.audit.siteWideIssues.length} issues affecting your entire site
        </span>
      }
      noPadding
    >
      <div className="p-3">
        <div className="flex flex-wrap gap-3">
          {auditDetail.audit.siteWideIssues.slice(0, 3).map((issue, i) => {
            const sc = SEV[issue.severity];
            return (
              <div key={i} className={`px-2.5 py-1.5 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border} t-caption-sm`}>
                <span className={sc.text}>{issue.message}</span>
              </div>
            );
          })}
          {auditDetail.audit.siteWideIssues.length > 3 && (
            <Button variant="secondary" size="sm" onClick={() => shell.toggleSection('site-wide-all')}>
              +{auditDetail.audit.siteWideIssues.length - 3} more
            </Button>
          )}
        </div>

        {shell.expandedSections.has('site-wide-all') && (
          <div className="mt-3 pt-3 border-t border-[var(--brand-border)]/50 space-y-2">
            {auditDetail.audit.siteWideIssues.map((issue, i) => {
              const sc = SEV[issue.severity];
              return (
                <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                  <div className={`t-caption-sm font-medium ${sc.text}`}>{issue.message}</div>
                  {issue.recommendation && (
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface AllPagesProps {
  auditDetail: AuditDetail;
  liveDomain?: string;
  shell: Pick<
    HealthTabShell,
    | 'allPagesRef'
    | 'viewMode'
    | 'setViewMode'
    | 'severityFilter'
    | 'setSeverityFilter'
    | 'showInfoItems'
    | 'setShowInfoItems'
    | 'infoIssueCount'
    | 'auditSearch'
    | 'setAuditSearch'
    | 'filteredPages'
    | 'expandedPages'
    | 'togglePage'
    | 'requestedPages'
    | 'requestingPage'
    | 'requestError'
    | 'setRequestError'
    | 'requestContentImprovement'
  >;
  workspaceId?: string;
}

export function HealthAllPagesSection({ auditDetail, liveDomain, shell, workspaceId }: AllPagesProps) {
  return (
    <div ref={shell.allPagesRef}>
      <SectionCard noPadding>
        <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center gap-2 flex-wrap bg-[var(--surface-1)]/50">
          <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => shell.setViewMode('by-page')}
              className={`rounded-[var(--radius-md)] ${shell.viewMode === 'by-page' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
            >
              <Icon as={LayoutList} size="sm" /> By Page
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => shell.setViewMode('by-fix-type')}
              className={`rounded-[var(--radius-md)] ${shell.viewMode === 'by-fix-type' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
            >
              <Icon as={Layers} size="sm" /> By Fix Type
            </Button>
          </div>
          <div className="flex items-center gap-1 bg-[var(--surface-3)] rounded-[var(--radius-lg)] p-0.5">
            {(['all', 'error', 'warning'] as const).map((severity) => (
              <Button
                key={severity}
                variant="ghost"
                size="sm"
                onClick={() => shell.setSeverityFilter(severity)}
                className={`min-h-[44px] rounded-[var(--radius-md)] ${shell.severityFilter === severity ? (severity === 'all' ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] hover:bg-[var(--brand-border-hover)]' : `${SEV[severity].bg} ${SEV[severity].text}`) : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
              >
                {severity === 'all' ? 'Issues' : severity.charAt(0).toUpperCase() + severity.slice(1)}
              </Button>
            ))}
          </div>
          {shell.infoIssueCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => shell.setShowInfoItems(!shell.showInfoItems)}
              className={`rounded-[var(--radius-lg)] border ${shell.showInfoItems ? 'bg-[var(--brand-border-hover)] text-[var(--brand-text)] border-[var(--brand-border-strong)]' : 'bg-transparent text-[var(--brand-text-muted)] border-[var(--brand-border-strong)] hover:text-[var(--brand-text)]'}`}
            >
              <Icon as={Info} size="sm" />
              {shell.showInfoItems ? 'Hide' : 'Show'} {shell.infoIssueCount} informational
            </Button>
          )}
          {shell.viewMode === 'by-page' && (
            <FormInput
              type="text"
              value={shell.auditSearch}
              onChange={shell.setAuditSearch}
              placeholder="Search pages..."
              className="t-caption-sm w-40"
            />
          )}
        </div>

        {shell.viewMode === 'by-page' && (
          <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
            {shell.filteredPages.map((page) => {
              const errors = page.issues.filter((issue) => issue.severity === 'error').length;
              const warnings = page.issues.filter((issue) => issue.severity === 'warning').length;
              const isExpanded = shell.expandedPages.has(page.pageId);
              return (
                <div key={page.pageId} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                  <ClickableRow onClick={() => shell.togglePage(page.pageId)} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="t-caption font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {errors > 0 && <Badge label={`${errors} err`} tone="red" />}
                      {warnings > 0 && <Badge label={`${warnings} warn`} tone="amber" />}
                      <div className={`t-stat-sm ${scoreColorClass(page.score)}`}>{page.score}</div>
                      <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </div>
                  </ClickableRow>

                  {isExpanded && (
                    <div className="px-4 pb-3">
                      <div className="space-y-2">
                        {page.issues
                          .filter((issue) => shell.showInfoItems || issue.severity !== 'info')
                          .map((issue, i) => {
                            const sc = SEV[issue.severity];
                            return (
                              <div key={i} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                                <div className="flex items-start gap-2">
                                  {issue.severity === 'error' && <AlertTriangle className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
                                  {issue.severity === 'warning' && <Info className={`w-3.5 h-3.5 ${sc.text} flex-shrink-0 mt-0.5`} />}
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
                              shell.setRequestError(null);
                              shell.requestContentImprovement(page);
                            }}
                            disabled={shell.requestedPages.has(page.pageId) || shell.requestingPage === page.pageId}
                            className={`mt-3 ${shell.requestedPages.has(page.pageId) ? 'bg-emerald-500/10 text-accent-success border border-emerald-500/20' : ''}`}
                          >
                            {shell.requestedPages.has(page.pageId)
                              ? 'Request created'
                              : shell.requestingPage === page.pageId
                                ? 'Creating...'
                                : 'Request Content Fix'}
                          </Button>
                          {shell.requestError === page.pageId && (
                            <p className="t-caption-sm text-accent-danger mt-1">Failed to create request. Please try again.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {shell.filteredPages.length === 0 && (
              <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">
                No pages match your filters
              </div>
            )}
          </div>
        )}

        {shell.viewMode === 'by-fix-type' &&
          (() => {
            const groups = buildFixTypeGroups(
              auditDetail,
              shell.severityFilter,
              shell.showInfoItems,
            );

            return (
              <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
                {groups.length === 0 && (
                  <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">
                    No issues match your filters
                  </div>
                )}
                {groups.map((group) => {
                  const sc = SEV[group.severity];
                  const key = `fix-type-${group.check}`;
                  const isExpanded = shell.expandedPages.has(key);
                  return (
                    <div key={group.check} className={`transition-all ${isExpanded ? 'bg-[var(--surface-1)]/50' : ''}`}>
                      <ClickableRow onClick={() => shell.togglePage(key)} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="t-caption font-medium text-[var(--brand-text)]">{group.label}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)]">
                            {group.pages.length} {group.pages.length === 1 ? 'page' : 'pages'} affected
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`t-caption-sm font-medium uppercase ${sc.text}`}>{group.severity}</span>
                          <Badge
                            label={String(group.pages.length)}
                            tone={group.severity === 'error' ? 'red' : group.severity === 'warning' ? 'amber' : 'blue'}
                            variant="outline"
                          />
                          <ChevronDown className={`w-3.5 h-3.5 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                        </div>
                      </ClickableRow>

                      {isExpanded && (
                        <div className="px-4 pb-3">
                          {checkImpact(group.check) && (
                            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2 leading-relaxed px-1">
                              {checkImpact(group.check)}
                            </div>
                          )}
                          <div className="space-y-1.5">
                            {group.pages.map((page, i) => (
                              <div key={`${page.pageId}-${i}`} className={`px-3 py-2 rounded-[var(--radius-lg)] ${sc.bg} border ${sc.border}`}>
                                <div className="t-caption-sm font-medium text-[var(--brand-text)] truncate">{page.page}</div>
                                <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{toLiveUrl(page.url, liveDomain)}</div>
                                {page.recommendation && (
                                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                                    {page.recommendation}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
      </SectionCard>
    </div>
  );
}

interface HistoryProps {
  auditDetail: AuditDetail;
  shell: Pick<HealthTabShell, 'expandedSections' | 'toggleSection' | 'categoryStats'>;
}

export function HealthHistorySection({ auditDetail, shell }: HistoryProps) {
  return (
    <SectionCard noPadding>
      <ClickableRow onClick={() => shell.toggleSection('history')} className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon as={BarChart3} size="md" className="text-[var(--brand-text-muted)]" />
          <span className="t-ui font-medium text-[var(--brand-text-bright)]">History &amp; Details</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${shell.expandedSections.has('history') ? '' : '-rotate-90'}`} />
      </ClickableRow>
      {shell.expandedSections.has('history') && (
        <div className="px-4 pb-4 border-t border-[var(--brand-border)] space-y-4">
          {auditDetail.scoreHistory.length >= 2 && (
            <div className="pt-4">
              <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-2">Score History</div>
              <ScoreHistoryChart history={auditDetail.scoreHistory} />
            </div>
          )}
          <div>
            <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-2">Issues by Category</div>
            <div className="space-y-2">
              {Object.entries(shell.categoryStats).map(([category, counts]) => {
                const info = CAT_LABELS[category] || {
                  label: category,
                  color: themeColor('#71717a', '#94a3b8'),
                };
                return (
                  <div key={category} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-[var(--radius-pill)] flex-shrink-0" style={{ backgroundColor: info.color }} />
                    <span className="t-caption-sm text-[var(--brand-text-muted)] flex-1">{info.label}</span>
                    <div className="flex items-center gap-1.5 t-caption-sm">
                      {counts.errors > 0 && <span className="text-accent-danger">{counts.errors}E</span>}
                      {counts.warnings > 0 && <span className="text-accent-warning">{counts.warnings}W</span>}
                      {counts.infos > 0 && <span className="text-accent-info">{counts.infos}I</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
