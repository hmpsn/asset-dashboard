// @ds-rebuilt
import { Suspense, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
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
  AUDIT_DISPLAY_CATEGORIES,
  AUDIT_DISPLAY_CATEGORY_LABELS,
  type AuditDisplayCategory,
} from '../../../shared/types/seo-audit.js';
import type { CwvStrategyResult, DeadLinkItem, SeoAuditResult, Severity } from '../audit/types';
import { AuditHistory } from '../audit/AuditHistory';
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
  DataTable,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  FilterChip,
  FormTextarea,
  GroupBlock,
  Icon,
  LensSwitcher,
  Meter,
  MetricRing,
  MetricTile,
  PageHeader,
  SearchField,
  Segmented,
  Skeleton,
  Toggle,
  Toolbar,
  ToolbarSpacer,
  scoreColor,
  scoreColorClass,
  cn,
} from '../ui';
import { ScheduleDrawer } from './ScheduleDrawer';
import { formatCompactNumber, formatInteger, formatScore } from './siteAuditFormatters';
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
  const strategies = [
    ['Mobile', data.cwvSummary?.mobile],
    ['Desktop', data.cwvSummary?.desktop],
  ] as const;
  if (!data.cwvSummary?.mobile && !data.cwvSummary?.desktop) return null;

  return (
    <GroupBlock title="Core Web Vitals" meta="Field-data strip with lab score fallback">
      <div className="grid gap-3 md:grid-cols-2">
        {strategies.map(([label, strategy]) => {
          if (!strategy) return null;
          const badge = cwvBadge(strategy.assessment);
          return (
            <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{label}</span>
                <Badge label={badge.label} tone={badge.tone} variant="soft" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['LCP', 'INP', 'CLS'] as const).map((key) => (
                  <div key={key} className="rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2">
                    <div className="t-caption-sm text-[var(--brand-text-muted)]">{key}</div>
                    {/* stat-primitive-ok: compact CWV metric micro-grid (LCP/INP/CLS across 3 cols with a trailing Meter), not a labeled StatCard/CompactStatBar metric grid */}
                    <div className="t-stat-sm text-[var(--brand-text-bright)]">{metricValue(strategy.metrics[key], key)}</div>
                  </div>
                ))}
              </div>
              <Meter
                className="mt-3"
                label={strategy.fieldDataAvailable ? 'Real-user field data' : 'Lab simulation only'}
                value={strategy.lighthouseScore}
                showValue
                gradient
              />
            </div>
          );
        })}
      </div>
    </GroupBlock>
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
  const rows = links.map((link, index) => ({
    id: `${link.url}-${index}`,
    url: link.url,
    status: String(link.status),
    type: link.type,
    foundOn: link.foundOn || link.foundOnSlug,
    anchorText: link.anchorText || '—',
  })) as unknown as Record<string, unknown>[];

  return (
    <GroupBlock
      title="Broken Links"
      meta="Status, source page, and anchor text"
      stats={[{ label: 'found', value: links.length, color: 'var(--red)' }]}
      flag={{ label: 'Links owns fixes', color: 'var(--teal)', bg: 'var(--brand-mint-dim)', border: 'var(--brand-mint-dim)' }}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-2 pt-1">
          <p className="t-body text-[var(--brand-text-muted)]">
            Redirect creation and dead-link CSV export live in the Links workshop.
          </p>
          <Button size="sm" variant="secondary" onClick={onOpenLinks}>
            <Icon name="external" size="sm" />
            Open Links
          </Button>
        </div>
        <DataTable
          columns={[
            { key: 'status', label: 'Status', width: '84px' },
            {
              key: 'url',
              label: 'Broken URL',
              width: 'minmax(240px, 1.4fr)',
              render: (value) => <span className="truncate font-mono">{String(value)}</span>,
            },
            { key: 'type', label: 'Type', width: '90px' },
            {
              key: 'foundOn',
              label: 'Found on',
              width: 'minmax(180px, 1fr)',
              render: (value) => <span className="truncate">{String(value)}</span>,
            },
            {
              key: 'anchorText',
              label: 'Anchor',
              width: 'minmax(160px, 1fr)',
              render: (value) => <span className="truncate">{String(value)}</span>,
            },
          ]}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          onRowClick={onOpenLinks}
        />
      </div>
    </GroupBlock>
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
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.map((score) => {
        const active = activeCategories.has(score.category);
        return (
          <GroupBlock
            key={score.category}
            title={score.label}
            meta={`${score.affectedPages} affected of ${score.denominatorPages} indexed pages`}
            className={cn(active && 'ring-2 ring-[var(--brand-mint-glow)]')}
            stats={[{ label: 'score', value: formatScore(score.score), color: scoreColor(score.score) }]}
          >
            <ClickableRow
              active={active}
              onClick={() => onToggleCategory(score.category)}
              className="rounded-[var(--radius-md)] px-3 py-3"
            >
              <div className="space-y-3">
                <Meter value={score.score} gradient showValue ariaLabel={`${score.label} score`} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge label={`${score.errors} errors`} tone="red" variant="soft" />
                  <Badge label={`${score.warnings} warnings`} tone="amber" variant="soft" />
                  <Badge label={`${score.infos} info`} tone="blue" variant="soft" />
                </div>
              </div>
            </ClickableRow>
          </GroupBlock>
        );
      })}
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
            <div className="space-y-3">
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
                  {group.instances.length - 12} more affected pages are included in batch actions.
                </div>
              )}
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
  return (
    <GroupBlock
      title="Search readiness and guidance"
      meta="Supporting diagnostics for the technical audit"
    >
      <div key={activeEvidence ?? 'audit'} className="space-y-3 p-2">
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
      </div>
    </GroupBlock>
  );
}

function AssetRepairHandoff({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();

  const openAssetFilter = (filter: 'oversized' | 'missing-alt') => {
    navigate(`${adminPath(workspaceId, 'media')}?filter=${filter}`);
  };

  return (
    <GroupBlock title="Image source repair" meta="Asset Manager owns image repair">
      <div className="flex flex-col gap-3 px-2 py-1 sm:flex-row sm:items-center sm:justify-between">
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
    </GroupBlock>
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
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
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
    <div className="space-y-5" data-testid="site-audit-rebuilt-audit">
      <div className="grid gap-4 xl:grid-cols-[minmax(240px,320px)_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-5">
          <div className="flex items-center justify-center py-3">
            <MetricRing score={data.siteScore} size={150} noAnimation />
          </div>
          <div className="mt-4 text-center">
            <h3 className={cn('t-h2', scoreColorClass(data.siteScore))}>Overall Site Score</h3>
            <p className="t-body text-[var(--brand-text-muted)] mt-1">
              {data.totalPages} pages analyzed. Noindex pages stay out of score denominators.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MetricTile
              label="Errors"
              value={data.errors}
              accent="var(--red)"
              onClick={() => toggleSeverity('error')}
              className={cn(severityFilters.has('error') && 'ring-2 ring-[var(--brand-mint-glow)]')}
            />
            <MetricTile
              label="Warnings"
              value={data.warnings}
              accent="var(--amber)"
              onClick={() => toggleSeverity('warning')}
              className={cn(severityFilters.has('warning') && 'ring-2 ring-[var(--brand-mint-glow)]')}
            />
            <MetricTile
              label="Info"
              value={data.infos}
              accent="var(--blue)"
              onClick={() => toggleSeverity('info')}
              className={cn(severityFilters.has('info') && 'ring-2 ring-[var(--brand-mint-glow)]')}
            />
          </div>
        </div>

        <div className="space-y-4">
          <Toolbar label="Site Audit actions" className="w-full">
            <Button size="sm" onClick={handleRunAudit} disabled={!audit.siteId || audit.workflow.loading}>
              <Icon name="refresh" size="sm" />
              Re-run
            </Button>
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
            <ToolbarSpacer />
            <Toggle
              checked={!audit.workflow.skipLinkCheck}
              onChange={(checked) => audit.workflow.setSkipLinkCheck(!checked)}
              label="Dead-link scan"
            />
          </Toolbar>

          <div className="grid gap-3 md:grid-cols-4">
            <MetricTile label="Indexed pages" value={data.pages.filter((page) => !page.noindex).length} sub={`${data.pages.filter((page) => page.noindex).length} noindex excluded`} />
            <MetricTile label="Issue groups" value={audit.issueGroups.length} sub={`${filteredGroups.length} visible`} />
            <MetricTile label="Suppressed" value={audit.suppressions.length} sub="effective scoring" onClick={audit.suppressions.length > 0 ? audit.unsuppressAll : undefined} />
            <MetricTile label="Traffic map" value={formatInteger(Object.keys(audit.traffic.data ?? {}).length)} sub="pages with demand" />
          </div>

          {audit.suppressions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2">
              <Badge label={`${audit.suppressions.length} suppressed`} tone="zinc" variant="outline" />
              <span className="t-body text-[var(--brand-text-muted)]">Hidden findings are excluded from effective scores.</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await audit.unsuppressAll();
                    toast('Suppression rules cleared', 'success');
                  } catch (error) {
                    toast(mutationErrorMessage(error, 'Suppressions could not be cleared'), 'error');
                  }
                }}
                className="ml-auto"
              >
                Clear all
              </Button>
            </div>
          )}

          {audit.workflow.showNextSteps && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-ui font-semibold text-[var(--brand-text-bright)]">Next actions</span>
                <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('errors')} loading={audit.batchCreating}>
                  Add error tasks
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('filtered')} loading={audit.batchCreating}>
                  Add visible tasks
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleBatchTasks('all')} loading={audit.batchCreating}>
                  Add all tasks
                </Button>
                <Button size="sm" variant="secondary" onClick={handleAcceptAll} disabled={bulkApplying}>
                  Accept AI suggestions
                </Button>
                {bulkApplying && (
                  <span className="t-ui text-[var(--brand-text-muted)]">
                    {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : 'Starting...'}
                  </span>
                )}
              </div>
              {bulkError && <p className="t-caption-sm text-[var(--red)] mt-2">{bulkError}</p>}
            </div>
          )}
        </div>
      </div>

      <CategoryCards
        data={audit.categoryScores}
        activeCategories={categoryFilters}
        onToggleCategory={toggleCategory}
      />

      <CwvStrip data={data} />

      <AuditEvidence workspaceId={audit.workspace?.id ?? ''} activeEvidence={activeEvidence} />

      <AssetRepairHandoff workspaceId={audit.workspace?.id ?? ''} />

      {data.deadLinkDetails && data.deadLinkDetails.length > 0 && (
        <DeadLinksPanel links={data.deadLinkDetails} onOpenLinks={audit.openDeadLinks} />
      )}

      <div className="space-y-3">
        <Toolbar label="Audit issue filters" className="w-full">
          <SearchField value={search} onChange={setSearch} placeholder="Search issues, pages, or recommendations" />
          <Segmented
            value={sortMode}
            onChange={(value) => setSortMode(value as SiteAuditSortMode)}
            options={[
              { value: 'severity', label: 'Severity' },
              { value: 'traffic', label: 'Traffic' },
            ]}
          />
          <ToolbarSpacer />
          <Button size="sm" variant="ghost" onClick={() => { setCategoryFilters(new Set()); setSeverityFilters(new Set()); }}>
            Clear filters
          </Button>
        </Toolbar>

        <div className="flex flex-wrap gap-2">
          {(['error', 'warning', 'info'] as const).map((severity) => (
            <FilterChip
              key={severity}
              label={severity}
              active={severityFilters.has(severity)}
              count={audit.issueGroups.filter((group) => group.severity === severity).length}
              onClick={() => toggleSeverity(severity)}
            />
          ))}
          {AUDIT_DISPLAY_CATEGORIES.map((category) => (
            <FilterChip
              key={category}
              label={AUDIT_DISPLAY_CATEGORY_LABELS[category]}
              active={categoryFilters.has(category)}
              count={audit.issueGroups.filter((group) => group.displayCategory === category).length}
              onClick={() => toggleCategory(category)}
            />
          ))}
        </div>

        <div className="t-ui text-[var(--brand-text-muted)]">
          Showing {filteredGroups.length} of {audit.issueGroups.length} issue groups
        </div>

        <DataTable
          id="site-audit-issue-table"
          columns={issueColumns}
          rows={rows}
          getRowKey={(row) => (row as unknown as IssueTableRow).id}
          onRowClick={(row) => setSelectedGroup((row as unknown as IssueTableRow).group)}
          empty={(
            <EmptyState
              icon={SurfaceIcon}
              title="No issues match the current filters"
              description="Clear filters or re-run the audit to refresh the issue set."
            />
          )}
        />
      </div>

      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-3">
        <Icon name="trophy" size="md" className="mt-0.5 text-[var(--emerald)]" />
        <div>
          <div className="t-ui font-semibold text-[var(--brand-text-bright)]">From fix to proof</div>
          <p className="mt-1 t-body text-[var(--brand-text-muted)]">
            Technical fixes stay in Site Audit and Cockpit until traffic, crawlability, or Core Web Vitals recovery is measurable.
          </p>
        </div>
      </div>

      {(data as SiteAuditResult & { snapshotId?: string }).snapshotId && (
        <ActionItemsPanel snapshotId={(data as SiteAuditResult & { snapshotId: string }).snapshotId} />
      )}

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
      <AuditHistory
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

  if (audit.workspaces.isLoading && !audit.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Site Audit">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (audit.workspaces.isError && !audit.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
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
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Site Audit" subtitle="Technical health, content quality, and search readiness." />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before reviewing Site Audit." className="min-h-[420px]" />
      </div>
    );
  }

  if (!audit.siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5" data-testid="site-audit-rebuilt-surface">
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
      <div className="flex min-h-full flex-col gap-5" data-testid="site-audit-rebuilt-surface">
        <PageHeader
          title="Site Audit"
          subtitle={`${audit.siteName || 'Connected site'} · technical health, content quality, and search readiness`}
          icon={<Icon name="gauge" size="lg" className="text-[var(--teal)]" />}
          className="flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible"
        />

        <Toolbar label="Site Audit lenses" className="w-full">
          <LensSwitcher
            id="site-audit-sub-switcher"
            options={lensOptions}
            value={state.visibleSub}
            onChange={(value) => state.setSub(value as SiteAuditVisibleSub)}
            size="sm"
            className="w-full flex-wrap sm:w-fit sm:flex-nowrap"
          />
        </Toolbar>

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
