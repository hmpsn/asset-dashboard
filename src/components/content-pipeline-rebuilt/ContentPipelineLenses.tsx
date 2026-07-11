// @ds-rebuilt
import type { ReactNode } from 'react';
import { ContentBriefs } from '../ContentBriefs';
import { ContentCalendar } from '../ContentCalendar';
import { ContentManager } from '../ContentManager';
import { ContentPlanner } from '../ContentPlanner';
import { ContentSubscriptions } from '../ContentSubscriptions';
import { AiSuggested } from '../pipeline/AiSuggested';
import type { FixContext } from '../../types/fix-context';
import type { ContentPipelineSlice, CannibalizationWarning, DecayAlert } from '../../../shared/types/intelligence';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricTile,
  type DataColumn,
  type Tier,
} from '../ui';
import { PublishedContentLens } from './PublishedContentLens';
import type { ContentPipelineTab } from './useContentPipelineSurfaceState';
import { formatContentDate, formatInteger, formatPercentValue } from './contentPipelineFormatters';

interface PipelineSummary {
  briefs: number;
  posts: number;
  matrices: number;
  cells: number;
  published: number;
}

interface PipelineDecaySummary {
  critical: number;
  warning: number;
  totalDecaying: number;
  avgDeclinePct: number;
}

export interface ContentPipelineData {
  summary: PipelineSummary | null;
  decay: PipelineDecaySummary | null;
}

interface ContentPipelineLensesProps {
  workspaceId: string;
  tab: ContentPipelineTab;
  pipelineData?: ContentPipelineData;
  contentPipeline?: ContentPipelineSlice;
  workspaceTier: Tier;
  siteLabel?: string | null;
  briefFixContext: FixContext | null;
  prefillNonce: number;
  clearBriefFixContext: () => void;
  onCreateBrief: (keyword: string, pageUrl?: string, suggestedBriefId?: string) => void;
  onOpenTab: (tab: ContentPipelineTab) => void;
}

type HealthRecord = Record<string, unknown> & {
  id: string;
  kind: 'decay' | 'cannibalization';
  title: string;
  severity: string;
  detail: string;
  detectedAt: string;
  source: DecayAlert | CannibalizationWarning | PipelineDecaySummary;
};

function CarryOverPanel({
  tab,
  children,
}: {
  tab: ContentPipelineTab;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label={`Content pipeline ${tab} lens`}>
      {children}
    </section>
  );
}

function HealthEmptyIcon({ className }: { className?: string }) {
  return <Icon name="gauge" className={className} />;
}

function healthTone(severity: string): 'red' | 'amber' | 'zinc' {
  if (severity === 'critical' || severity === 'high') return 'red';
  if (severity === 'warning' || severity === 'medium') return 'amber';
  return 'zinc';
}

function healthRows(
  decay: PipelineDecaySummary | null | undefined,
  slice: ContentPipelineSlice | undefined,
): HealthRecord[] {
  const rows: HealthRecord[] = [];
  const detailedDecayAlerts = slice?.decayAlerts ?? [];
  if (decay && decay.totalDecaying > 0 && detailedDecayAlerts.length === 0) {
    rows.push({
      id: 'decay-summary',
      kind: 'decay',
      title: `${decay.totalDecaying} decaying page${decay.totalDecaying === 1 ? '' : 's'}`,
      severity: decay.critical > 0 ? 'critical' : 'warning',
      detail: `${decay.critical} critical, ${decay.warning} warning, avg ${formatPercentValue(Math.abs(decay.avgDeclinePct))} decline`,
      detectedAt: 'Current summary',
      source: decay,
    });
  }
  for (const alert of detailedDecayAlerts) {
    rows.push({
      id: `decay-${alert.pageUrl}`,
      kind: 'decay',
      title: alert.pageUrl,
      severity: alert.isRepeatDecay ? 'critical' : 'warning',
      detail: `${formatInteger(alert.clickDrop)} click drop${alert.hasRefreshBrief ? ' · refresh brief exists' : ''}`,
      detectedAt: formatContentDate(alert.detectedAt),
      source: alert,
    });
  }
  for (const warning of slice?.cannibalizationWarnings ?? []) {
    rows.push({
      id: `cannibalization-${warning.keyword}`,
      kind: 'cannibalization',
      title: warning.keyword,
      severity: warning.severity,
      detail: `${warning.pages.length} competing page${warning.pages.length === 1 ? '' : 's'}`,
      detectedAt: 'Latest scan',
      source: warning,
    });
  }
  return rows;
}

function ContentHealthLens({
  pipelineData,
  contentPipeline,
  workspaceTier,
  onOpenTab,
}: {
  pipelineData?: ContentPipelineData;
  contentPipeline?: ContentPipelineSlice;
  workspaceTier: Tier;
  onOpenTab: (tab: ContentPipelineTab) => void;
}) {
  const decay = pipelineData?.decay;
  const rows = healthRows(decay, contentPipeline);
  const advancedUnlocked = workspaceTier === 'growth' || workspaceTier === 'premium';
  const refreshBriefs = contentPipeline?.decayAlerts?.filter((alert) => alert.hasRefreshBrief).length ?? 0;

  if (rows.length === 0) {
    return (
      <CarryOverPanel tab="content-health">
        <EmptyState
          icon={HealthEmptyIcon}
          title="No decaying content"
          description="Every published piece is holding or growing its traffic. Pages that start sliding will surface here for a refresh."
          action={(
            <Button size="sm" variant="secondary" onClick={() => onOpenTab('briefs')}>
              <Icon name="clipboard" size="sm" />
              Draft refresh brief
            </Button>
          )}
        />
      </CarryOverPanel>
    );
  }

  const columns: DataColumn[] = [
    {
      key: 'title',
      label: 'Signal',
      width: 'minmax(260px, 1.5fr)',
      render: (_value, record) => {
        const row = record as HealthRecord;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.title}</span>
            <span className="mt-1 block truncate t-caption-sm text-[var(--brand-text-muted)]">{row.detail}</span>
          </div>
        );
      },
    },
    {
      key: 'kind',
      label: 'Type',
      width: '140px',
      render: (_value, record) => (
        <Badge
          label={(record as HealthRecord).kind === 'decay' ? 'Decay' : 'Cannibalization'}
          tone={(record as HealthRecord).kind === 'decay' ? 'amber' : 'blue'}
          variant="soft"
          size="sm"
        />
      ),
    },
    {
      key: 'severity',
      label: 'Severity',
      width: '120px',
      render: (_value, record) => (
        <Badge label={(record as HealthRecord).severity} tone={healthTone((record as HealthRecord).severity)} variant="outline" size="sm" />
      ),
    },
    {
      key: 'detectedAt',
      label: 'Detected',
      width: '160px',
      render: (_value, record) => (
        <span className="t-caption-sm text-[var(--brand-text-muted)]">{(record as HealthRecord).detectedAt}</span>
      ),
    },
  ];
  return (
    <CarryOverPanel tab="content-health">
      <InlineBanner tone="info" title="The maintenance loop">
        These pages ranked, then slipped. Start a refresh brief to bring the work back through the same production lifecycle as new content.
      </InlineBanner>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile label="Pages Decaying" value={decay?.totalDecaying ?? contentPipeline?.decayAlerts?.length ?? 0} accent={(decay?.critical ?? 0) > 0 ? 'var(--red)' : 'var(--amber)'} />
        <MetricTile label="Critical" value={decay?.critical ?? 0} accent="var(--red)" />
        <MetricTile label="Cannibalization" value={contentPipeline?.cannibalizationWarnings?.length ?? 0} accent="var(--blue)" />
      </div>

      {!advancedUnlocked && (
        <InlineBanner tone="info" title="Upgrade for deeper repair">
          Crawl-backed repair and deeper cannibalization workflows require a higher plan. You can still review these signals and start a brief here.
        </InlineBanner>
      )}

      <GroupBlock
        title="Pages to maintain"
        meta="Decay and cannibalization signals that need an operator decision."
        stats={[
          { label: 'Signals', value: rows.length, color: 'var(--amber)' },
          { label: 'Refresh briefs', value: refreshBriefs, color: refreshBriefs > 0 ? 'var(--teal)' : 'var(--brand-text-muted)' },
        ]}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(record) => (record as HealthRecord).id}
            onRowClick={() => onOpenTab('intake')}
            empty={(
              <EmptyState
                icon={HealthEmptyIcon}
                title="No content health signals"
                description="Decay and cannibalization signals will appear here when workspace intelligence flags pages that need action."
              />
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenTab('briefs')}>
              <Icon name="clipboard" size="sm" />
              Draft refresh brief
            </Button>
          </div>
        </div>
      </GroupBlock>
    </CarryOverPanel>
  );
}

export function ContentPipelineLenses({
  workspaceId,
  tab,
  pipelineData,
  contentPipeline,
  workspaceTier,
  siteLabel,
  briefFixContext,
  prefillNonce,
  clearBriefFixContext,
  onCreateBrief,
  onOpenTab,
}: ContentPipelineLensesProps) {
  if (tab === 'planner') {
    return (
      <CarryOverPanel tab="planner">
        <div className="[&>div]:!space-y-4" data-testid="content-pipeline-matrix-composition">
          <ContentPlanner workspaceId={workspaceId} embedded />
        </div>
      </CarryOverPanel>
    );
  }

  if (tab === 'calendar') {
    return (
      <CarryOverPanel tab="calendar">
        <div className="[&>div>div:nth-child(2)]:hidden [&>div]:!space-y-4" data-testid="content-pipeline-calendar-composition">
          <ContentCalendar workspaceId={workspaceId} embedded />
        </div>
      </CarryOverPanel>
    );
  }

  if (tab === 'intake') {
    return (
      <CarryOverPanel tab="intake">
        <AiSuggested workspaceId={workspaceId} onCreateBrief={onCreateBrief} />
      </CarryOverPanel>
    );
  }

  if (tab === 'briefs') {
    return (
      <CarryOverPanel tab="briefs">
        <ContentBriefs
          key={briefFixContext ? `briefs-${workspaceId}-${prefillNonce}` : `briefs-${workspaceId}`}
          workspaceId={workspaceId}
          fixContext={briefFixContext}
          clearFixContext={clearBriefFixContext}
          embedded
        />
      </CarryOverPanel>
    );
  }

  if (tab === 'posts') {
    return (
      <CarryOverPanel tab="posts">
        <ContentManager workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'publish') {
    return (
      <CarryOverPanel tab="publish">
        <InlineBanner tone="info" title="Production actions stay with drafts">
          Send-to-client, status progression, Webflow publish, exports, voice scoring, and editor actions remain in the Draft/Post workspace so action bars do not scatter across tabs.
        </InlineBanner>
        <ContentSubscriptions workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'content-health') {
    return (
      <ContentHealthLens
        pipelineData={pipelineData}
        contentPipeline={contentPipeline}
        workspaceTier={workspaceTier}
        onOpenTab={onOpenTab}
      />
    );
  }

  return (
    <CarryOverPanel tab="published">
      <PublishedContentLens workspaceId={workspaceId} siteLabel={siteLabel} />
    </CarryOverPanel>
  );
}
