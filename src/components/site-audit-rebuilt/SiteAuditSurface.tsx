// @ds-rebuilt
import { Suspense, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { resolvePagePath } from '../../lib/pathUtils';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { adminPath } from '../../routes';
import {
  useSiteAuditRebuilt,
  type AuditIssueGroup,
  type SiteAuditPage,
  type SiteAuditResult,
  type SiteAuditSortMode,
} from '../../hooks/admin/useSiteAuditRebuilt';
import {
  type AuditDisplayCategory,
} from '../../../shared/types/seo-audit.js';
import type { CwvStrategyResult, DeadLinkItem, SeoAuditResult, Severity } from '../audit/types';
import { SeoAuditGuide } from '../audit/SeoAuditGuide';
import { ActionItemsPanel } from '../audit/ActionItemsPanel';
import { BulkAcceptPanel } from '../audit/BulkAcceptPanel';
import { ReportModal, ReportViewer } from '../audit/AuditReportExport';
import { ErrorBoundary } from '../ErrorBoundary';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  CharacterCounter,
  ClickableRow,
  ConfirmDialog,
  DataTable,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  FilterChip,
  FormTextarea,
  Icon,
  LensSwitcher,
  Meter,
  MetricRing,
  MetricTile,
  PageHeader,
  SearchField,
  SectionCard,
  Segmented,
  Skeleton,
  Toggle,
  Toolbar,
  ToolbarSpacer,
  scoreColor,
  cn,
  type IconName,
} from '../ui';
import { CompactAuditHistory } from './CompactAuditHistory';
import { ScheduleDrawer } from './ScheduleDrawer';
import { dateTimeOrDash, formatCompactNumber, formatInteger, formatScore } from './siteAuditFormatters';
import { mutationErrorMessage } from './siteAuditMutationFeedback';
import {
  SITE_AUDIT_VISIBLE_SUBS,
  type SiteAuditEvidenceSub,
  type SiteAuditVisibleSub,
  useSiteAuditSurfaceState,
} from './useSiteAuditSurfaceState';

const AeoReview = lazyWithRetry(() => import('../AeoReview').then((module) => ({ default: module.default })));
const ContentDecay = lazyWithRetry(() => import('../ContentDecay').then((module) => ({ default: module.default })));

interface SiteAuditSurfaceProps {
  workspaceId: string;
}

interface IssueTableRow {
  id: string;
  issue: string;
  category: string;
  severity: string;
  pages: number;
  clicks: number;
  sessions: number;
  group: AuditIssueGroup;
}

const SEVERITY_TONE: Record<Severity, 'red' | 'amber' | 'blue'> = {
  error: 'red',
  warning: 'amber',
  info: 'blue',
};

const CATEGORY_ACCENT: Record<AuditDisplayCategory, string> = {
  index: 'var(--blue)',
  onpage: 'var(--blue)',
  schema: 'var(--emerald)',
  links: 'var(--blue)',
  perf: 'var(--amber)',
  mobile: 'var(--blue)',
};

const SURFACE_WRAP_CLASS = 'mx-auto flex min-h-full w-full max-w-[1120px] flex-col gap-[14px] px-4 pb-20 sm:px-[30px]';

const PROTOTYPE_CATEGORY_ORDER: AuditDisplayCategory[] = [
  'index',
  'onpage',
  'perf',
  'schema',
  'links',
  'mobile',
];

const CATEGORY_ICON: Record<AuditDisplayCategory, IconName> = {
  index: 'search',
  onpage: 'file',
  perf: 'gauge',
  schema: 'layers',
  links: 'link',
  mobile: 'sitemap',
};

const CATEGORY_LABEL: Record<AuditDisplayCategory, string> = {
  index: 'Indexability',
  onpage: 'On-page',
  perf: 'Performance',
  schema: 'Structured data',
  links: 'Links',
  mobile: 'Mobile',
};

function SurfaceIcon({ className }: { className?: string }) {
  return <Icon name="gauge" className={className} />;
}

function issueRows(groups: AuditIssueGroup[]): IssueTableRow[] {
  return groups.map((group) => ({
    id: group.id,
    issue: group.message,
    category: group.categoryLabel,
    severity: group.severity,
    pages: group.affectedPages,
    clicks: group.traffic.clicks,
    sessions: group.traffic.sessions,
    group,
  }));
}

function cwvBadge(assessment: CwvStrategyResult['assessment']): { label: string; tone: 'emerald' | 'amber' | 'red' | 'zinc' } {
  if (assessment === 'good') return { label: 'Passed', tone: 'emerald' };
  if (assessment === 'needs-improvement') return { label: 'Needs work', tone: 'amber' };
  if (assessment === 'poor') return { label: 'Failed', tone: 'red' };
  return { label: 'No data', tone: 'zinc' };
}

function metricValue(metric: CwvStrategyResult['metrics']['LCP'], key: 'LCP' | 'INP' | 'CLS'): string {
  if (metric.value === null) return '—';
  if (key === 'LCP') return `${(metric.value / 1000).toFixed(1)}s`;
  if (key === 'INP') return `${Math.round(metric.value)}ms`;
  return metric.value.toFixed(2);
}

function CwvStrip({ data }: { data: SiteAuditResult }) {
  const strategies: Array<{ label: 'Mobile' | 'Desktop'; strategy: CwvStrategyResult }> = [];
  if (data.cwvSummary?.mobile) strategies.push({ label: 'Mobile', strategy: data.cwvSummary.mobile });
  if (data.cwvSummary?.desktop) strategies.push({ label: 'Desktop', strategy: data.cwvSummary.desktop });
  if (strategies.length === 0) {
    return (
      <div data-testid="site-audit-cwv">
        <SectionCard noPadding variant="subtle">
          <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
            <Icon name="gauge" size="md" className="text-[var(--blue)]" />
            <div className="min-w-0 flex-1">
              <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Core Web Vitals</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">This saved audit does not include field or lab performance data.</div>
            </div>
            <Badge label="No data" tone="zinc" variant="outline" />
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div data-testid="site-audit-cwv">
      <SectionCard noPadding variant="subtle">
        <div
          className={cn(
            'grid grid-cols-1 md:divide-x md:divide-[var(--brand-border)]',
            strategies.length === 1
              ? 'md:grid-cols-[minmax(150px,0.48fr)_minmax(0,1fr)]'
              : 'md:grid-cols-[minmax(150px,0.48fr)_repeat(2,minmax(0,1fr))]',
          )}
        >
          <div className="flex flex-col justify-center border-b border-[var(--brand-border)] px-[18px] py-4 md:border-b-0">
            <div className="flex items-center gap-2">
              <Icon name="gauge" size="sm" className="text-[var(--blue)]" />
              <span className="t-ui font-semibold text-[var(--brand-text-bright)]">Core Web Vitals</span>
            </div>
            <span className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">Real-user field data with lab fallback</span>
          </div>
        {strategies.map(({ label, strategy }) => {
          const badge = cwvBadge(strategy.assessment);
          return (
            <div key={label} className="border-b border-[var(--brand-border)] px-[18px] py-3.5 last:border-b-0 md:border-b-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{label}</span>
                <Badge label={badge.label} tone={badge.tone} variant="soft" />
              </div>
              <div className="grid grid-cols-3 divide-x divide-[var(--brand-border)]">
                {(['LCP', 'INP', 'CLS'] as const).map((key) => (
                  <div key={key} className="px-2 first:pl-0 last:pr-0">
                    <div className="t-mono text-[var(--brand-text-dim)]">{key}</div>
                    {/* stat-primitive-ok: compact CWV metric micro-grid (LCP/INP/CLS across 3 cols with a trailing Meter), not a labeled StatCard/CompactStatBar metric grid */}
                    <div className="t-stat-sm text-[var(--brand-text-bright)]">{metricValue(strategy.metrics[key], key)}</div>
                  </div>
                ))}
              </div>
              <Meter
                className="mt-2"
                label={strategy.fieldDataAvailable ? 'Field data' : 'Lab simulation'}
                value={strategy.lighthouseScore}
                color={scoreColor(strategy.lighthouseScore)}
              />
            </div>
          );
        })}
        </div>
      </SectionCard>
    </div>
  );
}

function DeadLinksPanel({
  links,
  onOpenLinks,
}: {
  links: DeadLinkItem[];
  onOpenLinks: () => void;
}) {
  if (links.length === 0) return null;
  const internal = links.filter((link) => link.type === 'internal').length;
  const external = links.length - internal;

  return (
    <div data-testid="site-audit-broken-links">
      <SectionCard
        title="Broken Links"
        subtitle={`${links.length} dead ${links.length === 1 ? 'link' : 'links'} found during the crawl`}
        titleIcon={<Icon name="link" size="sm" className="text-[var(--red)]" />}
        iconChip
        action={(
          <div className="flex items-center gap-2">
            <Badge label={`${internal} internal`} tone="red" variant="soft" />
            <Badge label={`${external} external`} tone="amber" variant="soft" />
            <Button size="sm" variant="secondary" onClick={onOpenLinks}>
              Manage in Links
              <Icon name="arrowRight" size="sm" />
            </Button>
          </div>
        )}
        noPadding
        variant="subtle"
      >
        {links.map((link, index) => (
          <ClickableRow
            key={`${link.url}-${index}`}
            onClick={onOpenLinks}
            className="grid w-full items-center gap-3 border-t border-[var(--brand-border)] px-[18px] py-2.5 text-left first:border-t-0 hover:bg-[var(--surface-3)] sm:grid-cols-[72px_minmax(0,1.2fr)_minmax(0,1fr)_auto]"
          >
            <Badge label={String(link.status)} tone={link.type === 'internal' ? 'red' : 'amber'} variant="soft" />
            <span className="t-mono truncate text-[var(--brand-text-bright)]">{link.url}</span>
            <span className="t-caption-sm truncate text-[var(--brand-text-muted)]">
              on <strong className="font-semibold text-[var(--brand-text-bright)]">{link.foundOn || link.foundOnSlug}</strong>
              {link.anchorText ? ` · “${link.anchorText}”` : ''}
            </span>
            <Icon name="arrowRight" size="sm" className="text-[var(--blue)]" />
          </ClickableRow>
        ))}
      </SectionCard>
    </div>
  );
}

function CategoryCards({
  data,
  activeCategories,
  onToggleCategory,
}: {
  data: ReturnType<typeof useSiteAuditRebuilt>['categoryScores'];
  activeCategories: ReadonlySet<string>;
  onToggleCategory: (category: AuditDisplayCategory) => void;
}) {
  const scoreByCategory = new Map(data.map((score) => [score.category, score]));

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="site-audit-categories">
      {PROTOTYPE_CATEGORY_ORDER.map((category) => scoreByCategory.get(category)).filter((score) => !!score).map((score) => {
        const active = activeCategories.has(score.category);
        const issueCount = score.errors + score.warnings + score.infos;
        const accent = scoreColor(score.score);
        const label = CATEGORY_LABEL[score.category];
        return (
          <SectionCard
            key={score.category}
            noPadding
            variant="subtle"
            className={cn(active && 'ring-1 ring-[var(--teal)]')}
          >
            <ClickableRow
              active={active}
              onClick={() => onToggleCategory(score.category)}
              aria-label={`Filter issues by ${label}`}
              className="px-4 py-[14px]"
            >
              <div>
                <div className="mb-3 flex items-center gap-2.5">
                  <span
                    className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)]"
                    style={{ color: accent, background: `color-mix(in srgb, ${accent} 12%, transparent)` }}
                  >
                    <Icon name={CATEGORY_ICON[score.category]} size="sm" />
                  </span>
                  <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{label}</span>
                  {/* stat-primitive-ok: compact score is the trailing value within a category filter card, not a standalone KPI */}
                  <span className="ml-auto t-stat-sm" style={{ color: accent }}>{formatScore(score.score)}</span>
                </div>
                <Meter value={score.score} color={accent} ariaLabel={`${label} score`} height={5} />
                <div className="mt-2.5 flex items-center justify-between gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                  <span className={cn(issueCount === 0 && 'text-[var(--emerald)]')}>
                    {issueCount === 0 ? 'Clean' : `${issueCount} issue${issueCount === 1 ? '' : 's'}`}
                  </span>
                  <span>{score.affectedPages} affected {score.affectedPages === 1 ? 'page' : 'pages'}</span>
                </div>
              </div>
            </ClickableRow>
          </SectionCard>
        );
      })}
    </div>
  );
}

function scoreVerdict(score: number): string {
  if (score >= 90) return 'in excellent shape';
  if (score >= 75) return 'in solid shape, with a few fixes';
  return 'not there yet';
}

function AuditHero({ data, siteName }: { data: SiteAuditResult; siteName: string }) {
  const indexedPages = data.pages.filter((page) => !page.noindex).length;
  const warningCount = `${data.warnings} ${data.warnings === 1 ? 'warning' : 'warnings'}`;
  const noticeCount = `${data.infos} ${data.infos === 1 ? 'notice' : 'notices'}`;
  const redirects = data.deadLinkSummary?.redirects;

  return (
    <div data-testid="site-audit-hero">
      <SectionCard noPadding>
        <div className="grid items-center gap-[26px] px-5 py-[22px] sm:grid-cols-[132px_minmax(0,1fr)] sm:px-[26px]">
          <div className="relative mx-auto h-[132px] w-[132px]">
            <MetricRing score={data.siteScore} size={132} strokeWidth={10} noAnimation />
            <span className="absolute inset-x-0 top-[91px] text-center t-micro uppercase tracking-[0.08em] text-[var(--brand-text-dim)]">
              Health
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="t-h2 text-[var(--brand-text-bright)]">
              {siteName} is {scoreVerdict(data.siteScore)}.
            </h1>
            <p className="mt-2 max-w-[68ch] t-ui text-[var(--brand-text-muted)]">
              {data.errors > 0
                ? `${data.errors} critical ${data.errors === 1 ? 'issue needs' : 'issues need'} attention first. ${warningCount} and ${noticeCount} are ordered below by severity and demand.`
                : `No critical issues. ${warningCount} and ${noticeCount} remain, and the site is in good technical shape.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge label={`${data.errors} critical`} tone={data.errors > 0 ? 'red' : 'emerald'} variant="outline" size="md" />
              <Badge label={`${data.warnings} warnings`} tone="amber" variant="outline" size="md" />
              <Badge label={`${formatInteger(indexedPages)} indexable`} tone="emerald" variant="outline" size="md" />
              {redirects != null && (
                <Badge label={`${formatInteger(redirects)} redirects`} tone={redirects > 10 ? 'amber' : 'emerald'} variant="outline" size="md" />
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function IssueDetailDrawer({
  group,
  open,
  onClose,
  audit,
  flagSending,
  applyingFix,
  createdTasks,
  flaggedIssues,
  onQuickFix,
  onCreateTask,
  onAcceptSuggestion,
  onFlagForClient,
  onSuppressIssue,
  onSuppressPattern,
}: {
  group: AuditIssueGroup | null;
  open: boolean;
  onClose: () => void;
  audit: ReturnType<typeof useSiteAuditRebuilt>;
  flagSending: boolean;
  applyingFix: string | null;
  createdTasks: ReadonlySet<string>;
  flaggedIssues: ReadonlySet<string>;
  onQuickFix: (page: SiteAuditPage, issue: AuditIssueGroup['instances'][number]['issue']) => void;
  onCreateTask: (page: SiteAuditPage, issue: AuditIssueGroup['instances'][number]['issue']) => Promise<void>;
  onAcceptSuggestion: (page: SiteAuditPage, issue: AuditIssueGroup['instances'][number]['issue']) => Promise<void>;
  onFlagForClient: (page: SiteAuditPage, issue: AuditIssueGroup['instances'][number]['issue'], note: string) => Promise<void>;
  onSuppressIssue: (check: string, slug: string) => Promise<void>;
  onSuppressPattern: (check: string, slug: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const firstPageInstance = group?.instances.find((instance) => instance.page) ?? null;
  const firstPage = firstPageInstance?.page ?? null;
  const firstIssue = firstPageInstance?.issue ?? null;
  const firstPagePath = firstPage ? resolvePagePath(firstPage) : null;
  const taskKey = firstPage && firstIssue ? `${firstPage.pageId}-${firstIssue.check}-${firstIssue.message.slice(0, 30)}` : '';
  const fixKey = firstPage && firstIssue ? `${firstPage.pageId}-${firstIssue.check}` : '';
  const editedSuggestion = firstIssue?.suggestedFix
    ? audit.editedSuggestions[fixKey] ?? firstIssue.suggestedFix
    : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={group?.check ?? 'Audit issue'}
      eyebrow={group?.categoryLabel}
      subtitle={group?.message}
      width={520}
      footer={firstPage && firstIssue ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => onQuickFix(firstPage, firstIssue)}>
            <Icon name="arrowRight" size="sm" />
            Open fix
          </Button>
          <Button
            size="sm"
            onClick={() => onCreateTask(firstPage, firstIssue)}
            disabled={createdTasks.has(taskKey)}
          >
            <Icon name={createdTasks.has(taskKey) ? 'check' : 'plus'} size="sm" />
            {createdTasks.has(taskKey) ? 'Task added' : 'Add task'}
          </Button>
        </>
      ) : undefined}
    >
      {group && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={group.severity} tone={SEVERITY_TONE[group.severity]} variant="soft" />
            <Badge label={group.categoryLabel} tone="teal" variant="outline" />
            <Badge label={`${group.affectedPages} pages`} tone="blue" variant="soft" />
            <Badge label={`${formatCompactNumber(group.traffic.clicks)} clicks`} tone="blue" variant="soft" />
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
            <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Recommendation</div>
            <p className="t-body text-[var(--brand-text-muted)] mt-1">{group.recommendation}</p>
            {firstPage && firstIssue?.suggestedFix && (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--brand-mint-dim)] bg-[var(--brand-mint-dim)] p-3">
                <div className="t-micro text-[var(--teal)]">AI suggestion</div>
                <FormTextarea
                  value={editedSuggestion}
                  onChange={(value) => {
                    audit.setEditedSuggestions((current) => ({
                      ...current,
                      [fixKey]: value,
                    }));
                  }}
                  rows={3}
                  className="mt-2"
                />
                <CharacterCounter current={editedSuggestion.length} max={320} className="mt-1 justify-end" />
              </div>
            )}
          </div>

          {firstPage && firstIssue && (
            <div className="space-y-3" data-testid="site-audit-issue-actions">
              <div className="t-caption text-[var(--brand-text-muted)]">
                Applies to {firstPagePath} only
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Send to client</div>
                {flaggedIssues.has(taskKey) && <Badge label="Sent" tone="emerald" variant="soft" />}
              </div>
              <FormTextarea
                value={note}
                onChange={setNote}
                placeholder="Optional note for the client"
                rows={3}
              />
              <div className="flex flex-wrap items-center gap-2">
                {firstIssue.suggestedFix && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onAcceptSuggestion(firstPage, firstIssue)}
                    loading={applyingFix === fixKey}
                  >
                    <Icon name="check" size="sm" />
                    Accept suggestion
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onFlagForClient(firstPage, firstIssue, note)}
                  loading={flagSending}
                  disabled={flaggedIssues.has(taskKey)}
                >
                  <Icon name="send" size="sm" />
                  {flaggedIssues.has(taskKey) ? 'Sent to client' : 'Send to client'}
                </Button>
              </div>
            </div>
          )}

          <div>
            <div className="t-ui font-semibold text-[var(--brand-text-bright)] mb-2">Affected pages</div>
            <div className="space-y-2">
              {group.instances.slice(0, 12).map((instance) => (
                <div key={instance.id} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="t-ui text-[var(--brand-text-bright)] truncate">
                          {instance.page?.page ?? 'Site-wide issue'}
                        </span>
                        {instance.page?.noindex && <Badge label="noindex excluded" tone="zinc" variant="outline" />}
                        {instance.page && audit.pageStates.getState?.(instance.page.pageId) && (
                          <Badge
                            label={audit.pageStates.getState(instance.page.pageId)!.status.replace(/-/g, ' ')}
                            tone="blue"
                            variant="soft"
                          />
                        )}
                      </div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                        {instance.page?.slug ?? instance.issue.value ?? instance.issue.check}
                      </div>
                    </div>
                    {instance.page && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onSuppressIssue(instance.issue.check, instance.page!.slug)}>
                          Hide
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onSuppressPattern(instance.issue.check, instance.page!.slug)}>
                          Hide pattern
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {group.instances.length > 12 && (
                <div className="t-caption text-[var(--brand-text-muted)]">
                  {group.instances.length - 12} more affected pages are not shown above.
                </div>
              )}
              <div className="t-caption text-[var(--brand-text-muted)]">
                Add visible tasks uses the current table filters. Add error tasks, Add all tasks, and Accept all use the full audit.
              </div>
            </div>
          </div>

          {audit.pageStates.summary.total > 0 && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
              <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Edit-state summary</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <MetricTile label="In review" value={audit.pageStates.summary.inReview} />
                <MetricTile label="Approved" value={audit.pageStates.summary.approved} />
                <MetricTile label="Live" value={audit.pageStates.summary.live} />
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function AuditEvidence({
  workspaceId,
  activeEvidence,
}: {
  workspaceId: string;
  activeEvidence: SiteAuditEvidenceSub | null;
}) {
  const navigate = useNavigate();

  const openAssetFilter = (filter: 'oversized' | 'missing-alt') => {
    navigate(`${adminPath(workspaceId, 'media')}?filter=${filter}`);
  };

  return (
    <div data-testid="site-audit-support">
      <Disclosure
        summary="Evidence & repair support"
        badges={[
          { label: '3 diagnostics', tone: 'blue' },
          { label: 'Asset handoff', tone: 'teal' },
        ]}
        defaultOpen={activeEvidence !== null}
      >
        <div key={activeEvidence ?? 'audit'} className="space-y-2 pt-1">
          <Disclosure
            summary="AI Search Ready"
            badges={[{ label: 'Search evidence', tone: 'blue' }]}
            defaultOpen={activeEvidence === 'aeo-review'}
          >
            <p className="mb-3 t-body text-[var(--brand-text-muted)]">
              Review how the site presents its expertise and entities to AI search systems.
            </p>
            <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
              <AeoReview workspaceId={workspaceId} />
            </Suspense>
          </Disclosure>

          <Disclosure
            summary="Content Health"
            badges={[{ label: 'Content evidence', tone: 'blue' }]}
            defaultOpen={activeEvidence === 'content-decay'}
          >
            <p className="mb-3 t-body text-[var(--brand-text-muted)]">
              Review pages whose freshness or performance needs attention alongside technical findings.
            </p>
            <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
              <ContentDecay workspaceId={workspaceId} />
            </Suspense>
          </Disclosure>

          <Disclosure
            summary="Audit Guide"
            badges={[{ label: 'Guidance', tone: 'teal' }]}
            defaultOpen={activeEvidence === 'guide'}
          >
            <p className="mb-3 t-body text-[var(--brand-text-muted)]">
              Use the audit guide to interpret findings and choose the next technical action.
            </p>
            <SeoAuditGuide />
          </Disclosure>

          <div className="flex flex-col gap-3 border-t border-[var(--brand-border)] px-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="t-body text-[var(--brand-text-muted)]">
              Site Audit detects site issues. Asset Manager repairs source images.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openAssetFilter('oversized')}>
                <Icon name="image" size="sm" />
                Review oversized images
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openAssetFilter('missing-alt')}>
                <Icon name="pencil" size="sm" />
                Review missing alt text
              </Button>
            </div>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

function AuditLens({
  audit,
  activeEvidence,
}: {
  audit: ReturnType<typeof useSiteAuditRebuilt>;
  activeEvidence: SiteAuditEvidenceSub | null;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SiteAuditSortMode>('severity');
  const [categoryFilters, toggleCategory, setCategoryFilters] = useToggleSet<AuditDisplayCategory>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [severityFilters, toggleSeverity, setSeverityFilters] = useToggleSet<Severity>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [selectedGroup, setSelectedGroup] = useState<AuditIssueGroup | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportView, setReportView] = useState<'html' | 'csv' | null>(null);
  const [acceptAllConfirmOpen, setAcceptAllConfirmOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [, setBulkError] = useState<string | null>(null);
  const bulkHandlersRef = useRef<{ acceptAll: () => Promise<void>; cancel: () => void } | null>(null);

  const data = audit.data;
  const filteredGroups = useMemo(
    () => audit.filterIssueGroups(audit.issueGroups, search, severityFilters, categoryFilters, sortMode),
    [audit, categoryFilters, search, severityFilters, sortMode],
  );
  const rows = useMemo(() => issueRows(filteredGroups) as unknown as Record<string, unknown>[], [filteredGroups]);
  const issueColumns = useMemo(() => [
    {
      key: 'issue',
      label: 'Issue',
      width: 'minmax(260px, 1.8fr)',
      render: (_value: unknown, row: Record<string, unknown>) => {
        const group = (row as unknown as IssueTableRow).group;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge label={group.severity} tone={SEVERITY_TONE[group.severity]} variant="soft" />
              <span className="t-ui font-semibold text-[var(--brand-text-bright)] truncate">{group.message}</span>
            </div>
            <div className="t-caption text-[var(--brand-text-muted)] truncate mt-1">{group.recommendation}</div>
          </div>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      width: '136px',
      render: (_value: unknown, row: Record<string, unknown>) => {
        const group = (row as unknown as IssueTableRow).group;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[var(--radius-pill)]" style={{ background: CATEGORY_ACCENT[group.displayCategory] }} />
            <span>{group.categoryLabel}</span>
          </span>
        );
      },
    },
    {
      key: 'pages',
      label: 'Pages',
      width: '86px',
      align: 'right' as const,
      sortable: true,
      render: (value: unknown) => formatInteger(Number(value) || 0),
    },
    {
      key: 'clicks',
      label: 'Clicks',
      width: '96px',
      align: 'right' as const,
      sortable: true,
      render: (value: unknown) => formatCompactNumber(Number(value) || 0),
    },
    {
      key: 'sessions',
      label: 'Sessions',
      width: '104px',
      align: 'right' as const,
      sortable: true,
      render: (value: unknown) => formatCompactNumber(Number(value) || 0),
    },
  ], []);

  const handleRunAudit = async () => {
    try {
      await audit.workflow.runAudit();
      toast('SEO audit started', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'SEO audit could not start'), 'error');
    }
  };

  const handleSaveAndShare = async () => {
    try {
      const url = await audit.saveAndShare();
      if (url) {
        await navigator.clipboard?.writeText(url);
        toast('Share link copied', 'success');
      }
    } catch (error) {
      toast(mutationErrorMessage(error, 'Audit report could not be saved'), 'error');
    }
  };

  const handleBatchTasks = async (mode: 'all' | 'errors' | 'filtered') => {
    try {
      const created = await audit.batchCreateTasks(mode, filteredGroups);
      toast(created > 0 ? `${created} task${created === 1 ? '' : 's'} created` : 'No new tasks to add', created > 0 ? 'success' : 'info');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Tasks could not be created'), 'error');
    }
  };

  const handleAcceptAll = async () => {
    try {
      await bulkHandlersRef.current?.acceptAll();
      toast('Bulk fix application started', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Bulk fixes could not start'), 'error');
    }
  };

  const handleConfirmAcceptAll = () => {
    setAcceptAllConfirmOpen(false);
    void handleAcceptAll();
  };

  const handleClearSuppressions = async () => {
    try {
      await audit.unsuppressAll();
      toast('Suppression rules cleared', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Suppressions could not be cleared'), 'error');
    }
  };

  const pendingFixes = data?.pages.reduce((count, page) => count + page.issues.filter((issue) => (
    !!issue.suggestedFix && !audit.appliedFixes.has(`${page.pageId}-${issue.check}`)
  )).length, 0) ?? 0;

  if (audit.workflow.loading) {
    const progress = audit.workflow.runningAuditJob?.total && audit.workflow.runningAuditJob.progress != null
      ? Math.round((audit.workflow.runningAuditJob.progress / audit.workflow.runningAuditJob.total) * 100)
      : null;
    return (
      <div className="space-y-5" data-testid="site-audit-rebuilt-audit">
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
          <Icon name="refresh" size="xl" className="text-[var(--teal)] animate-spin" />
          <div className="text-center">
            <div className="t-body font-semibold text-[var(--brand-text-bright)]">
              {audit.workflow.runningAuditJob?.message ?? 'Analyzing site health...'}
            </div>
            <p className="t-body text-[var(--brand-text-muted)] mt-1">The background job saves a snapshot when it finishes.</p>
          </div>
          {progress !== null && (
            <div className="w-full max-w-sm">
              <Meter value={progress} showValue gradient ariaLabel="Audit progress" />
            </div>
          )}
        </div>
        <AuditEvidence workspaceId={audit.workspace?.id ?? ''} activeEvidence={activeEvidence} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5" data-testid="site-audit-rebuilt-audit">
        <EmptyState
          icon={SurfaceIcon}
          title="Run a site audit"
          description="Analyze titles, metadata, indexing, schema, links, performance, and mobile readiness."
          action={(
            <div className="flex flex-col items-center gap-3">
              <Button onClick={handleRunAudit} disabled={!audit.siteId}>
                <Icon name="refresh" size="sm" />
                Run SEO Audit
              </Button>
              <Toggle
                checked={!audit.workflow.skipLinkCheck}
                onChange={(checked) => audit.workflow.setSkipLinkCheck(!checked)}
                label="Include dead-link scan"
              />
            </div>
          )}
        />
        <AuditEvidence workspaceId={audit.workspace?.id ?? ''} activeEvidence={activeEvidence} />
      </div>
    );
  }

  return (
    <div className="space-y-[14px]" data-testid="site-audit-rebuilt-audit">
      <AuditHero data={data} siteName={audit.siteName || 'Connected site'} />

      <CategoryCards
        data={audit.categoryScores}
        activeCategories={categoryFilters}
        onToggleCategory={toggleCategory}
      />

      <CwvStrip data={data} />

      <Toolbar label="Site Audit actions" className="w-full">
        <Segmented
          value={sortMode}
          onChange={(value) => setSortMode(value as SiteAuditSortMode)}
          options={[
            { value: 'severity', label: 'Severity' },
            { value: 'traffic', label: 'Traffic' },
          ]}
        />
        <ToolbarSpacer />
        <Toggle
          checked={!audit.workflow.skipLinkCheck}
          onChange={(checked) => audit.workflow.setSkipLinkCheck(!checked)}
          label="Dead-link scan"
        />
        <Button size="sm" variant="secondary" onClick={() => setScheduleOpen(true)}>
          <Icon name="clock" size="sm" />
          Schedule
        </Button>
        <Button size="sm" variant="secondary" onClick={handleSaveAndShare} loading={audit.savingReport}>
          <Icon name="send" size="sm" />
          Save &amp; share
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setReportModalOpen(true)}>
          <Icon name="download" size="sm" />
          Export
        </Button>
        <Button size="sm" variant="secondary" onClick={handleRunAudit} disabled={!audit.siteId || audit.workflow.loading}>
          <Icon name="refresh" size="sm" />
          Re-run audit
        </Button>
      </Toolbar>

      {activeEvidence !== null && (
        <AuditEvidence workspaceId={audit.workspace?.id ?? ''} activeEvidence={activeEvidence} />
      )}

      <div data-testid="site-audit-bulk-actions">
        <SectionCard noPadding variant="subtle">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-mint-dim)] text-[var(--teal)]">
              <Icon name="sparkle" size="sm" />
            </span>
            <div className="min-w-[210px] flex-1">
              <div className="t-ui font-semibold text-[var(--brand-text-bright)]">
                {pendingFixes} AI-fixable {pendingFixes === 1 ? 'suggestion' : 'suggestions'} across titles, meta &amp; page fields
              </div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">
                Apply supported edits in bulk or turn the current issue set into operator tasks.
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('errors')} loading={audit.batchCreating}>
              Add error tasks
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('filtered')} loading={audit.batchCreating}>
              Add visible tasks
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('all')} loading={audit.batchCreating}>
              Add all tasks
            </Button>
            <Button size="sm" onClick={() => setAcceptAllConfirmOpen(true)} disabled={bulkApplying || pendingFixes === 0}>
              <Icon name="sparkle" size="sm" />
              {bulkApplying
                ? (bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : 'Starting…')
                : `Accept all ${pendingFixes}`}
            </Button>
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={acceptAllConfirmOpen}
        title="Apply AI fixes to the live Webflow site?"
        message={`This immediately applies up to ${pendingFixes} AI-suggested ${pendingFixes === 1 ? 'fix' : 'fixes'} — titles, meta descriptions, and page fields — directly to the live Webflow site and marks those pages live. Unrecognized checks are skipped, so fewer than ${pendingFixes} may change. These changes cannot be bulk-undone.`}
        confirmLabel="Apply to live site"
        onConfirm={handleConfirmAcceptAll}
        onCancel={() => setAcceptAllConfirmOpen(false)}
        variant="destructive"
      />

      <BulkAcceptPanel
        workspaceId={audit.workspace?.id ?? ''}
        siteId={audit.siteId}
        data={data as SeoAuditResult}
        appliedFixes={audit.appliedFixes}
        setAppliedFixes={audit.setAppliedFixes}
        editedSuggestions={audit.editedSuggestions}
        onBulkApplyingChange={setBulkApplying}
        onBulkProgressChange={setBulkProgress}
        onBulkError={setBulkError}
        onRegisterHandlers={(handlers) => { bulkHandlersRef.current = handlers; }}
      />

      {data.deadLinkDetails && data.deadLinkDetails.length > 0 && (
        <DeadLinksPanel links={data.deadLinkDetails} onOpenLinks={audit.openDeadLinks} />
      )}

      <div data-testid="site-audit-issues">
        <SectionCard
          title="Issues to fix"
          subtitle="Open an issue to review affected pages, route the repair, or send it to the client"
          titleIcon={<Icon name="gauge" size="sm" className="text-[var(--amber)]" />}
          iconChip
          action={(
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              Showing {filteredGroups.length} of {audit.issueGroups.length} groups
            </span>
          )}
          noPadding
          variant="subtle"
        >
          <Toolbar
            label="Audit issue filters"
            className="border-b border-[var(--brand-border)] px-4 py-3"
          >
            <SearchField value={search} onChange={setSearch} placeholder="Search issues, pages, or recommendations" />
            {(['error', 'warning', 'info'] as const).map((severity) => (
              <FilterChip
                key={severity}
                label={severity}
                active={severityFilters.has(severity)}
                count={audit.issueGroups.filter((group) => group.severity === severity).length}
                onClick={() => toggleSeverity(severity)}
              />
            ))}
            <ToolbarSpacer />
            <Button size="sm" variant="ghost" onClick={() => { setCategoryFilters(new Set()); setSeverityFilters(new Set()); }}>
              Clear filters
            </Button>
          </Toolbar>

          <DataTable
            id="site-audit-issue-table"
            columns={issueColumns}
            rows={rows}
            getRowKey={(row) => (row as unknown as IssueTableRow).id}
            onRowClick={(row) => setSelectedGroup((row as unknown as IssueTableRow).group)}
            className="rounded-none border-x-0 border-b-0"
            empty={(
              <EmptyState
                icon={SurfaceIcon}
                title="No issues match the current filters"
                description="Clear filters or re-run the audit to refresh the issue set."
              />
            )}
          />
        </SectionCard>
      </div>

      {audit.suppressions.length > 0 && (
        <SectionCard noPadding variant="subtle">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <Icon name="eyeOff" size="sm" className="text-[var(--brand-text-dim)]" />
            <Badge label={`${audit.suppressions.length} suppressed`} tone="zinc" variant="outline" />
            <span className="t-ui text-[var(--brand-text-muted)]">Hidden findings are excluded from effective scores.</span>
            <Button size="sm" variant="ghost" onClick={handleClearSuppressions} className="ml-auto">
              Clear all
            </Button>
          </div>
        </SectionCard>
      )}

      {activeEvidence === null && (
        <AuditEvidence workspaceId={audit.workspace?.id ?? ''} activeEvidence={activeEvidence} />
      )}

      <SectionCard noPadding variant="subtle">
        <div className="flex items-start gap-3 px-4 py-3">
          <Icon name="trophy" size="md" className="mt-0.5 text-[var(--emerald)]" />
          <div>
            <div className="t-ui font-semibold text-[var(--brand-text-bright)]">From fix to proof</div>
            <p className="mt-1 t-body text-[var(--brand-text-muted)]">
              Technical fixes stay in Site Audit and Cockpit until traffic, crawlability, or Core Web Vitals recovery is measurable.
            </p>
          </div>
        </div>
      </SectionCard>

      {(data as SiteAuditResult & { snapshotId?: string }).snapshotId && (
        <ActionItemsPanel snapshotId={(data as SiteAuditResult & { snapshotId: string }).snapshotId} />
      )}

      <IssueDetailDrawer
        group={selectedGroup}
        open={!!selectedGroup}
        onClose={() => setSelectedGroup(null)}
        audit={audit}
        flagSending={audit.flagSending}
        applyingFix={audit.applyingFix}
        createdTasks={audit.createdTasks}
        flaggedIssues={audit.flaggedIssues}
        onQuickFix={audit.openQuickFix}
        onCreateTask={async (page, issue) => {
          try {
            await audit.createTaskFromIssue(page, issue);
            toast('Task added', 'success');
          } catch (error) {
            toast(mutationErrorMessage(error, 'Task could not be added'), 'error');
          }
        }}
        onAcceptSuggestion={async (page, issue) => {
          try {
            const applied = await audit.acceptSuggestion(page, issue);
            toast(applied ? 'Suggestion applied' : 'Suggestion was not applied', applied ? 'success' : 'info');
          } catch (error) {
            toast(mutationErrorMessage(error, 'Suggestion could not be applied'), 'error');
          }
        }}
        onFlagForClient={async (page, issue, note) => {
          try {
            await audit.flagForClient(page, issue, note);
            toast('Sent to client', 'success');
          } catch (error) {
            toast(mutationErrorMessage(error, 'Issue could not be sent to client'), 'error');
          }
        }}
        onSuppressIssue={async (check, slug) => {
          try {
            await audit.suppressIssue(check, slug);
            toast('Issue hidden from effective score', 'success');
          } catch (error) {
            toast(mutationErrorMessage(error, 'Issue could not be hidden'), 'error');
          }
        }}
        onSuppressPattern={async (check, slug) => {
          try {
            await audit.suppressPattern(check, slug);
            toast('Pattern hidden from effective score', 'success');
          } catch (error) {
            toast(mutationErrorMessage(error, 'Pattern could not be hidden'), 'error');
          }
        }}
      />

      <ScheduleDrawer
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        schedule={audit.schedule.data}
        saving={audit.scheduleSaving}
        onSave={audit.saveSchedule}
        onSaved={(enabled) => toast(enabled ? 'Scheduled audits enabled' : 'Scheduled audits disabled', 'success')}
        onError={(error) => toast(mutationErrorMessage(error, 'Schedule could not be saved'), 'error')}
      />

      {reportModalOpen && (
        <ReportModal
          onExportHtml={() => { setReportModalOpen(false); setReportView('html'); }}
          onExportCsv={() => { setReportModalOpen(false); setReportView('csv'); }}
          onClose={() => setReportModalOpen(false)}
        />
      )}
      {reportView && (
        <ReportViewer
          reportView={reportView}
          data={data as SeoAuditResult}
          onClose={() => setReportView(null)}
        />
      )}
    </div>
  );
}

function LensBody({
  visibleSub,
  evidenceSub,
  audit,
}: {
  visibleSub: SiteAuditVisibleSub;
  evidenceSub: SiteAuditEvidenceSub | null;
  audit: ReturnType<typeof useSiteAuditRebuilt>;
}) {
  if (visibleSub === 'history') {
    return (
      <CompactAuditHistory
        siteId={audit.siteId}
        history={audit.workflow.history}
        onRefresh={audit.workflow.refreshAuditHistory}
      />
    );
  }
  return <AuditLens audit={audit} activeEvidence={evidenceSub} />;
}

export function SiteAuditSurface({ workspaceId }: SiteAuditSurfaceProps) {
  const state = useSiteAuditSurfaceState();
  const audit = useSiteAuditRebuilt(workspaceId);

  const lensOptions = useMemo(() => SITE_AUDIT_VISIBLE_SUBS.map((sub) => ({
    value: sub.id,
    label: sub.label,
    count: sub.id === 'audit'
      ? audit.issueGroups.length
      : sub.id === 'history'
        ? audit.workflow.history.length
        : undefined,
  })), [audit.issueGroups.length, audit.workflow.history.length]);
  const latestSnapshot = audit.workflow.history[0];
  const lastCrawl = latestSnapshot ? dateTimeOrDash(latestSnapshot.createdAt) : 'Not run yet';
  const crawledPages = audit.data?.totalPages ?? latestSnapshot?.totalPages;

  if (audit.workspaces.isLoading && !audit.workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS} aria-label="Loading Site Audit">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (audit.workspaces.isError && !audit.workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS}>
        <PageHeader title="Site Audit" subtitle="Technical health, content quality, and search readiness." />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before reviewing Site Audit."
          action={{ label: 'Retry workspace', onClick: () => audit.workspaces.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!audit.workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS}>
        <PageHeader title="Site Audit" subtitle="Technical health, content quality, and search readiness." />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before reviewing Site Audit." className="min-h-[420px]" />
      </div>
    );
  }

  if (!audit.siteId) {
    return (
      <div className={SURFACE_WRAP_CLASS} data-testid="site-audit-rebuilt-surface">
        <PageHeader title="Site Audit" subtitle="Technical health, content quality, and search readiness." icon={<Icon name="gauge" size="lg" className="text-[var(--teal)]" />} />
        <EmptyState
          icon={SurfaceIcon}
          title="Connect a Webflow site first"
          description="Site Audit reads the workspace Webflow site before it can scan technical health and content readiness."
        />
      </div>
    );
  }

  return (
    <ErrorBoundary label="Site Audit">
      <div className={SURFACE_WRAP_CLASS} data-testid="site-audit-rebuilt-surface">
        <div
          className="flex min-h-7 flex-wrap items-center gap-2 t-mono uppercase tracking-[0.08em] text-[var(--amber)]"
          data-testid="site-audit-context"
        >
          <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-[var(--amber)]" aria-hidden="true" />
          <span>Site audit · {audit.siteName || audit.workspace.name}</span>
          <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal text-[var(--brand-text-muted)]">
            <Icon name="clock" size="sm" />
            Last crawl {lastCrawl}{crawledPages != null ? ` · ${formatInteger(crawledPages)} URLs` : ''}
          </span>
        </div>

        <div data-testid="site-audit-lenses">
          <Toolbar label="Site Audit lenses">
            <LensSwitcher
              id="site-audit-sub-switcher"
              options={lensOptions}
              value={state.visibleSub}
              onChange={(value) => state.setSub(value as SiteAuditVisibleSub)}
              size="sm"
              mono
            />
          </Toolbar>
        </div>

        {audit.workflow.auditError && (
          <ErrorState
            type="data"
            title="SEO audit failed"
            message={audit.workflow.auditError}
            action={{ label: 'Try again', onClick: audit.workflow.runAudit }}
          />
        )}

        <LensBody visibleSub={state.visibleSub} evidenceSub={state.evidenceSub} audit={audit} />
      </div>
    </ErrorBoundary>
  );
}

export default SiteAuditSurface;
